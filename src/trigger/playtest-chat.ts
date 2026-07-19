import fs from "node:fs";
import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { runExperiment } from "./run-experiment";
import { heatmap, heatmapDelta, progressionFunnel, runCounts } from "../lib/queries";
import { getClickHouse } from "../lib/clickhouse";
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

const tools = {
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
        return { error: `swarm failed: ${String(result.error)}` };
      }
      return { ...result.output, hypothesis, room, archetypes: ARCHETYPES };
    },
  }),

  queryHeatmap: tool({
    description:
      "Per-cell spatial aggregates (16px grid) for one variant of an experiment: visits, deaths, damage, coin pickups. The UI renders these as a heatmap overlay — always call this instead of describing locations in prose.",
    inputSchema: z.object({
      experimentId: z.string(),
      variant: z.string().default("baseline"),
      room: z.string().default("Level1"),
    }),
    execute: async ({ experimentId, variant, room }) => {
      const cells = await heatmap(experimentId, variant, room);
      const counts = await runCounts(experimentId);
      return { experimentId, variant, room, tileSize: 16, runs: counts[variant] ?? 0, cells };
    },
  }),

  queryDelta: tool({
    description:
      "Before/after comparison between two variants of an experiment: per-cell death/visit counts for both, plus run counts for normalization. The UI renders the delta heatmap — the signature answer to any what-if.",
    inputSchema: z.object({
      experimentId: z.string(),
      variantA: z.string().default("baseline"),
      variantB: z.string().default("mutated"),
      room: z.string().default("Level1"),
    }),
    execute: async ({ experimentId, variantA, variantB, room }) => {
      const [cells, counts] = await Promise.all([
        heatmapDelta(experimentId, variantA, variantB, room),
        runCounts(experimentId),
      ]);
      const runsA = counts[variantA] ?? 0;
      const runsB = counts[variantB] ?? 0;
      const deathsA = cells.reduce((s, c) => s + c.deathsA, 0);
      const deathsB = cells.reduce((s, c) => s + c.deathsB, 0);
      return {
        experimentId,
        variantA,
        variantB,
        room,
        tileSize: 16,
        runsA,
        runsB,
        totals: { deathsA, deathsB, deathRateA: runsA ? deathsA / runsA : 0, deathRateB: runsB ? deathsB / runsB : 0 },
        cells,
      };
    },
  }),

  queryFunnel: tool({
    description: "Coin-progression funnel for a variant (windowFunnel over each run's event stream): started → 1 coin → 3 coins → 5 coins.",
    inputSchema: z.object({
      experimentId: z.string(),
      variant: z.string().default("baseline"),
    }),
    execute: async ({ experimentId, variant }) => ({
      experimentId,
      variant,
      stages: await progressionFunnel(experimentId, variant),
    }),
  }),

  listExperiments: tool({
    description: "List recent experiments with per-variant run and death counts.",
    inputSchema: z.object({}),
    execute: async () => {
      const rs = await getClickHouse().query({
        query: `
          SELECT
            experiment_id,
            variant,
            count() AS runs,
            countIf(verdict = 'lose') AS deaths,
            max(inserted_at) AS last_run
          FROM bot_runs
          GROUP BY experiment_id, variant
          ORDER BY last_run DESC
          LIMIT 24
        `,
        format: "JSONEachRow",
      });
      return { experiments: await rs.json() };
    },
  }),
};

const SYSTEM_PROMPT = `You are Playtest Swarm — the agent that re-runs a game level to prove a fix. You stress-test levels of a top-down dungeon crawler (vendored OSS game "phaser3-tilemap-pack") by dispatching headless bot swarms that play the real game at ~700x realtime, streaming ~10Hz telemetry into ClickHouse.

The bots are three named archetypes with skill noise, run in equal numbers: rusher (beelines for coins), explorer (random walk), cautious (flees enemies within 96px). Runs are seeded: identical seeds play baseline and mutated variants, so comparisons are paired.

How to answer:
- The visual IS the answer. For "where do runs die?" call queryHeatmap. For any what-if comparison call queryDelta. The UI renders each query tool's output as an interactive heatmap/funnel the designer can hover — so NEVER enumerate cell coordinates, per-cell counts, or long lists in prose. After a query tool returns, reply with ONE verdict sentence plus at most two supporting facts (e.g. "the killzone is just past the chokepoint where bots spill into the pillared room — the upper room is death-free despite the most traffic"). Trust the visual to carry the detail.
- Ground every mutation in describeLevel first — object indexes and coordinates must be real.
- For a what-if ("what if I move X?"), translate it into a mutation spec, state a one-sentence hypothesis, then call runSwarm — the designer approves it before compute is spent. Afterwards, call queryDelta and give a verdict: did the change do what they wanted? Break down by archetype when the aggregate hides a difference.
- Death rates near 40-55% on baseline Level1 are normal; treat ±8 percentage points on 18+ paired runs as signal, less as noise (say so).
- Coordinates: objects use px; tiles are 16px. Level1 is 50x38 tiles: an upper room (safe), a corridor chokepoint around tiles (20-24, 11-15), and a pillared lower room where most enemies live.`;

export const playtestChat = chat.agent({
  id: "playtest-chat",
  tools,
  run: async ({ messages, tools, signal }) =>
    streamText({
      ...chat.toStreamTextOptions({ tools }),
      model: anthropic("claude-sonnet-5"),
      system: SYSTEM_PROMPT,
      messages,
      abortSignal: signal,
      stopWhen: stepCountIs(12),
    }),
});
