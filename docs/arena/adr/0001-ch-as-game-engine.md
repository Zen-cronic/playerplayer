# ADR 0001 — ClickHouse as the game engine (and a web-server accent)

Status: accepted.

## Context

ClickHouse Arena makes ClickHouse the authoritative engine of a live multiplayer grid
game, with Trigger.dev as the durable game clock and Vercel/Next.js hosting the client.
Two ClickHouse capabilities underpin the design; this ADR records the decision to lean on
both.

## Decision 1 — ClickHouse as compute, not just storage

The authoritative simulation runs in SQL. Every tick — movement, wall collision,
player-vs-player collision tiebreak, coin pickup, hazard death, scoring — is resolved by a
single `INSERT … SELECT` (see ADR 0002 for the tick model). The database is the
authoritative server, not a passive store: `state(N+1)` is a pure SQL function of
`state(N)` + `inputs(N)` + `geometry`.

## Decision 2 — ClickHouse as a web server (RawBLOB), as a scoped accent

Two read surfaces are served straight from ClickHouse, so the same engine that computes
the world can also hand it to a browser as bytes:

- A `SELECT … FORMAT RawBLOB` returns raw bytes; paired with a response `Content-Type`
  header, ClickHouse serves arbitrary content (JSON, SVG) directly.
- Header syntax uses **doubled single quotes**:
  `SETTINGS http_response_headers = '{''Content-Type'':''application/json''}'`.
- Under `readonly = 1`, setting `http_response_headers` **per query fails**
  (`Code: 164 Cannot modify … in readonly mode`). The fix is to **bake the header into a
  SETTINGS PROFILE** attached to the read-only user, so it is applied with no per-query
  setting change.
- CORS: ClickHouse returns `Access-Control-Allow-Origin: *` automatically when the request
  carries an `Origin` header.

Read-only user shape:

```sql
CREATE SETTINGS PROFILE arena_reader_profile SETTINGS
  http_response_headers = '{''Content-Type'':''application/json; charset=UTF-8''}',
  readonly = 1;
CREATE USER arena_reader IDENTIFIED BY '<strong>' SETTINGS PROFILE arena_reader_profile;
GRANT SELECT ON default.match_state TO arena_reader;
GRANT SELECT ON default.match_geometry TO arena_reader;
```

Privilege boundary (reproduce): `CREATE TABLE` → `Code: 497 Not enough privileges`;
`SELECT FROM system.users` → `Code: 497`; changing a non-profile setting → `Code: 164`.

**Our use:** serve a live match-state snapshot (JSON) and a live match frame (SVG,
rendered in SQL — ADR 0003) straight from ClickHouse, proxied same-origin through Vercel
so the CH host never reaches the browser. This is a scoped accent (two read endpoints of
seven), not the whole architecture: the app is mostly ordinary same-origin routes over
the `@clickhouse/client`, and the thesis is ClickHouse-as-compute.

## Scope boundaries

- **No OLTP sidecar** — the arena keeps all authoritative state in ClickHouse; there is no
  separate transactional store this run.
- **ClickHouse is never exposed directly to the browser** — every CH read is proxied
  same-origin; the CH host is a server-side secret (inherited security rule).

## Honest claim boundary

ClickHouse is the **authoritative game server** (world state + tick rules in SQL);
Trigger.dev is the **game clock**; Vercel hosts the **client + rendering**. We never claim
"the game renders in ClickHouse" or "no application code" — input capture, bot policy, and
loop orchestration are application code. The claim is that the **authoritative
simulation** is computed by ClickHouse SQL — and, as a deliberate accent, two read
surfaces are served as bytes straight from ClickHouse.
