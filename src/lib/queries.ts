import { getClickHouse } from "./clickhouse";

export interface HeatmapCell {
  gx: number;
  gy: number;
  visits: number;
  deaths: number;
  damage: number;
  coin_pickups: number;
}

export async function heatmap(
  experimentId: string,
  variant: string,
  room: string,
): Promise<HeatmapCell[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        gx,
        gy,
        toUInt64(sum(visits)) AS visits,
        toUInt64(sum(deaths)) AS deaths,
        toUInt64(sum(damage)) AS damage,
        toUInt64(sum(coin_pickups)) AS coin_pickups
      FROM heatmap_cells
      WHERE experiment_id = {experimentId: String}
        AND variant = {variant: String}
        AND room = {room: String}
      GROUP BY gx, gy
    `,
    query_params: { experimentId, variant, room },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ gx: number; gy: number; visits: string; deaths: string; damage: string; coin_pickups: string }>();
  return rows.map((r) => ({
    gx: r.gx,
    gy: r.gy,
    visits: Number(r.visits),
    deaths: Number(r.deaths),
    damage: Number(r.damage),
    coin_pickups: Number(r.coin_pickups),
  }));
}

export interface DeltaCell {
  gx: number;
  gy: number;
  deathsA: number;
  deathsB: number;
  visitsA: number;
  visitsB: number;
}

// Single-pass conditional aggregation — no join — so the delta stays fast
// under live inserts. Normalization by per-variant run counts happens at the
// caller with runCounts().
export async function heatmapDelta(
  experimentId: string,
  variantA: string,
  variantB: string,
  room: string,
): Promise<DeltaCell[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        gx,
        gy,
        toUInt64(sumIf(deaths, variant = {variantA: String})) AS deaths_a,
        toUInt64(sumIf(deaths, variant = {variantB: String})) AS deaths_b,
        toUInt64(sumIf(visits, variant = {variantA: String})) AS visits_a,
        toUInt64(sumIf(visits, variant = {variantB: String})) AS visits_b
      FROM heatmap_cells
      WHERE experiment_id = {experimentId: String}
        AND variant IN ({variantA: String}, {variantB: String})
        AND room = {room: String}
      GROUP BY gx, gy
    `,
    query_params: { experimentId, variantA, variantB, room },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ gx: number; gy: number; deaths_a: string; deaths_b: string; visits_a: string; visits_b: string }>();
  return rows.map((r) => ({
    gx: r.gx,
    gy: r.gy,
    deathsA: Number(r.deaths_a),
    deathsB: Number(r.deaths_b),
    visitsA: Number(r.visits_a),
    visitsB: Number(r.visits_b),
  }));
}

export interface ExperimentRef {
  experimentId: string;
  variants: string[];
  runs: number;
}

export async function listExperimentRefs(limit = 24): Promise<ExperimentRef[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        experiment_id,
        groupUniqArray(variant) AS variants,
        count() AS runs
      FROM bot_runs
      GROUP BY experiment_id
      ORDER BY max(inserted_at) DESC
      LIMIT {limit: UInt8}
    `,
    query_params: { limit },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ experiment_id: string; variants: string[]; runs: string }>();
  return rows.map((r) => ({
    experimentId: r.experiment_id,
    variants: [...r.variants].sort(),
    runs: Number(r.runs),
  }));
}

// The agent can't know experiment ids before it queries, so asking it to supply
// one invites invented ids and empty charts. Resolve server-side instead:
// an unknown or omitted id falls back to the most recent experiment.
export async function resolveExperiment(
  requested?: string,
  opts: { exclude?: string[] } = {},
): Promise<{
  ref: ExperimentRef | null;
  fellBack: boolean;
  known: string[];
}> {
  const all = await listExperimentRefs();
  const refs = opts.exclude?.length
    ? all.filter((r) => !opts.exclude!.includes(r.experimentId))
    : all;
  const hit = requested ? refs.find((r) => r.experimentId === requested) : undefined;
  return {
    ref: hit ?? refs[0] ?? null,
    fellBack: Boolean(requested) && !hit && refs.length > 0,
    known: refs.map((r) => r.experimentId),
  };
}

/** Human play sessions share bot_events but must never be mistaken for a swarm. */
export const HUMAN_EXPERIMENT = "human-play";

export function pickVariant(ref: ExperimentRef, requested?: string): string {
  if (requested && ref.variants.includes(requested)) return requested;
  if (ref.variants.includes("baseline")) return "baseline";
  return ref.variants[0] ?? "baseline";
}

export async function runCounts(experimentId: string): Promise<Record<string, number>> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT variant, count() AS n
      FROM bot_runs
      WHERE experiment_id = {experimentId: String}
      GROUP BY variant
    `,
    query_params: { experimentId },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ variant: string; n: string }>();
  return Object.fromEntries(rows.map((r) => [r.variant, Number(r.n)]));
}

export interface ExperimentRow {
  experimentId: string;
  variants: string[];
  runs: number;
  deaths: number;
  lastRun: string;
}

