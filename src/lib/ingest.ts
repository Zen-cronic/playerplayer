import { getClickHouse } from "./clickhouse";
import { ensureMigrations } from "./migrations";
import { DEMO_GAME_ID } from "./tables";
import type { RunResult } from "../game/harness";

export interface RunContext {
  experimentId: string;
  variant: string;
  runId: string;
}

// One batched insert per run (hundreds of rows), server-side batching via
// async_insert so hundreds of concurrent bot runs don't explode part counts.
// Game-specific fields (health/coins/detail) ride in the props JSON envelope;
// the client sends them as a nested object, which the server parses straight
// into the JSON column's typed paths.
export async function insertRunTelemetry(
  ctx: RunContext,
  result: RunResult,
): Promise<{ eventRows: number }> {
  const ch = getClickHouse();
  await ensureMigrations(ch);

  const eventRows = result.events.map((e) => ({
    game_id: DEMO_GAME_ID,
    experiment_id: ctx.experimentId,
    variant: ctx.variant,
    run_id: ctx.runId,
    archetype: result.archetype,
    t: e.t,
    type: e.type,
    x: e.x,
    y: e.y,
    room: e.room,
    props: { health: e.health, coins: e.coins, detail: e.detail },
  }));

  await ch.insert({
    table: "game_events",
    values: eventRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  });

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

  return { eventRows: eventRows.length };
}
