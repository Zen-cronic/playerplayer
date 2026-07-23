import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../../lib/http";
import { snapshotBlob } from "../../../../lib/arena-blob";

// Same-origin proxy for the ClickHouse-served match-state snapshot. Fetches the
// FORMAT RawBLOB bytes from ClickHouse server-side and returns them to the browser,
// so the CH host never reaches the client. The X-Arena-Source header reports which
// path served it (dedicated read-only user vs main-client fallback) — never the host.
const Body = z.object({
  matchId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{2,63}$/),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  try {
    const { blob, source } = await snapshotBlob(parsed.data.matchId);
    return new NextResponse(blob, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "x-arena-source": source },
    });
  } catch {
    return NextResponse.json({ error: "snapshot failed" }, { status: 500 });
  }
}
