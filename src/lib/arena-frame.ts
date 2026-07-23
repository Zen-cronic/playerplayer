import { getClickHouse, READ_SETTINGS } from "./clickhouse";

// ClickHouse-as-live-renderer: the same engine that resolves each tick in SQL also
// DRAWS the frame. FRAME_SQL assembles an <svg> of the authoritative world — geometry
// cells, the coins still on the board, and every player at the frontier tick — entirely
// inside ClickHouse, served as bytes via FORMAT RawBLOB. The database doesn't just
// return state; it renders a picture of the world it just simulated.
//
// The preferred path uses the read-only arena_reader user over HTTP (its profile already
// grants SELECT on match_state + match_geometry — the two tables the frame reads, so no
// new DDL). The CH host lives only in server-side env; the browser reaches this only
// through the same-origin /api/arena/frame proxy, which restamps the Content-Type.

// Pixel geometry of the rendered grid. These are trusted constants, inlined into the
// SQL as literals (never user input) so the coordinate arithmetic stays in ClickHouse.
const U = 22; // cell edge
const HALF = 11; // cell centre offset (U/2)
const PR = 8; // player token radius
const CR = 4; // coin radius
const FS = 11; // player-label font-size
// Player palette mirrors PLAYER_COLORS in src/app/arena/page.tsx (kept in sync by hand).
const PALETTE = "['#d8f24b','#72d7ff','#ffb45e','#c9a9ff','#ff7898','#83e8c2','#f9e46d','#ff9c74']";

// One statement, one column `blob`: an <svg> built from geometry + frontier state +
// derived remaining coins. {matchId} and {humanId} are ClickHouse params (safe); the
// pixel constants above are inlined. Coins are derived exactly like coinsRemaining() —
// a coin cell no surviving player has ever stood on — so no coin table is needed.
export const FRAME_SQL = `
WITH
  geo AS (
    SELECT cell_x, cell_y, kind FROM match_geometry WHERE match_id = {matchId:String}
  ),
  frontier AS (
    SELECT max(tick) AS t FROM match_state WHERE match_id = {matchId:String}
  ),
  st AS (
    SELECT player_id, x, y, alive,
           arrayElement(${PALETTE}, ((player_id - 1) % 8) + 1) AS color
    FROM match_state FINAL
    WHERE match_id = {matchId:String} AND tick = (SELECT t FROM frontier)
    ORDER BY player_id
  ),
  coins AS (
    SELECT cell_x, cell_y FROM geo
    WHERE kind = 'coin'
      AND (cell_x, cell_y) NOT IN (
        SELECT x, y FROM match_state
        WHERE match_id = {matchId:String} AND tick >= 1 AND tick <= (SELECT t FROM frontier) AND alive = 1
      )
  )
SELECT concat(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ',
  toString((ifNull((SELECT max(cell_x) FROM geo), 0) + 1) * ${U}), ' ',
  toString((ifNull((SELECT max(cell_y) FROM geo), 0) + 1) * ${U}),
  '" width="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" font-family="ui-monospace,monospace">',
  '<rect x="0" y="0" width="100%" height="100%" fill="#0a0f18"/>',
  (SELECT arrayStringConcat(groupArray(concat(
     '<rect x="', toString(cell_x * ${U}), '" y="', toString(cell_y * ${U}),
     '" width="${U}" height="${U}" fill="',
     multiIf(kind = 'wall', '#1b2432', kind = 'hazard', '#48182a', kind = 'spawn', '#123329', '#0e1622'),
     '" stroke="#0a0f18"/>'
   )), '') FROM geo),
  (SELECT arrayStringConcat(groupArray(concat(
     '<circle cx="', toString(cell_x * ${U} + ${HALF}), '" cy="', toString(cell_y * ${U} + ${HALF}),
     '" r="${CR}" fill="#f7d354"/>'
   )), '') FROM coins),
  (SELECT arrayStringConcat(groupArray(concat(
     '<circle cx="', toString(x * ${U} + ${HALF}), '" cy="', toString(y * ${U} + ${HALF}),
     '" r="${PR}" fill="', color, '" opacity="', if(alive = 1, '1', '0.25'), '"',
     if(player_id = {humanId:Int32}, ' stroke="#ffffff" stroke-width="2"', ''), '/>',
     '<text x="', toString(x * ${U} + ${HALF}), '" y="', toString(y * ${U} + ${HALF} + 4),
     '" text-anchor="middle" font-size="${FS}" font-weight="700" fill="#06121f">',
     toString(player_id), '</text>'
   )), '') FROM st),
  '</svg>'
) AS blob
`;

export interface FrameResult {
  svg: string;
  source: "clickhouse-rawblob" | "clickhouse-rawblob-fallback";
}

// Validate the bytes are an SVG document before they can reach the browser. ClickHouse
// can return HTTP 200 and then append an exception to a FORMAT response on a mid-stream
// error (memory/time cap, shard failure); such text can embed host:port. Truncating at
// the last </svg> strips any trailing bytes, and a non-<svg> prefix throws — the route's
// generic catch turns it into a 500, so an upstream exception string never surfaces.
function assertSvg(raw: string): string {
  const s = raw.trimStart();
  if (!s.startsWith("<svg")) throw new Error("unexpected frame shape");
  const end = s.lastIndexOf("</svg>");
  if (end === -1) throw new Error("unterminated svg");
  return s.slice(0, end + "</svg>".length);
}

// Returns the SVG bytes + which path served them. Never returns or logs the CH host.
// `source` is honest: the fallback (no ARENA_READER_URL) runs the same query through the
// main client and is labelled as such — never presented as the dedicated RawBLOB path.
export async function renderFrame(matchId: string, humanId = -1): Promise<FrameResult> {
  const readerUrl = process.env.ARENA_READER_URL;
  if (readerUrl) {
    const u = new URL(readerUrl);
    const auth =
      "Basic " +
      Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
    const base = `${u.protocol}//${u.host}`;
    const res = await fetch(
      `${base}/?param_matchId=${encodeURIComponent(matchId)}&param_humanId=${encodeURIComponent(String(humanId))}`,
      {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "text/plain" },
        body: FRAME_SQL + " FORMAT RawBLOB",
      },
    );
    if (!res.ok) throw new Error(`arena_reader responded ${res.status}`);
    return { svg: assertSvg((await res.text()).trim()), source: "clickhouse-rawblob" };
  }

  const ch = getClickHouse();
  const rs = await ch.query({
    query: FRAME_SQL,
    query_params: { matchId, humanId },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const [row] = await rs.json<{ blob: string }>();
  return { svg: assertSvg(row?.blob ?? ""), source: "clickhouse-rawblob-fallback" };
}
