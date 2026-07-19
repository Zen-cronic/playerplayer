import { NextResponse } from "next/server";
import { z } from "zod";
import { getClickHouse } from "../../../lib/clickhouse";
import { ensureSchema } from "../../../lib/schema";

// Human play telemetry lands in the same bot_events table as the swarm, tagged
// archetype='human'. That's what lets a heatmap show "you died where the
// rushers die" without a second pipeline or a schema migration.
//
// This is the one endpoint reachable from a public browser, so it is strict:
// validated, size-capped, same-origin, and it never echoes ClickHouse errors.

const MAX_EVENTS = 500;
const HUMAN_EXPERIMENT = "human-play";

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
});

const BodySchema = z.object({
  runId: z.string().min(8).max(64).regex(/^human-[a-zA-Z0-9-]+$/),
  events: z.array(EventSchema).min(1).max(MAX_EVENTS),
});

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches may omit Origin
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
  const { runId, events } = parsed.data;

  try {
    const ch = getClickHouse();
    await ensureSchema(ch);

    await ch.insert({
      table: "bot_events",
      values: events.map((e) => ({
        experiment_id: HUMAN_EXPERIMENT,
        variant: "baseline",
        run_id: runId,
        archetype: "human",
        t: e.t,
        type: e.type,
        x: e.x,
        y: e.y,
        room: e.room,
        health: e.health,
        coins: e.coins,
        detail: e.detail,
      })),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });

    // The run row is written on the terminal event so bot_runs keeps one row
    // per run; ReplacingMergeTree isn't in play here, so we only write once.
    const end = events.find((e) => e.type === "run_end");
    if (end) {
      await ch.insert({
        table: "bot_runs",
        values: [
          {
            experiment_id: HUMAN_EXPERIMENT,
            variant: "baseline",
            run_id: runId,
            seed: "0",
            archetype: "human",
            verdict: end.detail === "win" ? "win" : "lose",
            sim_ms: end.t,
            wall_ms: end.t,
            coins: end.coins,
            rooms_visited: [end.room],
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
