import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../../lib/http";
import { renderFrame } from "../../../../lib/arena-frame";

// Same-origin proxy for the ClickHouse-rendered match frame. ClickHouse assembles the
// <svg> in SQL and returns it via FORMAT RawBLOB; this route fetches those bytes
// server-side and returns them with an image/svg+xml Content-Type, so the CH host never
// reaches the client. The X-Arena-Source header reports which path drew it (dedicated
// read-only user vs main-client fallback) — never the host.
const Body = z.object({
  matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
  humanId: z.number().int().optional(),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  try {
    const { svg, source } = await renderFrame(parsed.data.matchId, parsed.data.humanId ?? -1);
    return new NextResponse(svg, {
      status: 200,
      headers: { "content-type": "image/svg+xml; charset=utf-8", "x-arena-source": source },
    });
  } catch {
    return NextResponse.json({ error: "frame failed" }, { status: 500 });
  }
}
