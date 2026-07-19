import { task } from "@trigger.dev/sdk";
import { getClickHouse } from "../lib/clickhouse";

export const helloClickhouse = task({
  id: "hello-clickhouse",
  run: async (payload: { message?: string }) => {
    const ch = getClickHouse();

    const ping = await ch.ping();
    if (!ping.success) {
      throw new Error(`ClickHouse unreachable: ${String(ping.error)}`);
    }

    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS hello_events (
          ts DateTime64(3) DEFAULT now64(3),
          source String,
          message String
        )
        ENGINE = MergeTree
        ORDER BY ts
      `,
      clickhouse_settings: { wait_end_of_query: 1 },
    });

    const message = payload.message ?? "hello from trigger.dev";
    await ch.insert({
      table: "hello_events",
      values: [{ source: "hello-clickhouse-task", message }],
      format: "JSONEachRow",
    });

    const result = await ch.query({
      query:
        "SELECT ts, source, message FROM hello_events ORDER BY ts DESC LIMIT {limit: UInt8}",
      query_params: { limit: 5 },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ ts: string; source: string; message: string }>();

    return { inserted: message, latestRows: rows };
  },
});
