import { getClickHouse, READ_SETTINGS } from "./clickhouse";

// ClickHouse-as-web-server: a match-state snapshot served as JSON bytes straight
// from ClickHouse via FORMAT RawBLOB. The preferred path uses a dedicated read-only
// user (arena_reader) over HTTP whose SETTINGS PROFILE bakes the Content-Type header
// (a readonly user cannot set http_response_headers per-query — the profile is the
// settings-profile workaround). The CH host lives only in server-side env; the browser
// reaches this only through the same-origin /api/arena/state-blob proxy.

export const SNAPSHOT_SQL = `
SELECT toJSONString(groupArray(map(
  'playerId', toInt64(player_id), 'x', toInt64(x), 'y', toInt64(y),
  'score', toInt64(score), 'alive', toInt64(alive)
))) AS blob
FROM match_state
WHERE match_id = {matchId:String}
  AND tick = (SELECT max(tick) FROM match_state WHERE match_id = {matchId:String})
`;

export interface SnapshotResult {
  blob: string;
  source: "clickhouse-rawblob" | "clickhouse-rawblob-fallback";
}

// Returns the snapshot JSON bytes + which path served them. Never returns or logs
// the CH host. `source` is honest: the fallback (no ARENA_READER_URL) runs the same
// query through the main client and is labelled as such — never presented as the
// dedicated read-only RawBLOB path.
export async function snapshotBlob(matchId: string): Promise<SnapshotResult> {
  const readerUrl = process.env.ARENA_READER_URL;
  if (readerUrl) {
    const u = new URL(readerUrl);
    const auth =
      "Basic " +
      Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
    const base = `${u.protocol}//${u.host}`;
    const res = await fetch(`${base}/?param_matchId=${encodeURIComponent(matchId)}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "text/plain" },
      body: SNAPSHOT_SQL + " FORMAT RawBLOB",
    });
    if (!res.ok) throw new Error(`arena_reader responded ${res.status}`);
    return { blob: (await res.text()).trim(), source: "clickhouse-rawblob" };
  }

  const ch = getClickHouse();
  const rs = await ch.query({
    query: SNAPSHOT_SQL,
    query_params: { matchId },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const [row] = await rs.json<{ blob: string }>();
  return { blob: row?.blob ?? "[]", source: "clickhouse-rawblob-fallback" };
}