// Registry view for /dashboard: what has been run, when, and how lethal it was.
export async function experimentRows(limit = 50): Promise<ExperimentRow[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        experiment_id,
        groupUniqArray(variant) AS variants,
        count() AS runs,
        countIf(verdict = 'lose') AS deaths,
        toString(max(inserted_at)) AS last_run
      FROM bot_runs
      GROUP BY experiment_id
      ORDER BY max(inserted_at) DESC
      LIMIT {limit: UInt16}
    `,
    query_params: { limit },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{
    experiment_id: string;
    variants: string[];
    runs: string;
    deaths: string;
    last_run: string;
  }>();
  return rows.map((r) => ({
    experimentId: r.experiment_id,
    variants: [...r.variants].sort(),
    runs: Number(r.runs),
    deaths: Number(r.deaths),
    lastRun: r.last_run,
  }));
}

export interface WatchReportRow {
  date: string;
  prevDate: string;
  room: string;
  runs: number;
  deathRate: number;
  prevDeathRate: number;
  verdict: string;
  cellsChanged: number;
}

export async function watchReportRows(limit = 14): Promise<WatchReportRow[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        toString(date) AS date,
        toString(prev_date) AS prev_date,
        room,
        runs,
        death_rate,
        prev_death_rate,
        verdict,
        cells_changed
      FROM watch_reports FINAL
      ORDER BY date DESC
      LIMIT {limit: UInt8}
    `,
    query_params: { limit },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{
    date: string;
    prev_date: string;
    room: string;
    runs: number;
    death_rate: number;
    prev_death_rate: number;
    verdict: string;
    cells_changed: number;
  }>();
  return rows.map((r) => ({
    date: r.date,
    prevDate: r.prev_date,
    room: r.room,
    runs: Number(r.runs),
    deathRate: Number(r.death_rate),
    prevDeathRate: Number(r.prev_death_rate),
    verdict: r.verdict,
    cellsChanged: Number(r.cells_changed),
  }));
}

export interface CulpritRun {
  runId: string;
  archetype: string;
  seed: string;
  coins: number;
  simMs: number;
  verdict: string;
}

// Which runs died in one cell. The heatmap answers "where", this answers "who" —
// the click-through from an aggregate back to the individual playthroughs.
export async function runsAtCell(
  experimentId: string,
  variant: string,
  room: string,
  gx: number,
  gy: number,
  limit = 6,
): Promise<CulpritRun[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT run_id, archetype, seed, coins, sim_ms, verdict
      FROM bot_runs
      WHERE experiment_id = {experimentId: String}
        AND variant = {variant: String}
        AND run_id IN (
          SELECT run_id
          FROM bot_events
          WHERE experiment_id = {experimentId: String}
            AND variant = {variant: String}
            AND room = {room: String}
            AND type = 'death'
            AND toInt32(floor(x / 16)) = {gx: Int32}
            AND toInt32(floor(y / 16)) = {gy: Int32}
        )
      ORDER BY sim_ms
      LIMIT {limit: UInt8}
    `,
    query_params: { experimentId, variant, room, gx, gy, limit },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{
    run_id: string;
    archetype: string;
    seed: string;
    coins: string;
    sim_ms: string;
    verdict: string;
  }>();
  return rows.map((r) => ({
    runId: r.run_id,
    archetype: r.archetype,
    seed: r.seed,
    coins: Number(r.coins),
    simMs: Number(r.sim_ms),
    verdict: r.verdict,
  }));
}

export interface RunTrail {
  runId: string;
  archetype: string;
  points: Array<{ t: number; x: number; y: number }>;
  death: { x: number; y: number } | null;
}

// The ghost trail: one run's ~10Hz position stream, read straight off the
// bot_events sort key (experiment_id, variant, run_id, t) — a primary-key
// range scan per run, no aggregation.
export async function runTrails(
  experimentId: string,
  variant: string,
  runIds: string[],
  bucketMs = 250,
): Promise<RunTrail[]> {
  if (runIds.length === 0) return [];
  const ch = getClickHouse();
  // Downsample in the database, not the browser. A path drawn a few hundred
  // pixels wide gains nothing from 10Hz+ samples, and a long human session can
  // otherwise return tens of thousands of rows. Bucketing also collapses any
  // duplicate samples for the same instant into one point.
  const rs = await ch.query({
    query: `
      SELECT
        run_id,
        any(archetype) AS archetype,
        toUInt32(intDiv(t, {bucketMs: UInt32})) AS bucket,
        argMin(x, t) AS x,
        argMin(y, t) AS y
      FROM bot_events
      WHERE experiment_id = {experimentId: String}
        AND variant = {variant: String}
        AND run_id IN {runIds: Array(String)}
        AND type = 'pos'
      GROUP BY run_id, bucket
      ORDER BY run_id, bucket
      LIMIT 4000
    `,
    query_params: { experimentId, variant, runIds, bucketMs },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{
    run_id: string;
    archetype: string;
    bucket: number;
    x: number;
    y: number;
  }>();

  const deathRs = await ch.query({
    query: `
      SELECT run_id, argMax(x, t) AS x, argMax(y, t) AS y
      FROM bot_events
      WHERE experiment_id = {experimentId: String}
        AND variant = {variant: String}
        AND run_id IN {runIds: Array(String)}
        AND type = 'death'
      GROUP BY run_id
    `,
    query_params: { experimentId, variant, runIds },
    format: "JSONEachRow",
  });
  const deaths = new Map(
    (await deathRs.json<{ run_id: string; x: number; y: number }>()).map((d) => [
      d.run_id,
      { x: Number(d.x), y: Number(d.y) },
    ]),
  );

  const byRun = new Map<string, RunTrail>();
  for (const r of rows) {
    let trail = byRun.get(r.run_id);
    if (!trail) {
      trail = {
        runId: r.run_id,
        archetype: r.archetype,
        points: [],
        death: deaths.get(r.run_id) ?? null,
      };
      byRun.set(r.run_id, trail);
    }
    trail.points.push({ t: r.bucket * bucketMs, x: Number(r.x), y: Number(r.y) });
  }
  return runIds.map((id) => byRun.get(id)).filter((t): t is RunTrail => Boolean(t));
}

export interface HumanRun {
  runId: string;
  room: string;
  death: { x: number; y: number } | null;
  lastT: number;
  coins: number;
}

// The most recent human playthrough, whether or not it finished — a judge who
// wanders off mid-run should still see their trail.
export async function latestHumanRun(): Promise<HumanRun | null> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        run_id,
        any(room) AS room,
        max(t) AS last_t,
        max(coins) AS coins,
        argMaxIf(x, t, type = 'death') AS death_x,
        argMaxIf(y, t, type = 'death') AS death_y,
        countIf(type = 'death') AS deaths
      FROM bot_events
      WHERE archetype = 'human'
      GROUP BY run_id
      ORDER BY max(inserted_at) DESC
      LIMIT 1
    `,
    format: "JSONEachRow",
  });
  const [r] = await rs.json<{
    run_id: string;
    room: string;
    last_t: number;
    coins: number;
    death_x: number;
    death_y: number;
    deaths: string;
  }>();
  if (!r) return null;
  return {
    runId: r.run_id,
    room: r.room,
    lastT: Number(r.last_t),
    coins: Number(r.coins),
    death: Number(r.deaths) > 0 ? { x: Number(r.death_x), y: Number(r.death_y) } : null,
  };
}

