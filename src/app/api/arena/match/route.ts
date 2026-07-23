import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../../lib/http";
import { getMatchInfo, getGeometry } from "../../../../lib/arena";

// Join info for an existing match: the static geometry + which human ids exist, so a
// second browser can render the same world and control a specific player. Read-only.
const Body = z.object({
  matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  try {
    const info = await getMatchInfo(parsed.data.matchId);
    if (!info.exists) return NextResponse.json({ error: "no such match" }, { status: 404 });
    const cells = await getGeometry(parsed.data.matchId);
    return NextResponse.json({ matchId: parsed.data.matchId, width: info.width, height: info.height, cells, humanIds: info.humanIds });
  } catch {
    return NextResponse.json({ error: "match lookup failed" }, { status: 500 });
  }
}
