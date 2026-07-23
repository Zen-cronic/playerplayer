// Fail-closed same-origin check, shared by the browser-reachable write endpoints.
// Browsers send Origin on POST (safe or not), so the app's own fetch always carries
// it. A missing Origin is a non-browser client, which has no business writing —
// reject rather than wave through.
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
