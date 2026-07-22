import type { Migration } from "./types";

// The five v1 DDLs, verbatim from the retired src/lib/schema.ts. Against the
// live database every statement is a no-op (IF NOT EXISTS); on a fresh
// environment this recreates v1 exactly, so the rest of the chain replays the
// same history everywhere. Never edit an applied migration — add a new one.
export const v1Baseline: Migration = {
  id: 1,
  name: "v1_baseline",
  statements: [
    `
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
`,
    `
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
`,
    `
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
`,
    `
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
`,
    `
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
`,
  ],
};
