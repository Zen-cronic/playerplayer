import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../../lib/http";
import { latestTick, nextSeq, submitIntent, INTENTS } from "../../../../lib/arena";

// A human submits a grid intent for their player at the current frontier tick. The
// server assigns the seq (last-write-wins), so a resubmission within a tick supersedes
// the earlier one. Bounded and same-origin like the ingest endpoint.
const Body = z.object({
  matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
  playerId: z.number().int().min(1).max(64),
  intent: z.enum(INTENTS as [string, ...string[]]),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const { matchId, playerId, intent } = parsed.data;

  try {
    const tick = await latestTick(matchId);
    const seq = await nextSeq(matchId, tick, playerId);
    await submitIntent(matchId, tick, playerId, intent as (typeof INTENTS)[number], seq);
    return NextResponse.json({ ok: true, tick });
  } catch {
    return NextResponse.json({ error: "input failed" }, { status: 500 });
  }
}
