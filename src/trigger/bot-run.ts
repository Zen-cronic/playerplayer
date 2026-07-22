import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { task } from "@trigger.dev/sdk";
import { phaserAdapter } from "../game/adapter";
import { insertRunTelemetry } from "../lib/ingest";
import { applyMutations, type Mutation } from "../game/mutate";
import type { BotArchetype } from "../game/bot";

export interface BotRunPayload {
  experimentId: string;
  variant: string;
  seed: string;
  archetype?: BotArchetype;
  level?: string;
  /** Mutations travel in the payload — task workers share no filesystem, so each run applies them locally. */
  mutations?: Mutation[];
  timeoutSimMs?: number;
}

// One bot playthrough per task run — the swarm is a batch.trigger of these.
// No retries: a bot-run inserts its telemetry near the end, so a retry after a
// partial insert would re-insert under a fresh run_id and double-count in the
// heatmap MV. A failed run is instead tolerated as a `failedRuns` in the cohort
// (run-experiment.ts), keeping game_events exactly-once and the canary's
// night-over-night delta genuinely zero.
export const botRun = task({
  id: "bot-run",
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: BotRunPayload) => {
    const level = payload.level ?? "Level1";
    let mapPath: string | undefined;
    if (payload.mutations?.length) {
      mapPath = applyMutations(
        level,
        payload.mutations,
        path.join(os.tmpdir(), `playtest-${payload.experimentId}-${payload.variant}`, `${level.toLowerCase()}.json`),
      );
    }

    const result = await phaserAdapter.run({
      seed: payload.seed,
      archetype: payload.archetype,
      level,
      mapPath,
      timeoutSimMs: payload.timeoutSimMs,
    });

    const runId = randomUUID();
    const { eventRows } = await insertRunTelemetry(
      { experimentId: payload.experimentId, variant: payload.variant, runId },
      result,
    );

    return {
      runId,
      verdict: result.verdict,
      simMs: result.simMs,
      wallMs: result.wallMs,
      coins: result.coins,
      roomsVisited: result.roomsVisited,
      eventRows,
    };
  },
});
