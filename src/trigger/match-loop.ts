import { metadata, schemaTask, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { arenaQueue } from "./queues";
import { advanceMatch, matchStatus, loadStepContext } from "../lib/arena";

// The authoritative game clock. A durable per-match task that advances the match
// one tick at a time: it lets bots submit intents, asks ClickHouse to resolve the
// tick (the DB is the server), emits telemetry into the shared game_events
// envelope, and publishes progress via metadata for the Realtime client.
//
// Idempotency is structural and rests on tested code: each tick is one advanceMatch
// call, which advances from the current frontier (latest resolved tick) and emits
// telemetry only when it actually wrote a new tick. A whole-loop retry after a crash
// re-enters run() and continues from wherever the frontier already is — it never
// re-resolves or re-emits a past tick. Bounded by maxTicks and maxDuration.
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

    // Static per-match data (geometry + bot roster) — load once, reuse every tick.
    const ctx = await loadStepContext(matchId);

    // At most maxTicks iterations; the match also ends when matchStatus reports over
    // (clock hit max_ticks, or last player standing in a multiplayer match).
    for (let i = 0; i < maxTicks; i++) {
      const before = await matchStatus(matchId);
      if (before.over) {
        finalTick = before.tick;
        metadata.set("status", "over").set("tick", before.tick);
        break;
      }
      await wait.for({ seconds: tickSeconds });
      await advanceMatch(matchId, ctx);
      const after = await matchStatus(matchId);
      finalTick = after.tick;
      metadata.set("tick", after.tick).set("alive", after.alive);
      if (after.over) {
        metadata.set("status", "over");
        break;
      }
    }

    return { matchId, finalTick };
  },
});
