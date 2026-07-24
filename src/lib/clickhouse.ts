import { createClient, type ClickHouseClient } from "@clickhouse/client";

let client: ClickHouseClient | null = null;

// Lazy init: CLICKHOUSE_URL must be read at run time so Trigger.dev
// dashboard-injected env vars are visible, not frozen at import time.
export function getClickHouse(): ClickHouseClient {
  if (!client) {
    const url = process.env.CLICKHOUSE_URL;
    if (!url) throw new Error("CLICKHOUSE_URL is not set");
    client = createClient({ url });
  }
  return client;
}

// Server-side guardrails for every analytical read, applied per-query (the client is shared
// with the ingest write path, so never set globally). readonly:"2" refuses writes but still
// allows the per-query settings below (an INSERT under readonly:2 fails with code 164). The
// row/time caps are defense-in-depth: the fixed queries here are already bounded well under
// the cap, so a breach is an anomaly worth throwing on (the read tools turn it into { error }).
export const READ_SETTINGS = {
  readonly: "2",
  max_result_rows: "50000",
  result_overflow_mode: "throw",
  max_execution_time: 30,
} as const;
