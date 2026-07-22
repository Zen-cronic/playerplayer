import type { Migration } from "./types";

// v2 "adaptive envelope": universal typed hot columns + a JSON props column
// with typed path hints for this game's fields, so game-specific telemetry is
// schemaless yet columnar-fast (probed live: props.coins reads back as UInt16,
// not Dynamic). New tables — v1 is never altered; it stays as the rollback.
//
// Key order is query-aligned (every hot read filters the exact prefix), and
// approximately cardinality-ascending; experiment_id precedes lower-cardinality
// variant as a workload-derived exception (variant never appears in a filter
// without experiment_id).
//
// game_events carries NO TTL on purpose: game_heatmap is an incremental MV
// target with no time bucket, and TTL deletions on the source never subtract
// from it — a raw-events TTL would make the aggregate drift wrong over time.
// Aligned, time-bucketed retention is roadmap. agent_events KEEPS a TTL: it has
// no derived aggregate, so expiry there is safe.
//
// game_heatmap is generic (type-keyed, one `n` counter): any event type from
// any game gets spatial aggregation with zero schema work, and reads pick the
// types they mean via sumIf, so extra types can never pollute a result.
export const envelope: Migration = {
  id: 2,
  name: "envelope",
  statements: [
    `
  CREATE TABLE IF NOT EXISTS game_events (
    game_id LowCardinality(String) DEFAULT 'tilemap-demo',
    experiment_id String,
    variant LowCardinality(String),
    run_id String,
    archetype LowCardinality(String),
    t UInt32 CODEC(Delta(4), ZSTD(1)),
    type LowCardinality(String),
    x Float32 CODEC(Gorilla, ZSTD(1)),
    y Float32 CODEC(Gorilla, ZSTD(1)),
    room LowCardinality(String),
    props JSON(max_dynamic_paths = 64, health Int8, coins UInt16, detail String),
    inserted_at DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
  )
  ENGINE = MergeTree
  ORDER BY (game_id, experiment_id, variant, run_id, t)
`,
    `
  CREATE TABLE IF NOT EXISTS game_runs (
    game_id LowCardinality(String) DEFAULT 'tilemap-demo',
    experiment_id String,
    variant LowCardinality(String),
    run_id String,
    seed String,
    archetype LowCardinality(String),
    verdict LowCardinality(String),
    sim_ms UInt32,
    wall_ms UInt32,
    props JSON(max_dynamic_paths = 64, coins UInt16, rooms_visited Array(String)),
    inserted_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = MergeTree
  ORDER BY (game_id, experiment_id, variant, run_id)
`,
    `
  CREATE TABLE IF NOT EXISTS game_heatmap (
    game_id LowCardinality(String),
    experiment_id String,
    variant LowCardinality(String),
    room LowCardinality(String),
    gx Int32,
    gy Int32,
    type LowCardinality(String),
    n SimpleAggregateFunction(sum, UInt64)
  )
  ENGINE = AggregatingMergeTree
  ORDER BY (game_id, experiment_id, variant, room, gx, gy, type)
`,
    `
  CREATE MATERIALIZED VIEW IF NOT EXISTS game_heatmap_mv TO game_heatmap AS
  SELECT
    game_id,
    experiment_id,
    variant,
    room,
    toInt32(floor(x / 16)) AS gx,
    toInt32(floor(y / 16)) AS gy,
    type,
    sumSimpleState(toUInt64(1)) AS n
  FROM game_events
  GROUP BY game_id, experiment_id, variant, room, gx, gy, type
`,
    `
  CREATE TABLE IF NOT EXISTS agent_events (
    session_id String,
    trigger_run_id String,
    turn UInt16,
    seq UInt16,
    kind LowCardinality(String),
    tool LowCardinality(String) DEFAULT '',
    experiment_id String DEFAULT '',
    content String,
    duration_ms UInt32 DEFAULT 0,
    ts DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    props JSON(max_dynamic_paths = 32)
  )
  ENGINE = MergeTree
  ORDER BY (session_id, turn, seq)
  TTL toDateTime(ts) + INTERVAL 90 DAY
`,
  ],
};
