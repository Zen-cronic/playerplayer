import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../../lib/http";
import { getArenaHeatmap } from "../../../../lib/arena";

// Per-cell activity density for a match, from the existing game_heatmap MV — the
// analytics reuse win, surfaced to the client. Read-only; same-origin.
const Body = z.object({
  matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  try {
    return NextResponse.json({ cells: await getArenaHeatmap(parsed.data.matchId) });
  } catch {
    return NextResponse.json({ error: "heatmap failed" }, { status: 500 });
  }
}
