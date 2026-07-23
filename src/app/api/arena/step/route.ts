import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../../lib/http";
import { advanceMatch, matchView } from "../../../../lib/arena";

// Advance the match one tick and return the new frontier snapshot. This calls the
// identical resolveTick the durable match-loop uses — exposed here so local play and
// the deterministic e2e can step the world explicitly, with no wall-clock waits.
const Body = z.object({
  matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  try {
    await advanceMatch(parsed.data.matchId);
    return NextResponse.json(await matchView(parsed.data.matchId));
  } catch {
    return NextResponse.json({ error: "step failed" }, { status: 500 });
  }
}
