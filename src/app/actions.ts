"use server";

import { auth, idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import type { liveSwarm } from "../trigger/live-swarm";
import { runsAtCell, runTrails, type CulpritRun, type RunTrail } from "../lib/queries";
import {
  EMPTY_LIVE_SNAPSHOT,
  liveOpsSnapshot,
  liveRecentActivity,
  type LiveOpsSnapshot,
} from "../lib/ops-queries";
import { getClickHouse, READ_SETTINGS } from "../lib/clickhouse";

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
      query: "SELECT count() AS events, uniqExact(run_id) AS runs FROM game_events",
      format: "JSONEachRow",
      clickhouse_settings: READ_SETTINGS,
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

// Launching the live demo is a PUBLIC compute endpoint, so it is guarded three
// ways: (1) hard bounds live server-side AND in the task's zod schema — a
// visitor cannot control wave size; (2) a data-enforced global cooldown — any
// live-* event in the last 5 minutes refuses the launch; (3) the experiment id
// AND the global-scope idempotency key both derive from the same 5-minute
// bucket, so racing calls in one bucket produce an identical payload+key and
// dedupe to ONE run whose id every caller truthfully reports (verified live:
// a double launch created a single swarm). The two guards interlock: same
// bucket → key dedupes; later bucket → the earlier wave's events trip the
// cooldown. Worst case: one bounded 18-run wave per 5 minutes on a 3-slot
// queue.
export async function launchLiveSwarm(): Promise<{
  ok: boolean;
  experimentId?: string;
  reason?: "cooldown" | "unavailable";
}> {
  try {
    if (await liveRecentActivity()) return { ok: false, reason: "cooldown" };
    const bucket = Math.floor(Date.now() / 300_000);
    const experimentId = `live-${bucket.toString(36)}`;
    const idempotencyKey = await idempotencyKeys.create(`live:${bucket}`, { scope: "global" });
    await tasks.trigger<typeof liveSwarm>(
      "live-swarm",
      { experimentId, waves: 3, runsPerWave: 6, pace: 3 },
      { tags: [`exp_${experimentId}`, "live"], idempotencyKey },
    );
    return { ok: true, experimentId };
  } catch (e) {
    console.error("[launchLiveSwarm] failed:", e);
    return { ok: false, reason: "unavailable" };
  }
}

// 1.5s client poll target. Degrades to zeros on any ClickHouse error — a blip
// shows a flat panel, never an error page, and never a host string.
export async function fetchLiveOps(experimentId?: string): Promise<LiveOpsSnapshot> {
  try {
    return await liveOpsSnapshot(experimentId);
  } catch (e) {
    console.error("[fetchLiveOps] read failed:", e);
    return EMPTY_LIVE_SNAPSHOT;
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
  try {
    const runs = await runsAtCell(args.experimentId, args.variant, args.room, args.gx, args.gy);
    const trails = await runTrails(
      args.experimentId,
      args.variant,
      runs.map((r) => r.runId),
    );
    return { runs, trails, queryMs: Date.now() - started };
  } catch (e) {
    // A ClickHouse connection error can carry the host — keep it server-side and
    // degrade the replay to empty rather than rejecting the server action (this
    // card mounts on `/` and `/chat`, which have no dashboard error boundary).
    console.error("[fetchCulpritRuns] read failed:", e);
    return { runs: [], trails: [], queryMs: Date.now() - started };
  }
}
