# ADR 0003 — ClickHouse as web server: the RawBLOB state endpoint

Status: accepted. Proven on a real read-only user on local CH 26.7.

## The pattern

A match-state snapshot is served as JSON **straight from ClickHouse** via
`FORMAT RawBLOB`, behind a same-origin Vercel proxy so the CH host never reaches the
browser. Code: `src/lib/arena-blob.ts` + `src/app/api/arena/state-blob/route.ts`.

## The read-only user + settings profile (operator DDL)

A `readonly = 1` user **cannot** set `http_response_headers` per query (it returns
`Code: 164`). The workaround, confirmed against ClickHouse 26.7,
is to bake the header into a **SETTINGS PROFILE** attached to the user. Exact DDL
that was run and verified locally (operator: change the password, run against the
cloud CH as an admin):

```sql
CREATE SETTINGS PROFILE arena_reader_profile SETTINGS
  http_response_headers = '{''Content-Type'':''application/json; charset=UTF-8''}' CONST,
  -- Caps baked into the profile (readonly=1 blocks per-query settings, so they
  -- cannot be sent on the request — see the Code:164 evidence below). These bound a
  -- runaway query to a clean pre-stream failure, defence-in-depth against a
  -- mid-stream exception being appended to a 200 body.
  max_result_rows = 100000 CONST,
  max_execution_time = 10 CONST,
  result_overflow_mode = 'throw' CONST,
  readonly = 1;

CREATE USER arena_reader IDENTIFIED BY '<strong-password>' SETTINGS PROFILE arena_reader_profile;
GRANT SELECT ON default.match_state TO arena_reader;
GRANT SELECT ON default.match_geometry TO arena_reader;
```

Notes:
- `CONST` marks the header setting immutable so even the profile's user can't change it.
- Password must meet Cloud complexity (≥12 chars, digit, uppercase, special).
- Grant only the arena read tables — nothing else.

## The snapshot query (served as RawBLOB)

```sql
SELECT toJSONString(groupArray(map(
  'playerId', toInt64(player_id), 'x', toInt64(x), 'y', toInt64(y),
  'score', toInt64(score), 'alive', toInt64(alive)
))) AS blob
FROM match_state
WHERE match_id = {matchId:String}
  AND tick = (SELECT max(tick) FROM match_state WHERE match_id = {matchId:String})
FORMAT RawBLOB
```

Sent over HTTP with the SQL in the **body** and the param in the **URL**
(`/?param_matchId=…`) — mixing the query and params in a form body makes ClickHouse
append the param to the SQL (a `SYNTAX_ERROR` we hit and fixed).

## The live SVG frame (rendered in SQL)

The same read-only user serves a *computed* surface, not just a stored payload:
`POST /api/arena/frame` returns an `<svg>` of the current tick — geometry cells, the
coins still on the board (derived exactly like `coinsRemaining`), and every player at
the frontier — assembled entirely in ClickHouse by `FRAME_SQL`
(`src/lib/arena-frame.ts`) and emitted with `FORMAT RawBLOB`. So the engine that
*resolves* each tick in SQL also *draws* it in SQL, from the same tables — the
`arena_reader` grants (`match_state` + `match_geometry`) already cover it, so no new DDL.

The `/arena` "Rendered in ClickHouse" toggle fetches this frame each tick through the
same same-origin proxy and shows it as an inert `<img>` (a `blob:` URL, so nothing in
the bytes can execute or reach out). `renderFrame` reuses the preferred-`arena_reader`
+ honest-fallback shape of the snapshot, and an `assertSvg` guard (require a leading
`<svg`, truncate at the last `</svg>`) strips any trailing exception bytes before they
reach the client — the SVG analogue of `assertSnapshot`. The proxy stamps
`Content-Type: image/svg+xml`.

## Verified evidence (local, real arena_reader user)

- **RawBLOB serves JSON:** `HTTP/1.1 200 OK`, `Content-Type: application/json; charset=UTF-8`
  (from the profile), body `[{"playerId":1,"x":1,"y":1,"score":0,"alive":1}, …]`.
- **CORS open on an Origin request:** `Access-Control-Allow-Origin: *`.
- **Write rejected:** `CREATE TABLE …` → `Code: 497. … Not enough privileges … (ACCESS_DENIED)`.
- **Setting change rejected:** `?max_result_rows=1` → `Code: 164. Cannot modify 'max_result_rows' setting in readonly mode. (READONLY)`.

## The same-origin proxy

`POST /api/arena/state-blob` (same-origin, zod-guarded) calls `snapshotBlob(matchId)`:

1. **Preferred path** — if `ARENA_READER_URL` is set (e.g.
   `http://arena_reader:<pw>@host:8123`): the server fetches the CH RawBLOB endpoint
   as `arena_reader` and returns the bytes. Response header `X-Arena-Source:
   clickhouse-rawblob`. The CH host lives only in server-side env.
2. **Fallback** — if `ARENA_READER_URL` is unset: the same query runs through the
   main client, labelled `X-Arena-Source: clickhouse-rawblob-fallback`. Honest — never
   presented as the dedicated read-only path.

Verified: the proxy response contains no host, port, credentials, or cloud hostname
(checked in the e2e via `assertNoHost` and a grep for `8123`/`127.0.0.1`/`arena_reader`).

## Security review outcome

An adversarial security review of the arena API + proxy confirmed the
host-never-reaches-client rule holds on every error path (all routes use a bare
generic `catch` that never echoes the CH exception, which can embed `CLICKHOUSE_URL`),
same-origin is fail-closed on every write route, all bodies are zod-bounded, every CH
query is parametrized (no SQL injection), and the `matchId` in the proxy fetch is
regex-restricted + `encodeURIComponent`-ed (no SSRF/param injection). One MEDIUM was
fixed: the proxy now **validates the RawBLOB body is a JSON array** (`assertSnapshot`
in `arena-blob.ts`) before returning it, so a ClickHouse mid-stream exception appended
to a 200 body can never reach the browser. The profile caps above are the companion
defence-in-depth.

Accepted low-severity notes (inherent to the account-less game design, not disqualifiers):
`/input` has no player-ownership binding (any same-origin client can move any player);
match reads are gated only by the unguessable `arena-${uuid}` id; `/start` has no rate
limit. Fine for a demo; a productionized version would add a session→player binding and
a per-origin rate limit.

## Operator setup (morning)

1. As an admin on the cloud CH, run the DDL above with a real password.
2. Set `ARENA_READER_URL=http://arena_reader:<pw>@<cloud-host>:8123` in the Vercel/
   Trigger env (server-side only — never `NEXT_PUBLIC_*`).
3. The proxy switches to the `clickhouse-rawblob` path automatically.
