import type { ClickHouseClient } from "@clickhouse/client";

// Telemetry firehose: one row per bot event (~10Hz pos samples + discrete
// events). Ordered for the hot query paths: heatmaps and funnels filter by
// (experiment, variant) then aggregate across runs.
const BOT_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS bot_events (
    experiment_id String,
    variant LowCardinality(String),
    run_id String,
    archetype LowCardinality(String),
    t UInt32,
    type LowCardinality(String),
    x Float32,
    y Float32,
    room LowCardinality(String),
    health Int8,
    coins UInt16,
    detail String,
    inserted_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = MergeTree
  ORDER BY (experiment_id, variant, run_id, t)
`;

const BOT_RUNS_DDL = `
  CREATE TABLE IF NOT EXISTS bot_runs (
    experiment_id String,
    variant LowCardinality(String),
    run_id String,
    seed String,
    archetype LowCardinality(String),
    verdict LowCardinality(String),
    sim_ms UInt32,
    wall_ms UInt32,
    coins UInt16,
    rooms_visited Array(LowCardinality(String)),
    inserted_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = MergeTree
  ORDER BY (experiment_id, variant, run_id)
`;

// Insert-time spatial aggregation: the heatmap grid stays live under the
// swarm firehose without rescanning bot_events. Cell = one 16px map tile.
const HEATMAP_CELLS_DDL = `
  CREATE TABLE IF NOT EXISTS heatmap_cells (
    experiment_id String,
    variant LowCardinality(String),
    room LowCardinality(String),
    gx Int32,
    gy Int32,
    visits SimpleAggregateFunction(sum, UInt64),
    deaths SimpleAggregateFunction(sum, UInt64),
    damage SimpleAggregateFunction(sum, UInt64),
    coin_pickups SimpleAggregateFunction(sum, UInt64)
  )
  ENGINE = AggregatingMergeTree
  ORDER BY (experiment_id, variant, room, gx, gy)
`;

const HEATMAP_CELLS_MV_DDL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS heatmap_cells_mv TO heatmap_cells AS
  SELECT
    experiment_id,
    variant,
    room,
    toInt32(floor(x / 16)) AS gx,
    toInt32(floor(y / 16)) AS gy,
    sumSimpleState(toUInt64(type = 'pos')) AS visits,
    sumSimpleState(toUInt64(type = 'death')) AS deaths,
    sumSimpleState(toUInt64(type = 'damage')) AS damage,
    sumSimpleState(toUInt64(type = 'pickup_coin')) AS coin_pickups
  FROM bot_events
  GROUP BY experiment_id, variant, room, gx, gy
`;

// One row per nightly regression sweep; the chat agent surfaces these and
// queryDelta("nightly", prev_date, date) renders the visual diff.
const WATCH_REPORTS_DDL = `
  CREATE TABLE IF NOT EXISTS watch_reports (
    date Date,
    prev_date Date,
    room LowCardinality(String),
    runs UInt16,
    death_rate Float32,
    prev_death_rate Float32,
    verdict LowCardinality(String),
    cells_changed UInt32,
    inserted_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  ORDER BY (room, date)
`;

export async function ensureSchema(ch: ClickHouseClient): Promise<void> {
  for (const ddl of [BOT_EVENTS_DDL, BOT_RUNS_DDL, HEATMAP_CELLS_DDL, HEATMAP_CELLS_MV_DDL, WATCH_REPORTS_DDL]) {
    await ch.command({
      query: ddl,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
  }
}
