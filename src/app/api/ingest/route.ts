import { NextResponse } from "next/server";
import { z } from "zod";
import { getClickHouse } from "../../../lib/clickhouse";
import { ensureMigrations } from "../../../lib/migrations";
import { DEMO_GAME_ID } from "../../../lib/tables";

// Human play telemetry lands in the same game_events table as the swarm, tagged
// archetype='human'. That's what lets a heatmap show "you died where the
// rushers die" without a second pipeline.
//
// This is the one endpoint reachable from a public browser, so it is strict:
// validated, size-capped, same-origin, and it never echoes ClickHouse errors.

const MAX_EVENTS = 500;
const HUMAN_EXPERIMENT = "human-play";

// Custom telemetry properties: bounded, key-charset-guarded extras that flow
// into the props JSON envelope alongside the typed demo fields. This is NOT a
// bring-your-own-game protocol — the endpoint stays same-origin with human-*
// run ids and the fixed demo event enum; custom props + gameId are the part of
// the adaptive envelope a host page can exercise today.
const PropsSchema = z
  .record(
    z.string().regex(/^[a-z0-9_]{1,24}$/),
    z.union([z.string().max(120), z.number(), z.boolean()]),
  )
  .refine((o) => Object.keys(o).length <= 20, "too many props keys")
  .refine((o) => JSON.stringify(o).length <= 1024, "props too large");

const EventSchema = z.object({
  t: z.number().int().min(0).max(60 * 60 * 1000),
  type: z.enum([
    "run_start",
    "pos",
    "pickup_coin",
    "damage",
    "heal",
    "death",
    "run_end",
    "room_enter",
  ]),
  x: z.number().min(-10_000).max(10_000),
  y: z.number().min(-10_000).max(10_000),
  room: z.string().max(32),
  health: z.number().int().min(-128).max(127),
  coins: z.number().int().min(0).max(65_535),
  detail: z.string().max(64),
  props: PropsSchema.optional(),
});

const BodySchema = z.object({
  runId: z.string().min(8).max(64).regex(/^human-[a-zA-Z0-9-]+$/),
  gameId: z.string().regex(/^[a-z0-9-]{1,32}$/).optional(),
  events: z.array(EventSchema).min(1).max(MAX_EVENTS),
});

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  // Fail closed: browsers send Origin on POST (safe or not), so the game's own
  // fetch always carries it. A missing Origin is a non-browser client, which has
  // no business writing to the telemetry table — reject rather than wave through.
  if (!origin) return false;
  const host = req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const { runId, gameId, events } = parsed.data;

  try {
    const ch = getClickHouse();
    await ensureMigrations(ch);

    await ch.insert({
      table: "game_events",
      values: events.map((e) => ({
        game_id: gameId ?? DEMO_GAME_ID,
        experiment_id: HUMAN_EXPERIMENT,
        variant: "baseline",
        run_id: runId,
        archetype: "human",
        t: e.t,
        type: e.type,
        x: e.x,
        y: e.y,
        room: e.room,
        // Custom props spread FIRST so they can never override the typed
        // demo fields (the JSON column's hinted paths).
        props: { ...(e.props ?? {}), health: e.health, coins: e.coins, detail: e.detail },
      })),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });

    // The run row is written on the terminal event so game_runs keeps one row
    // per run; ReplacingMergeTree isn't in play here, so we only write once.
    const end = events.find((e) => e.type === "run_end");
    if (end) {
      await ch.insert({
        table: "game_runs",
        values: [
          {
            game_id: gameId ?? DEMO_GAME_ID,
            experiment_id: HUMAN_EXPERIMENT,
            variant: "baseline",
            run_id: runId,
            seed: "0",
            archetype: "human",
            verdict: end.detail === "win" ? "win" : "lose",
            sim_ms: end.t,
            wall_ms: end.t,
            props: { coins: end.coins, rooms_visited: [end.room] },
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    }

    return NextResponse.json({ ok: true, rows: events.length });
  } catch {
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
