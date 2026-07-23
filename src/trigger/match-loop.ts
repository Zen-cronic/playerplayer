import { metadata, schemaTask, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { arenaQueue } from "./queues";
import {
  isTickResolved,
  stepBots,
  resolveTick,
  emitTickTelemetry,
  matchStatus,
} from "../lib/arena";

// The authoritative game clock. A durable per-match task that advances the match
// one tick at a time: it lets bots submit intents, asks ClickHouse to resolve the
// tick (the DB is the server), emits telemetry into the shared game_events
// envelope, and publishes progress via metadata for the Realtime client.
//
// Idempotency is structural: resolveTick is a no-op if tick T already exists, so a
// retry that resumes this loop fast-forwards already-resolved ticks and can never
// double-advance the world. Telemetry and bot intents are only produced on the tick
// that actually advances, so a fast-forward re-run neither double-emits nor
// double-inserts intents. Bounded by maxTicks and maxDuration.
export const matchLoop = schemaTask({
  id: "arena-match-loop",
  queue: arenaQueue,
  machine: "small-1x",
  maxDuration: 1800,
  retry: { maxAttempts: 3 },
  schema: z.object({
    matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
    maxTicks: z.number().int().min(1).max(2000).default(120),
    tickSeconds: z.number().min(0.2).max(5).default(0.5),
  }),
  run: async ({ matchId, maxTicks, tickSeconds }) => {
    metadata.set("matchId", matchId).set("tick", 0).set("status", "running");
    let finalTick = 0;

    for (let tick = 1; tick <= maxTicks; tick++) {
      if (await isTickResolved(matchId, tick)) {
        // Retry fast-forward: this tick already advanced on a prior attempt.
        const s = await matchStatus(matchId);
        finalTick = s.tick;
        metadata.set("tick", s.tick).set("alive", s.alive);
        if (s.over) {
          metadata.set("status", "over");
          break;
        }
        continue;
      }

      await wait.for({ seconds: tickSeconds });
      await stepBots(matchId, tick - 1);
      await resolveTick(matchId, tick);
      await emitTickTelemetry(matchId, tick);

      const status = await matchStatus(matchId);
      finalTick = status.tick;
      metadata.set("tick", status.tick).set("alive", status.alive);
      if (status.over) {
        metadata.set("status", "over");
        break;
      }
    }

    return { matchId, finalTick };
  },
});
