import { metadata, schemaTask, tags } from "@trigger.dev/sdk";
import { z } from "zod";
import { botRun } from "./bot-run";
import { ARCHETYPES } from "../game/bot";

// The live-ops demo: waves of paced, streaming bots whose telemetry lands in
// ClickHouse mid-run — the data shape of a multiplayer game, watchable on
// /dashboard/live. Children ride the dedicated live-bots queue so a
// chat-approved swarm and the live demo never starve each other, and every
// bound is enforced in the schema — the public launch action cannot exceed
// 4x6 runs no matter what it sends.
export const liveSwarm = schemaTask({
  id: "live-swarm",
  schema: z.object({
    experimentId: z.string().regex(/^live-[a-z0-9-]{1,24}$/),
    waves: z.number().int().min(1).max(4).default(3),
    runsPerWave: z.number().int().min(2).max(6).default(6),
    pace: z.number().min(2).max(5).default(3),
  }),
  run: async ({ experimentId, waves, runsPerWave, pace }) => {
    await tags.add(`exp_${experimentId}`);
    metadata.set("runsTotal", waves * runsPerWave).set("runsCompleted", 0).set("wave", 0);

    for (let wave = 0; wave < waves; wave++) {
      metadata.set("wave", wave + 1);
      await botRun.batchTriggerAndWait(
        Array.from({ length: runsPerWave }, (_, i) => ({
          payload: {
            experimentId,
            variant: "baseline",
            seed: `${experimentId}-w${wave}-${i}`,
            archetype: ARCHETYPES[i % ARCHETYPES.length],
            level: "Level1",
            pace,
            stream: true,
          },
          options: {
            queue: "live-bots",
            idempotencyKey: `${experimentId}:w${wave}:${i}`,
          },
        })),
      );
    }

    return { experimentId, runs: waves * runsPerWave };
  },
});
