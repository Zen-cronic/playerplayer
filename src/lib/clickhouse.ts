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
