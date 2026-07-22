import fs from "node:fs";
import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs, hasToolCall, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { runExperiment } from "./run-experiment";
import {
  deathsNear,
  heatmap,
  heatmapDelta,
  HUMAN_EXPERIMENT,
  latestHumanRun,
  pickVariant,
  progressionFunnel,
  resolveExperiment,
  runCounts,
  runTrails,
} from "../lib/queries";
import { getClickHouse, READ_SETTINGS } from "../lib/clickhouse";
import { makeTurnLogger } from "../lib/agent-log";
import { vendorMapPath, type Mutation } from "../game/mutate";
import { ARCHETYPES } from "../game/bot";

const MutationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("move_object"),
    objectType: z.string().describe("Tiled object type: slime, enemy, demon, coins, meat, potion, jug"),
    index: z.number().int().min(0).describe("0-based index among objects of that type, in map order"),
    toX: z.number().describe("new x in px"),
    toY: z.number().describe("new y in px"),
  }),
  z.object({
    op: z.literal("copy_tile"),
    from: z.object({ x: z.number().int(), y: z.number().int() }).describe("source tile coords (16px grid)"),
    to: z.object({ x: z.number().int(), y: z.number().int() }).describe("destination tile coords"),
  }),
]);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

interface MapObject {
  type: string;
  index: number;
  tileX: number;
  tileY: number;
}

const mapObjectCache = new Map<string, MapObject[]>();

function mapObjects(room: string): MapObject[] {
  const cached = mapObjectCache.get(room);
  if (cached) return cached;
  const map = JSON.parse(fs.readFileSync(vendorMapPath(room), "utf8")) as {
    layers: Array<{ type: string; objects?: Array<{ type?: string; x: number; y: number }> }>;
  };
  const counts: Record<string, number> = {};
  const objects = (map.layers.find((l) => l.type === "objectgroup")?.objects ?? []).map((o) => {
    const type = o.type || "unknown";
    const index = counts[type] ?? 0;
    counts[type] = index + 1;
    return { type, index, tileX: Math.floor(o.x / 16), tileY: Math.floor(o.y / 16) };
  });
  mapObjectCache.set(room, objects);
  return objects;
}

// "3 tiles from slime #0" is both more actionable and more speakable than a
// coordinate pair — it names the thing the designer can actually move.
function nearestObject(room: string, gx: number, gy: number): string {
  let best: { o: MapObject; d: number } | null = null;
  for (const o of mapObjects(room)) {
    const d = Math.hypot(o.tileX - gx, o.tileY - gy);
    if (!best || d < best.d) best = { o, d };
  }
  if (!best) return "no nearby object";
  return `${Math.round(best.d)} tiles from ${best.o.type} #${best.o.index}`;
}

interface CellLike {
  gx: number;
  gy: number;
  deaths?: number;
  visits?: number;
  deathsA?: number;
  deathsB?: number;
  visitsA?: number;
  visitsB?: number;
}

// The model gets a digest, never the cell array: the chart is already on the
// designer's screen, and handing over hundreds of coordinates is exactly what
// produces coordinate-dumping walls of text (and ~10k wasted tokens a turn).
function digest(header: string, room: string, cells: CellLike[], deathsOf: (c: CellLike) => number, visitsOf: (c: CellLike) => number): string {
  const totalDeaths = cells.reduce((s, c) => s + deathsOf(c), 0);
  const deathCells = cells.filter((c) => deathsOf(c) > 0).sort((a, b) => deathsOf(b) - deathsOf(a));
  const busiest = cells.reduce((b, c) => (visitsOf(c) > visitsOf(b) ? c : b), cells[0]);
  const lines = [
    header,
    `${totalDeaths} deaths spread over ${deathCells.length} cells.`,
    ...deathCells.slice(0, 3).map((c) => `- ${deathsOf(c)} deaths ${nearestObject(room, c.gx, c.gy)}`),
    busiest
      ? `Busiest cell has ${visitsOf(busiest)} visits and ${deathsOf(busiest)} deaths (${nearestObject(room, busiest.gx, busiest.gy)}).`
      : "",
    "The chart is ALREADY rendered for the designer. You have no coordinate detail to quote — say what it means in at most two sentences.",
  ];
  return lines.filter(Boolean).join("\n");
}