export interface DeathNeighbourhood {
  radiusTiles: number;
  swarmRuns: number;
  swarmDeathsNearby: number;
  byArchetype: Array<{ archetype: string; deaths: number; runs: number }>;
}

// "You died where 62% of rushers die" — the swarm's death density around one
// point, split by archetype so the comparison names a play style.
export async function deathsNear(
  experimentId: string,
  variant: string,
  room: string,
  x: number,
  y: number,
  radiusTiles = 2,
): Promise<DeathNeighbourhood> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        archetype,
        countIf(type = 'death' AND abs(x - {x: Float32}) <= {r: Float32} AND abs(y - {y: Float32}) <= {r: Float32}) AS deaths_nearby,
        uniqExact(run_id) AS runs
      FROM bot_events
      WHERE experiment_id = {experimentId: String}
        AND variant = {variant: String}
        AND room = {room: String}
      GROUP BY archetype
    `,
    query_params: {
      experimentId,
      variant,
      room,
      x,
      y,
      r: radiusTiles * 16,
    },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ archetype: string; deaths_nearby: string; runs: string }>();
  const byArchetype = rows.map((r) => ({
    archetype: r.archetype,
    deaths: Number(r.deaths_nearby),
    runs: Number(r.runs),
  }));
  return {
    radiusTiles,
    swarmRuns: byArchetype.reduce((s, a) => s + a.runs, 0),
    swarmDeathsNearby: byArchetype.reduce((s, a) => s + a.deaths, 0),
    byArchetype,
  };
}

export interface FunnelStage {
  stage: string;
  runs: number;
}

// Coin-progression funnel via windowFunnel over each run's event stream.
export async function progressionFunnel(
  experimentId: string,
  variant: string,
): Promise<FunnelStage[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        countIf(lvl >= 1) AS started,
        countIf(lvl >= 2) AS coin_1,
        countIf(lvl >= 3) AS coin_3,
        countIf(lvl >= 4) AS coin_5
      FROM (
        SELECT
          run_id,
          windowFunnel(600000)(
            t,
            type = 'run_start',
            type = 'pickup_coin' AND coins >= 1,
            type = 'pickup_coin' AND coins >= 3,
            type = 'pickup_coin' AND coins >= 5
          ) AS lvl
        FROM bot_events
        WHERE experiment_id = {experimentId: String}
          AND variant = {variant: String}
        GROUP BY run_id
      )
    `,
    query_params: { experimentId, variant },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ started: string; coin_1: string; coin_3: string; coin_5: string }>();
  const r = rows[0];
  return [
    { stage: "started", runs: Number(r?.started ?? 0) },
    { stage: "1 coin", runs: Number(r?.coin_1 ?? 0) },
    { stage: "3 coins", runs: Number(r?.coin_3 ?? 0) },
    { stage: "5 coins", runs: Number(r?.coin_5 ?? 0) },
  ];
}
