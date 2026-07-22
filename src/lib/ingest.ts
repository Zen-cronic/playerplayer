import { getClickHouse } from "./clickhouse";
import { ensureMigrations } from "./migrations";
import { DEMO_GAME_ID } from "./tables";
import type { RunResult } from "../game/harness";

export interface RunContext {
  experimentId: string;
  variant: string;
  runId: string;
}

// One shared row mapping for both the streaming-chunk path and the end-of-run
// insert — a flushed event row and a final event row must be byte-identical.
function mapEventRow(
  ctx: RunContext,
  archetype: string,
  e: RunResult["events"][number],
): Record<string, unknown> {
  return {
    game_id: DEMO_GAME_ID,
    experiment_id: ctx.experimentId,
    variant: ctx.variant,
    run_id: ctx.runId,
    archetype,
    t: e.t,
    type: e.type,
    x: e.x,
    y: e.y,
    room: e.room,
    props: { health: e.health, coins: e.coins, detail: e.detail },
  };
}

// Live-mode chunk insert. wait_for_async_insert stays 1 deliberately: the ack
// then means "durably flushed to the table", not "accepted into an in-memory
// buffer" — which is what makes the harness's cursor-on-ack truthful. The ~1s
// ack latency is irrelevant at a 750ms cadence on a paced 20-45s run.
export async function insertEventChunk(
  ctx: RunContext & { archetype: string },
  events: RunResult["events"],
): Promise<void> {
  if (events.length === 0) return;
  const ch = getClickHouse();
  await ensureMigrations(ch);
  await ch.insert({
    table: "game_events",
    values: events.map((e) => mapEventRow(ctx, ctx.archetype, e)),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  });
}

// One batched insert per run (hundreds of rows), server-side batching via
// async_insert so hundreds of concurrent bot runs don't explode part counts.
// Game-specific fields (health/coins/detail) ride in the props JSON envelope.
// skipEventRows skips the leading events a streaming run already delivered
// (acked chunks) — the tail from the cursor onward is covered here, so an
// unacked chunk is re-sent exactly once and an acked one never is.
export async function insertRunTelemetry(
  ctx: RunContext,
  result: RunResult,
  opts: { skipEventRows?: number } = {},
): Promise<{ eventRows: number }> {
  const ch = getClickHouse();
  await ensureMigrations(ch);

  const tail = result.events.slice(opts.skipEventRows ?? 0);
  if (tail.length > 0) {
    await ch.insert({
      table: "game_events",
      values: tail.map((e) => mapEventRow(ctx, result.archetype, e)),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }

  await ch.insert({
    table: "game_runs",
    values: [
      {
        game_id: DEMO_GAME_ID,
        experiment_id: ctx.experimentId,
        variant: ctx.variant,
        run_id: ctx.runId,
        seed: result.seed,
        archetype: result.archetype,
        verdict: result.verdict,
        sim_ms: result.simMs,
        wall_ms: result.wallMs,
        props: { coins: result.coins, rooms_visited: result.roomsVisited },
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  });

  // Full count regardless of streaming: run-experiment summaries stay correct.
  return { eventRows: result.events.length };
}
