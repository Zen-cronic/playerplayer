import { metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { createMatch, type PlayerSeed } from "../lib/arena";
import { ARENA_PRESETS, parseAsciiArena, assignSpawns } from "../lib/arena-geometry";
import { BOT_ARCHETYPES } from "../lib/arena-bot";
import { matchLoop } from "./match-loop";

// Launch a match: seed geometry + players into ClickHouse, then start the durable
// game clock (matchLoop). Human players (ids 1..humans) submit intents through the
// same-origin API; bots (ids after) act inside the loop. This is the entry point the
// dashboard/API triggers to start a demo — one all-bot match is a fully autonomous
// showcase of the CH-authoritative world under a Trigger-driven clock.
export const startArenaMatch = schemaTask({
  id: "arena-start-match",
  schema: z.object({
    matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
    preset: z.enum(Object.keys(ARENA_PRESETS) as [string, ...string[]]).default("demo"),
    humans: z.number().int().min(0).max(4).default(0),
    bots: z.number().int().min(0).max(8).default(4),
    maxTicks: z.number().int().min(1).max(2000).default(120),
    tickSeconds: z.number().min(0.2).max(5).default(0.5),
  }),
  run: async ({ matchId, preset, humans, bots, maxTicks, tickSeconds }) => {
    const arena = parseAsciiArena(ARENA_PRESETS[preset]);
    const total = humans + bots;
    if (total < 1) throw new Error("a match needs at least one player");
    const starts = assignSpawns(arena, total);

    const players: PlayerSeed[] = starts.map((s, i) => {
      const playerId = i + 1;
      if (i < humans) {
        return { playerId, kind: "human", x: s.x, y: s.y };
      }
      const botIndex = i - humans;
      return {
        playerId,
        kind: "bot",
        archetype: BOT_ARCHETYPES[botIndex % BOT_ARCHETYPES.length],
        seed: `${matchId}:${playerId}`,
        x: s.x,
        y: s.y,
      };
    });

    await createMatch(
      { matchId, room: preset, width: arena.width, height: arena.height, maxTicks, tickMs: Math.round(tickSeconds * 1000) },
      arena.cells,
      players,
    );

    const handle = await matchLoop.trigger({ matchId, maxTicks, tickSeconds });
    metadata.set("matchId", matchId).set("loopRunId", handle.id).set("players", players.length);

    return { matchId, loopRunId: handle.id, players: players.length, humans, bots };
  },
});
