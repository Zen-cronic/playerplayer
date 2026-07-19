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
export async function resolveExperiment(requested?: string): Promise<{
  ref: ExperimentRef | null;
  fellBack: boolean;
  known: string[];
}> {
  const refs = await listExperimentRefs();
  const hit = requested ? refs.find((r) => r.experimentId === requested) : undefined;
  return {
    ref: hit ?? refs[0] ?? null,
    fellBack: Boolean(requested) && !hit && refs.length > 0,
    known: refs.map((r) => r.experimentId),
  };
}

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