// Read tools fail safe: a ClickHouse error becomes { error } (the shape the
// copilot already renders as a one-line note and the model paraphrases) rather
// than throwing into the agent loop. The raw error goes to the worker log ONLY —
// a connection error can carry the host, which must never reach the model or a
// rendered card.
function readFailed(where: string, e: unknown): { error: string } {
  console.error(`[playtest-chat] ${where} read failed:`, e);
  return { error: `couldn't read ${where} from ClickHouse just now — try again in a moment` };
}

const baseTools = {
  describeLevel: tool({
    description:
      "Read a level's layout: dimensions, spawn points, and every object (enemies, coins, pickups) with px and tile coordinates. Use before proposing any mutation.",
    inputSchema: z.object({
      room: z.string().default("Level1").describe("Level1..Level5"),
    }),
    execute: async ({ room }) => {
      const map = JSON.parse(fs.readFileSync(vendorMapPath(room), "utf8")) as {
        width: number;
        height: number;
        layers: Array<{ type: string; objects?: Array<{ type?: string; name?: string; x: number; y: number }> }>;
      };
      const objects = map.layers.find((l) => l.type === "objectgroup")?.objects ?? [];
      const byType: Record<string, Array<{ index: number; x: number; y: number; tileX: number; tileY: number; name?: string }>> = {};
      for (const o of objects) {
        const t = o.type || "unknown";
        (byType[t] ??= []).push({
          index: byType[t]?.length ?? 0,
          x: o.x,
          y: o.y,
          tileX: Math.floor(o.x / 16),
          tileY: Math.floor(o.y / 16),
          name: o.name || undefined,
        });
      }
      return { room, widthTiles: map.width, heightTiles: map.height, tileSize: 16, objects: byType };
    },
  }),

  runSwarm: tool({
    description:
      "Dispatch the bot swarm: N matched-seed runs on the current level (baseline) AND N on a mutated copy, in parallel. Costs compute — propose it with a clear hypothesis and let the designer approve. Returns per-variant death summaries once all runs land.",
    inputSchema: z.object({
      experimentId: z.string().describe("short kebab-case experiment slug, e.g. 'move-corridor-slime'"),
      hypothesis: z.string().describe("one sentence: what this mutation should change and why"),
      runsPerVariant: z.number().int().min(3).max(40).default(18),
      room: z.string().default("Level1"),
      mutations: z.array(MutationSchema).min(1).describe("the what-if under test"),
    }),
    needsApproval: true,
    execute: async ({ experimentId, runsPerVariant, room, mutations, hypothesis }) => {
      const id = slug(experimentId) || `exp-${Date.now()}`;
      const result = await runExperiment.triggerAndWait({
        experimentId: id,
        runsPerVariant,
        level: room,
        mutations: mutations as Mutation[],
      });
      if (!result.ok) {
        // Keep the child's raw error server-side — it can carry the CH host —
        // and hand the model a fixed, host-free message.
        console.error("[playtest-chat] runSwarm failed:", result.error);
        return { error: "the swarm didn't finish — try again in a moment" };
      }
      return { ...result.output, hypothesis, room, archetypes: ARCHETYPES };
    },
  }),

  queryHeatmap: tool({
    description:
      "Per-cell spatial aggregates (16px grid) for one variant of an experiment: visits, deaths, damage, coin pickups. The UI renders these as a heatmap overlay — always call this instead of describing locations in prose. Omit experimentId to use the most recent experiment; never invent one.",
    inputSchema: z.object({
      experimentId: z.string().optional().describe("omit for the most recent experiment"),
      variant: z.string().optional().describe("omit for baseline"),
      room: z.string().default("Level1"),
    }),
    execute: async ({ experimentId, variant, room }) => {
      try {
        const started = Date.now();
        const { ref, fellBack, known } = await resolveExperiment(experimentId, { exclude: [HUMAN_EXPERIMENT] });
        if (!ref) return { error: "no experiments recorded yet — run a swarm first", known };
        const v = pickVariant(ref, variant);
        const [cells, counts] = await Promise.all([heatmap(ref.experimentId, v, room), runCounts(ref.experimentId)]);
        return {
          experimentId: ref.experimentId,
          variant: v,
          room,
          tileSize: 16,
          runs: counts[v] ?? 0,
          queryMs: Date.now() - started,
          cells,
          ...(fellBack ? { note: `"${experimentId}" has no runs; showing most recent experiment "${ref.experimentId}"` } : {}),
        };
      } catch (e) {
        return readFailed("the heatmap", e);
      }
    },
    toModelOutput: ({ output }) => {
      const o = output as { error?: string; room?: string; variant?: string; runs?: number; cells?: CellLike[] };
      if (o.error || !o.cells) return { type: "text", value: o.error ?? "no data" };
      return {
        type: "text",
        value: digest(
          `Heatmap rendered: ${o.room} variant "${o.variant}", ${o.runs} runs.`,
          o.room ?? "Level1",
          o.cells,
          (c) => c.deaths ?? 0,
          (c) => c.visits ?? 0,
        ),
      };
    },
  }),

  queryDelta: tool({
    description:
      "Before/after comparison between two variants of an experiment: per-cell death/visit counts for both, plus run counts for normalization. The UI renders the delta heatmap — the signature answer to any what-if. Omit experimentId to use the most recent.",
    inputSchema: z.object({
      experimentId: z.string().optional().describe("omit for the most recent experiment"),
      variantA: z.string().optional().describe("the before variant; omit for baseline"),
      variantB: z.string().optional().describe("the after variant; omit for the other variant"),
      room: z.string().default("Level1"),
    }),
    execute: async ({ experimentId, variantA, variantB, room }) => {
      try {
        const started = Date.now();
        const { ref, fellBack, known } = await resolveExperiment(experimentId, { exclude: [HUMAN_EXPERIMENT] });
        if (!ref) return { error: "no experiments recorded yet — run a swarm first", known };
        const a = pickVariant(ref, variantA);
        const b =
          variantB && ref.variants.includes(variantB)
            ? variantB
            : (ref.variants.find((x) => x !== a) ?? a);
        const [cells, counts] = await Promise.all([
          heatmapDelta(ref.experimentId, a, b, room),
          runCounts(ref.experimentId),
        ]);
        const runsA = counts[a] ?? 0;
        const runsB = counts[b] ?? 0;
        const deathsA = cells.reduce((s, c) => s + c.deathsA, 0);
        const deathsB = cells.reduce((s, c) => s + c.deathsB, 0);
        return {
          experimentId: ref.experimentId,
          variantA: a,
          variantB: b,
          room,
          tileSize: 16,
          runsA,
          runsB,
          queryMs: Date.now() - started,
          totals: { deathsA, deathsB, deathRateA: runsA ? deathsA / runsA : 0, deathRateB: runsB ? deathsB / runsB : 0 },
          cells,
          ...(fellBack ? { note: `"${experimentId}" has no runs; showing most recent experiment "${ref.experimentId}"` } : {}),
        };
      } catch (e) {
        return readFailed("the delta", e);
      }
    },
    toModelOutput: ({ output }) => {
      const o = output as {
        error?: string;
        room?: string;
        variantA?: string;
        variantB?: string;
        runsA?: number;
        runsB?: number;
        totals?: { deathRateA: number; deathRateB: number };
        cells?: CellLike[];
      };
      if (o.error || !o.cells) return { type: "text", value: o.error ?? "no data" };
      const rateA = ((o.totals?.deathRateA ?? 0) * 100).toFixed(0);
      const rateB = ((o.totals?.deathRateB ?? 0) * 100).toFixed(0);
      // Where deaths MOVED matters as much as whether they fell — report both
      // directions so a "no change in rate, big change in place" result is visible.
      // Compare per-cell death RATES, not raw counts: a failed run can leave the
      // variants with unequal run counts, and only the rate is comparable then.
      const rA = Math.max(1, o.runsA ?? 0);
      const rB = Math.max(1, o.runsB ?? 0);
      const worse = o.cells.filter((c) => (c.deathsB ?? 0) / rB > (c.deathsA ?? 0) / rA).length;
      const better = o.cells.filter((c) => (c.deathsB ?? 0) / rB < (c.deathsA ?? 0) / rA).length;
      return {
        type: "text",
        value: [
          `Delta rendered: ${o.room}, "${o.variantA}" (${o.runsA} runs) vs "${o.variantB}" (${o.runsB} runs).`,
          `Death rate ${rateA}% → ${rateB}%. ${better} cells got safer, ${worse} got deadlier.`,
          ...o.cells
            .filter((c) => (c.deathsB ?? 0) !== (c.deathsA ?? 0))
            .sort((a, b) => Math.abs((b.deathsB ?? 0) - (b.deathsA ?? 0)) - Math.abs((a.deathsB ?? 0) - (a.deathsA ?? 0)))
            .slice(0, 3)
            .map((c) => {
              const d = (c.deathsB ?? 0) - (c.deathsA ?? 0);
              return `- ${d > 0 ? `+${d}` : d} deaths ${nearestObject(o.room ?? "Level1", c.gx, c.gy)}`;
            }),
          "The chart is ALREADY rendered. Give the verdict in at most two sentences; treat under 8 percentage points as noise.",
        ].join("\n"),
      };
    },
  }),

  compareMyRun: tool({
    description:
      "Compare the human player's most recent playthrough against the bot swarm: renders their path as a ghost trail over the swarm death heatmap, and reports how many swarm runs died near where they did, split by archetype. Use whenever the designer asks about 'my run', 'how did I do', or how they compare to the bots.",
    inputSchema: z.object({
      experimentId: z.string().optional().describe("swarm experiment to compare against; omit for most recent"),
      variant: z.string().optional(),
    }),
    execute: async ({ experimentId, variant }) => {
      try {
        const human = await latestHumanRun();
        if (!human) {
          return { error: "no human run recorded yet — play the level first, then ask again" };
        }
        // Never compare the player against their own session — resolve to a
        // real bot swarm even though human runs share the same tables.
        const { ref } = await resolveExperiment(experimentId, { exclude: [HUMAN_EXPERIMENT] });
        if (!ref) return { error: "no swarm experiments to compare against yet" };
        const v = pickVariant(ref, variant);
        const room = human.room || "Level1";

        const [cells, counts, trails, nearby] = await Promise.all([
          heatmap(ref.experimentId, v, room),
          runCounts(ref.experimentId),
          runTrails(HUMAN_EXPERIMENT, "baseline", [human.runId]),
          human.death
            ? deathsNear(ref.experimentId, v, room, human.death.x, human.death.y)
            : Promise.resolve(null),
        ]);

        return {
          experimentId: ref.experimentId,
          variant: v,
          room,
          tileSize: 16,
          runs: counts[v] ?? 0,
          cells,
          human: {
            runId: human.runId,
            survivedMs: human.lastT,
            coins: human.coins,
            died: Boolean(human.death),
          },
          humanTrail: trails[0] ?? null,
          nearby,
        };
      } catch (e) {
        return readFailed("your run comparison", e);
      }
    },
    toModelOutput: ({ output }) => {
      const o = output as {
        error?: string;
        human?: { survivedMs: number; coins: number; died: boolean };
        room?: string;
        nearby?: {
          radiusTiles: number;
          byArchetype: Array<{ archetype: string; deaths: number; runs: number }>;
        } | null;
      };
      if (o.error) return { type: "text", value: o.error };
      const h = o.human;
      const lines = [
        `Ghost trail rendered over the swarm heatmap.`,
        `Human run: ${((h?.survivedMs ?? 0) / 1000).toFixed(0)}s survived, ${h?.coins ?? 0} coins, ${h?.died ? "died" : "still alive / left mid-run"}.`,
      ];
      const botStats = (o.nearby?.byArchetype ?? []).filter((a) => a.archetype !== "human" && a.runs > 0);
      if (h?.died && botStats.length > 0) {
        for (const a of botStats) {
          const pct = Math.round((a.deaths / a.runs) * 100);
          lines.push(`- ${a.deaths} of ${a.runs} ${a.archetype} runs (${pct}%) died within ${o.nearby!.radiusTiles} tiles of the same spot`);
        }
      } else {
        // Without these numbers the comparison is unsupported — say so rather
        // than letting the model infer an alignment it cannot see.
        lines.push(
          "NO swarm death comparison is available. Do NOT claim the player died where the bots die — say the comparison isn't available yet.",
        );
      }
      lines.push(
        "The trail is ALREADY on screen. In at most two sentences tell the player whether they died where the bots die, and which archetype they played like.",
      );
      return { type: "text", value: lines.join("\n") };
    },
  }),

  queryFunnel: tool({
    description:
      "Coin-progression funnel for a variant (windowFunnel over each run's event stream): started → 1 coin → 3 coins → 5 coins. Omit experimentId to use the most recent.",
    inputSchema: z.object({
      experimentId: z.string().optional().describe("omit for the most recent experiment"),
      variant: z.string().optional().describe("omit for baseline"),
    }),
    execute: async ({ experimentId, variant }) => {
      try {
        const { ref, known } = await resolveExperiment(experimentId, { exclude: [HUMAN_EXPERIMENT] });
        if (!ref) return { error: "no experiments recorded yet — run a swarm first", known };
        const v = pickVariant(ref, variant);
        return {
          experimentId: ref.experimentId,
          variant: v,
          stages: await progressionFunnel(ref.experimentId, v),
        };
      } catch (e) {
        return readFailed("the funnel", e);
      }
    },
  }),

  suggestFollowUps: tool({
    description:
      "Offer the designer 2-3 natural next questions as clickable chips. Call this at the END of every answer, after the query tools. Suggestions should build on what was just shown: drill-downs, what-ifs, comparisons.",
    inputSchema: z.object({
      suggestions: z.array(z.string().max(90)).min(2).max(3),
    }),
    execute: async ({ suggestions }) => ({ shown: suggestions.length }),
  }),

  watchReports: tool({
    description:
      "Recent nightly regression-watch reports: a fixed-seed canary swarm replays the level every night; verdicts are stable/shifted/easier/harder night-over-night.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const rs = await getClickHouse().query({
          query: `
            SELECT date, prev_date, room, runs, death_rate, prev_death_rate, verdict, cells_changed
            FROM watch_reports FINAL
            ORDER BY date DESC
            LIMIT 14
          `,
          format: "JSONEachRow",
          clickhouse_settings: READ_SETTINGS,
        });
        return { reports: await rs.json() };
      } catch (e) {
        return readFailed("the regression watch", e);
      }
    },
  }),

  listExperiments: tool({
    description: "List recent experiments with per-variant run and death counts.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const rs = await getClickHouse().query({
          query: `
            SELECT
              experiment_id,
              variant,
              count() AS runs,
              countIf(verdict = 'lose') AS deaths,
              max(inserted_at) AS last_run
            FROM game_runs
            WHERE game_id = 'tilemap-demo'
              AND NOT (lower(experiment_id) LIKE '%smoke%'
              OR lower(experiment_id) LIKE '%bench%'
              OR lower(experiment_id) LIKE '%spike%')
            GROUP BY experiment_id, variant
            ORDER BY last_run DESC
            LIMIT 24
          `,
          format: "JSONEachRow",
          clickhouse_settings: READ_SETTINGS,
        });
        return { experiments: await rs.json() };
      } catch (e) {
        return readFailed("the experiment list", e);
      }
    },
  }),
};

