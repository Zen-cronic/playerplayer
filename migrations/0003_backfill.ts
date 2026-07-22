import type { Migration } from "./types";

// Copies every v1 row into the v2 envelope, constructing props JSON from the
// typed v1 columns via a named-tuple cast (probed live, incl. quotes in
// strings). Two deliberate properties:
//
// - Idempotent in SQL: the scalar-subquery guard makes a re-run insert zero
//   rows, so the guard is part of the checksummed statements.
// - NO direct insert into game_heatmap: the MV fires on the backfill INSERT
//   SELECT itself and populates the rollup as a side effect. Adding a direct
//   aggregation insert on top would double-count — the heatmap parity check
//   below would catch exactly that (deaths would read 2x).
//
// inserted_at is copied verbatim for provenance. Run while nothing writes v1
// (quiesce swarms/browser play); a v1 write between backfill and cutover
// deploy shows up as a parity mismatch — recover by TRUNCATEing the v2 tables
// only and re-running. No statement here ever names a v1 table destructively.
export const backfill: Migration = {
  id: 3,
  name: "backfill_v1_to_v2",
  statements: [
    `
  INSERT INTO game_events (game_id, experiment_id, variant, run_id, archetype, t, type, x, y, room, props, inserted_at)
  SELECT
    'tilemap-demo',
    experiment_id, variant, run_id, archetype, t, type, x, y, room,
    CAST(
      CAST((health, coins, detail), 'Tuple(health Int8, coins UInt16, detail String)'),
      'JSON(health Int8, coins UInt16, detail String)'
    ) AS props,
    inserted_at
  FROM bot_events
  WHERE (SELECT count() FROM game_events) = 0
`,
    `
  INSERT INTO game_runs (game_id, experiment_id, variant, run_id, seed, archetype, verdict, sim_ms, wall_ms, props, inserted_at)
  SELECT
    'tilemap-demo',
    experiment_id, variant, run_id, seed, archetype, verdict, sim_ms, wall_ms,
    CAST(
      CAST((coins, rooms_visited), 'Tuple(coins UInt16, rooms_visited Array(String))'),
      'JSON(coins UInt16, rooms_visited Array(String))'
    ) AS props,
    inserted_at
  FROM bot_runs
  WHERE (SELECT count() FROM game_runs) = 0
`,
  ],
  postChecks: [
    {
      name: "events count",
      sqlA: `SELECT count() AS n FROM bot_events`,
      sqlB: `SELECT count() AS n FROM game_events WHERE game_id = 'tilemap-demo'`,
    },
    {
      name: "runs count",
      sqlA: `SELECT count() AS n FROM bot_runs`,
      sqlB: `SELECT count() AS n FROM game_runs WHERE game_id = 'tilemap-demo'`,
    },
    {
      name: "deaths per experiment",
      sqlA: `SELECT experiment_id, countIf(type = 'death') AS deaths FROM bot_events GROUP BY experiment_id ORDER BY experiment_id`,
      sqlB: `SELECT experiment_id, countIf(type = 'death') AS deaths FROM game_events WHERE game_id = 'tilemap-demo' GROUP BY experiment_id ORDER BY experiment_id`,
    },
    {
      name: "props round-trip (coins/health sums)",
      sqlA: `SELECT sum(coins) AS c, sum(health) AS h FROM bot_events`,
      sqlB: `SELECT sum(props.coins) AS c, sum(props.health) AS h FROM game_events WHERE game_id = 'tilemap-demo'`,
    },
    {
      name: "heatmap totals via MV",
      sqlA: `SELECT toUInt64(sum(visits)) AS visits, toUInt64(sum(deaths)) AS deaths, toUInt64(sum(damage)) AS damage, toUInt64(sum(coin_pickups)) AS cp FROM heatmap_cells`,
      sqlB: `SELECT toUInt64(sumIf(n, type = 'pos')) AS visits, toUInt64(sumIf(n, type = 'death')) AS deaths, toUInt64(sumIf(n, type = 'damage')) AS damage, toUInt64(sumIf(n, type = 'pickup_coin')) AS cp FROM game_heatmap WHERE game_id = 'tilemap-demo'`,
    },
    {
      name: "runs registry aggregate",
      sqlA: `SELECT experiment_id, count() AS runs, countIf(verdict = 'lose') AS losses FROM bot_runs GROUP BY experiment_id ORDER BY experiment_id`,
      sqlB: `SELECT experiment_id, count() AS runs, countIf(verdict = 'lose') AS losses FROM game_runs WHERE game_id = 'tilemap-demo' GROUP BY experiment_id ORDER BY experiment_id`,
    },
  ],
};
