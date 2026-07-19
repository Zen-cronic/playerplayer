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

export async function ensureSchema(ch: ClickHouseClient): Promise<void> {
  for (const ddl of [BOT_EVENTS_DDL, BOT_RUNS_DDL]) {
    await ch.command({
      query: ddl,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
  }
}
