import { getClickHouse, READ_SETTINGS } from "./clickhouse";
import { DEMO_GAME_ID } from "./tables";

// Query layer for the runs explorer (and, below, the live-ops panel): row-level
// reads over game_runs/game_events that the aggregate dashboards never needed.
// Filters compose as conditional query_params — filter values are never
// string-interpolated into SQL.

export const RUNS_PAGE_SIZE = 50;

export interface RunsFilter {
  experimentId?: string;
  variant?: string;
  archetype?: string;
  verdict?: string;
  page?: number;
}

export interface RunListRow {
  experimentId: string;
  variant: string;
  runId: string;
  seed: string;
  archetype: string;
  verdict: string;
  simMs: number;
  wallMs: number;
  coins: number;
  insertedAt: string;
}

export async function runsPage(
  filter: RunsFilter = {},
): Promise<{ rows: RunListRow[]; hasMore: boolean; page: number }> {
  const page = Math.max(0, filter.page ?? 0);
  const conds = ["game_id = {gameId: String}"];
  const params: Record<string, unknown> = {
    gameId: DEMO_GAME_ID,
    limit: RUNS_PAGE_SIZE + 1, // fetch one extra row: its presence IS hasMore
    offset: page * RUNS_PAGE_SIZE,
  };
  if (filter.experimentId) {
    conds.push("experiment_id = {experimentId: String}");
    params.experimentId = filter.experimentId;
  }
  if (filter.variant) {
    conds.push("variant = {variant: String}");
    params.variant = filter.variant;
  }
  if (filter.archetype) {
    conds.push("archetype = {archetype: String}");
    params.archetype = filter.archetype;
  }
  if (filter.verdict) {
    conds.push("verdict = {verdict: String}");
    params.verdict = filter.verdict;
  }

  const rs = await getClickHouse().query({
    query: `
      SELECT experiment_id, variant, run_id, seed, archetype, verdict,
             sim_ms, wall_ms, props.coins AS coins, toString(inserted_at) AS inserted_at
      FROM game_runs
      WHERE ${conds.join(" AND ")}
      ORDER BY inserted_at DESC
      LIMIT {limit: UInt16} OFFSET {offset: UInt32}
    `,
    query_params: params,
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const raw = await rs.json<{
    experiment_id: string;
    variant: string;
    run_id: string;
    seed: string;
    archetype: string;
    verdict: string;
    sim_ms: string;
    wall_ms: string;
    coins: number;
    inserted_at: string;
  }>();
  const hasMore = raw.length > RUNS_PAGE_SIZE;
  return {
    rows: raw.slice(0, RUNS_PAGE_SIZE).map((r) => ({
      experimentId: r.experiment_id,
      variant: r.variant,
      runId: r.run_id,
      seed: r.seed,
      archetype: r.archetype,
      verdict: r.verdict,
      simMs: Number(r.sim_ms),
      wallMs: Number(r.wall_ms),
      coins: Number(r.coins),
      insertedAt: r.inserted_at,
    })),
    hasMore,
    page,
  };
}

export interface RunHeader extends RunListRow {
  room: string;
}

// Resolve one run by id alone (the URL carries only the run id). A full scan on
// run_id is fine — game_runs holds thousands of rows, not millions — and the
// result hands back the complete sort-key prefix the timeline scan needs.
export async function runHeader(runId: string): Promise<RunHeader | null> {
  const rs = await getClickHouse().query({
    query: `
      SELECT experiment_id, variant, run_id, seed, archetype, verdict,
             sim_ms, wall_ms, props.coins AS coins,
             arrayElement(props.rooms_visited, 1) AS room,
             toString(inserted_at) AS inserted_at
      FROM game_runs
      WHERE game_id = {gameId: String} AND run_id = {runId: String}
      LIMIT 1
    `,
    query_params: { gameId: DEMO_GAME_ID, runId },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const [r] = await rs.json<{
    experiment_id: string;
    variant: string;
    run_id: string;
    seed: string;
    archetype: string;
    verdict: string;
    sim_ms: string;
    wall_ms: string;
    coins: number;
    room: string;
    inserted_at: string;
  }>();
  if (!r) return null;
  return {
    experimentId: r.experiment_id,
    variant: r.variant,
    runId: r.run_id,
    seed: r.seed,
    archetype: r.archetype,
    verdict: r.verdict,
    simMs: Number(r.sim_ms),
    wallMs: Number(r.wall_ms),
    coins: Number(r.coins),
    room: r.room || "Level1",
    insertedAt: r.inserted_at,
  };
}

export interface RunEventRow {
  t: number;
  type: string;
  room: string;
  x: number;
  y: number;
  health: number;
  coins: number;
  detail: string;
}

// The discrete-event timeline for one run — a true primary-key range scan on
// (game_id, experiment_id, variant, run_id), which is why it takes the full
// prefix rather than just the run id. pos samples are excluded: the trail
// canvas already tells that story at 10Hz.
export async function runEventTimeline(
  experimentId: string,
  variant: string,
  runId: string,
): Promise<RunEventRow[]> {
  const rs = await getClickHouse().query({
    query: `
      SELECT t, type, room, x, y,
             props.health AS health, props.coins AS coins, props.detail AS detail
      FROM game_events
      WHERE game_id = {gameId: String}
        AND experiment_id = {experimentId: String}
        AND variant = {variant: String}
        AND run_id = {runId: String}
        AND type != 'pos'
      ORDER BY t
      LIMIT 300
    `,
    query_params: { gameId: DEMO_GAME_ID, experimentId, variant, runId },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const rows = await rs.json<{
    t: number;
    type: string;
    room: string;
    x: number;
    y: number;
    health: number;
    coins: number;
    detail: string;
  }>();
  return rows.map((r) => ({
    t: Number(r.t),
    type: r.type,
    room: r.room,
    x: Number(r.x),
    y: Number(r.y),
    health: Number(r.health),
    coins: Number(r.coins),
    detail: r.detail,
  }));
}
