import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { metadata, task } from "@trigger.dev/sdk";
import { swarmQueue } from "./queues";
import { phaserAdapter } from "../game/adapter";
import { insertEventChunk, insertRunTelemetry } from "../lib/ingest";
import { logAgentEvent } from "../lib/agent-log";
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
  /** Live mode: approximate realtime multiple (1..20). Only meaningful with stream. */
  pace?: number;
  /**
   * Live mode: stream event chunks into ClickHouse mid-run instead of one
   * insert at the end. Ops-feed semantics, NOT experiment-grade: chat swarms
   * and the nightly canary never set this, so their exactly-once story is
   * untouched; a dead streaming run leaves an orphan event-prefix that is
   * invisible to the runs explorer (it joins on game_runs) and bounded inside
   * `live-*` experiments, which are excluded from the registry and chat.
   * Paced runs are also not frame-deterministic (see headless-context) —
   * another reason the live lane never feeds matched-seed comparisons.
   */
  stream?: boolean;
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
  // Default lane; live-swarm overrides per-trigger onto the live lane.
  queue: swarmQueue,
  retry: { maxAttempts: 1 },
  // A failed bot is tolerated in the cohort (see above) but never silent: the
  // error lands in agent_events, visible on /dashboard/agent. logAgentEvent
  // swallows its own failures and the platform ignores onFailure throws, so
  // this can't affect the run outcome or the at-most-once contract.
  onFailure: async ({ payload, error, ctx }) => {
    logAgentEvent({
      kind: "error",
      tool: "bot-run",
      runId: ctx.run.id,
      experimentId: (payload as BotRunPayload).experimentId,
      content: error instanceof Error ? error.message : String(error),
    });
  },
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

    // Streaming runs mint the runId BEFORE the run so mid-run chunks land under
    // it; the non-streaming path stays byte-identical to before (id at end).
    const streaming = payload.stream === true;
    const earlyRunId = streaming ? randomUUID() : null;
    const chunkCtx = earlyRunId
      ? {
          experimentId: payload.experimentId,
          variant: payload.variant,
          runId: earlyRunId,
          archetype: payload.archetype ?? "explorer",
        }
      : null;

    const result = await phaserAdapter.run({
      seed: payload.seed,
      archetype: payload.archetype,
      level,
      mapPath,
      timeoutSimMs: payload.timeoutSimMs,
      pace: streaming ? payload.pace : undefined,
      onFlush: chunkCtx ? (chunk) => insertEventChunk(chunkCtx, chunk) : undefined,
    });

    const runId = earlyRunId ?? randomUUID();
    const { eventRows } = await insertRunTelemetry(
      { experimentId: payload.experimentId, variant: payload.variant, runId },
      result,
      { skipEventRows: result.flushedEvents },
    );

    // Light up the parent's progress (run-experiment, regression-watch, or
    // live-swarm all set runsTotal/runsCompleted). bot-run is always
    // parent-triggered in this app, so metadata.parent always has a target.
    metadata.parent.increment("runsCompleted", 1);

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