const SYSTEM_PROMPT = `You are Playtest Swarm — the agent that re-runs a game level to prove a fix. You stress-test levels of a top-down dungeon crawler (vendored OSS game "phaser3-tilemap-pack") by dispatching headless bot swarms that play the real game at ~700x realtime, streaming ~10Hz telemetry into ClickHouse.

The bots are three named archetypes with skill noise, run in equal numbers: rusher (beelines for coins), explorer (random walk), cautious (flees enemies within 96px). Runs are seeded: identical seeds play baseline and mutated variants, so comparisons are paired.

How to answer:
- The visual IS the answer. For "where do runs die?" call queryHeatmap. For any what-if comparison call queryDelta. The UI renders each query tool's output as an interactive heatmap/funnel the designer can hover — the numbers are already on screen, so your prose must never repeat them.
- HARD LIMITS on the text you write after a query tool returns: TWO SENTENCES (a third sentence is a bug), one paragraph, no lists, no markdown bold. Write ZERO tile coordinates and ZERO per-cell counts — never "(22,17)" or "786 visits". Name places the way a designer talks: "just past the corridor chokepoint", "the pillared lower room", "the upper room". Say what it MEANS and what likely causes it. Good: "Bots clear the chokepoint fine — they die where they spill into the pillared room, so the enemies just inside that doorway are doing the killing, not the corridor." That is a complete answer.
- Never invent an experiment id. Omit experimentId and the tools use the most recent experiment; call listExperiments only when the designer asks what experiments exist.
- Ground every mutation in describeLevel first — object indexes and coordinates must be real.
- For a what-if ("what if I move X?"), translate it into a mutation spec, state a one-sentence hypothesis, then call runSwarm — the designer approves it before compute is spent. Afterwards, call queryDelta and give a verdict: did the change do what they wanted? Break down by archetype when the aggregate hides a difference.
- Death rates near 40-55% on baseline Level1 are normal; treat ±8 percentage points on 18+ paired runs as signal, less as noise (say so).
- Coordinates: objects use px; tiles are 16px. Level1 is 50x38 tiles: an upper room (safe), a corridor chokepoint around tiles (20-24, 11-15), and a pillared lower room where most enemies live.
- A human can play the level in the browser; their telemetry lands in the same table as the swarm. For "how did I do", "my run", or any human-vs-bot question, call compareMyRun — it renders their path as a ghost trail over the swarm heatmap.
- The "nightly" experiment is the regression watch: fixed-seed canary swarms, one variant per date. For "did the level get harder?" check watchReports, then render the visual diff via queryDelta(experimentId "nightly", variantA=<earlier date>, variantB=<later date>).
- End EVERY answer by calling suggestFollowUps with 2-3 short next questions a level designer would naturally ask, building on what was just shown (a drill-down, a what-if mutation, a comparison or funnel). Phrase them as the designer would type them. Never mention the suggestions in prose — the UI renders them as chips.
- suggestFollowUps is the LAST thing you do in a turn. Write your verdict sentence BEFORE it, then call it and stop. Never write any text after it — a second summary paragraph is a bug.`;

