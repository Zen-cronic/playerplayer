import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../../lib/http";
import { matchView } from "../../../../lib/arena";

// The dynamic snapshot (players, coins, tick, status) the client polls to render the
// CH-authoritative world. Reads only; still same-origin to keep the surface tight.
const Body = z.object({
  matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  try {
    return NextResponse.json(await matchView(parsed.data.matchId));
  } catch {
    return NextResponse.json({ error: "state failed" }, { status: 500 });
  }
}
