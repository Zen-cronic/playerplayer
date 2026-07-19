"use server";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { runsAtCell, runTrails, type CulpritRun, type RunTrail } from "../lib/queries";
import { getClickHouse } from "../lib/clickhouse";

// Creates the Session + first run; idempotent on (env, chatId).
export const startChatSession = chat.createStartSessionAction("playtest-chat");

// Pure mint — the transport calls this on 401/403 to refresh. Secrets stay
// server-side; the browser only ever sees session-scoped public tokens.
export async function mintChatAccessToken(chatId: string) {
  return auth.createPublicToken({
    scopes: { read: { sessions: chatId }, write: { sessions: chatId } },
    expirationTime: "1h",
  });
}

// Judges should be able to see the stack is live rather than take our word for
// it. Real ping, real row count — never a decorative badge. The host is
// deliberately not returned: this UI gets recorded and shared.
export async function fetchStackHealth(): Promise<{
  ok: boolean;
  events: number;
  runs: number;
  pingMs: number;
}> {
  const started = Date.now();
  try {
    const rs = await getClickHouse().query({
      query: "SELECT count() AS events, uniqExact(run_id) AS runs FROM bot_events",
      format: "JSONEachRow",
    });
    const [row] = await rs.json<{ events: string; runs: string }>();
    return {
      ok: true,
      events: Number(row?.events ?? 0),
      runs: Number(row?.runs ?? 0),
      pingMs: Date.now() - started,
    };
  } catch {
    return { ok: false, events: 0, runs: 0, pingMs: Date.now() - started };
  }
}

// Clicking a hotspot is a UI gesture, not a question — it reads ClickHouse
// directly so the replay is instant instead of waiting on a model turn.
export async function fetchCulpritRuns(args: {
  experimentId: string;
  variant: string;
  room: string;
  gx: number;
  gy: number;
}): Promise<{ runs: CulpritRun[]; trails: RunTrail[]; queryMs: number }> {
  const started = Date.now();
  const runs = await runsAtCell(args.experimentId, args.variant, args.room, args.gx, args.gy);
  const trails = await runTrails(
    args.experimentId,
    args.variant,
    runs.map((r) => r.runId),
  );
  return { runs, trails, queryMs: Date.now() - started };
}