export const playtestChat = chat.agent({
  id: "playtest-chat",
  // Per-turn tools factory: each turn wraps the base tools with a logger held
  // in closures (chatId/turn captured), so every tool call, result, and
  // approval lands in agent_events — ClickHouse observing the agent itself.
  // No module-global turn state: concurrent sessions can't race.
  tools: ({ chatId, turn }) => makeTurnLogger({ chatId, turn, seqBase: 100 }).wrapTools(baseTools),
  onTurnStart: async ({ chatId, turn, runId, uiMessages }) => {
    // HITL continuation turns re-enter without a fresh user prompt — skip.
    const last = uiMessages[uiMessages.length - 1];
    if (last?.role !== "user") return;
    const text = last.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    if (text) makeTurnLogger({ chatId, runId, turn }).log({ kind: "prompt", content: text });
  },
  onTurnComplete: async ({ chatId, turn, runId, responseMessage }) => {
    const logger = makeTurnLogger({ chatId, runId, turn, seqBase: 900 });
    for (const part of responseMessage?.parts ?? []) {
      const type = typeof part.type === "string" ? part.type : "";
      if (!type.startsWith("tool-")) continue;
      const state = (part as { state?: string }).state;
      // A paused turn's response carries approval-requested; after approve the
      // merged part becomes output-available, so each state logs exactly once.
      if (state === "approval-requested") logger.log({ kind: "approval", tool: type.slice(5), content: "requested" });
      if (state === "output-denied") logger.log({ kind: "approval", tool: type.slice(5), content: "denied" });
    }
    const text = (responseMessage?.parts ?? [])
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    if (text) logger.log({ kind: "response", content: text });
  },
  run: async ({ messages, tools, signal }) =>
    streamText({
      ...chat.toStreamTextOptions({ tools }),
      model: anthropic("claude-sonnet-5"),
      system: SYSTEM_PROMPT,
      messages,
      abortSignal: signal,
      // The chips close the turn. Without this the loop feeds the tool result
      // back and the model writes a second, redundant summary paragraph —
      // prompting alone can't beat the step loop's control flow.
      stopWhen: [stepCountIs(12), hasToolCall("suggestFollowUps")],
    }),
});
