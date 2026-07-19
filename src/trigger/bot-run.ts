import { randomUUID } from "node:crypto";
import { task } from "@trigger.dev/sdk";
import { runBot } from "../game/harness";
import { insertRunTelemetry } from "../lib/ingest";
import type { BotArchetype } from "../game/bot";

export interface BotRunPayload {
  experimentId: string;
  variant: string;
  seed: string;
  archetype?: BotArchetype;
  level?: string;
  timeoutSimMs?: number;
}

// One bot playthrough per task run — the swarm is a batch.trigger of these.
export const botRun = task({
  id: "bot-run",
  machine: "small-1x",
  run: async (payload: BotRunPayload) => {
    const result = await runBot({
      seed: payload.seed,
      archetype: payload.archetype,
      level: payload.level,
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
