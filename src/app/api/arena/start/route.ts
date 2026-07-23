import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../../lib/http";
import { createMatch, getGeometry, type PlayerSeed } from "../../../../lib/arena";
import { ARENA_PRESETS, parseAsciiArena, assignSpawns } from "../../../../lib/arena-geometry";
import { BOT_ARCHETYPES } from "../../../../lib/arena-bot";

// Seed a match (geometry + players + tick-0 state) in ClickHouse and return the
// static map for the client to render. The world is then advanced by the durable
// match-loop (production) or the same-origin /step route (local play + e2e).
const Body = z.object({
  preset: z.enum(Object.keys(ARENA_PRESETS) as [string, ...string[]]).default("demo"),
  humans: z.number().int().min(0).max(4).default(1),
  bots: z.number().int().min(0).max(8).default(3),
  maxTicks: z.number().int().min(1).max(2000).default(120),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const { preset, humans, bots, maxTicks } = parsed.data;

  try {
    const arena = parseAsciiArena(ARENA_PRESETS[preset]);
    const total = humans + bots;
    if (total < 1) return NextResponse.json({ error: "need at least one player" }, { status: 400 });
    const starts = assignSpawns(arena, total);
    const matchId = `arena-${crypto.randomUUID()}`;

    const players: PlayerSeed[] = starts.map((s, i) => {
      const playerId = i + 1;
      if (i < humans) return { playerId, kind: "human", x: s.x, y: s.y };
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
      { matchId, room: preset, width: arena.width, height: arena.height, maxTicks, tickMs: 500 },
      arena.cells,
      players,
    );
    const cells = await getGeometry(matchId);
    return NextResponse.json({
      matchId,
      width: arena.width,
      height: arena.height,
      cells,
      humanIds: players.filter((p) => p.kind === "human").map((p) => p.playerId),
    });
  } catch {
    return NextResponse.json({ error: "start failed" }, { status: 500 });
  }
}
