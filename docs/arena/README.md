# ClickHouse Arena

A live multiplayer grid game whose **authoritative state is resolved by ClickHouse SQL**,
with **Trigger.dev as the durable game clock** and Vercel/Next.js hosting the client.
Every tick — movement, collisions, pickups, hazards, scoring — is one deterministic
`INSERT … SELECT`; ClickHouse also renders the live match frame (SVG) and serves it as
bytes.

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — design, diagram, scale numbers, honest fit boundary
- [adr/0001-ch-as-game-engine.md](./adr/0001-ch-as-game-engine.md) — ClickHouse as engine + web-server accent
- [adr/0002-tick-model.md](./adr/0002-tick-model.md) — tables, resolution SQL, determinism proof
- [adr/0003-ch-as-webserver.md](./adr/0003-ch-as-webserver.md) — RawBLOB state snapshot + live SVG frame
- [sql/tick-resolution.sql](./sql/tick-resolution.sql) — the tick-resolution proof in one SQL script

## Where the code lives

| Area | Files |
| --- | --- |
| Schema | `migrations/0004_arena.ts` (matches / players / geometry / inputs / state; `match_state` is a ReplacingMergeTree) |
| Engine | `src/lib/arena.ts` (`RESOLUTION_SQL`, `resolveTick`, `stepBots`, `advanceMatch`, `matchStatus`, telemetry bridge, heatmap) |
| Frame | `src/lib/arena-frame.ts` (`FRAME_SQL` — the SVG rendered in SQL) + `src/app/api/arena/frame` |
| RawBLOB | `src/lib/arena-blob.ts` + `src/app/api/arena/state-blob` |
| Bots | `src/lib/arena-bot.ts` (explorer / rusher / cautious, mulberry32) |
| Geometry | `src/lib/arena-geometry.ts` (ASCII presets + Tiled level parse) |
| Trigger | `src/trigger/match-loop.ts` (durable clock), `src/trigger/arena-match.ts` (launcher) |
| Client | `src/app/arena/page.tsx` + `src/app/api/arena/*` (start / step / input / state / match / state-blob / heatmap / frame) |
| Tests | `scripts/arena-check.ts` (engine), `scripts/arena-bench.ts` (scale), `e2e/arena-multiplayer.spec.ts` |

## Run it locally

```bash
# 1. Local ClickHouse (userspace static binary, no root)
curl https://clickhouse.com/ | sh
./clickhouse server &                      # HTTP 8123

# 2. Apply the schema (forward-only; adds arena tables, touches nothing existing)
CLICKHOUSE_URL=http://127.0.0.1:8123 pnpm migrate up

# 3. Engine correctness + scale
CLICKHOUSE_URL=http://127.0.0.1:8123 pnpm arena:check
CLICKHOUSE_URL=http://127.0.0.1:8123 pnpm arena:bench 24 60

# 4. Play it
CLICKHOUSE_URL=http://127.0.0.1:8123 pnpm dev
#   http://localhost:3000/arena                    (1 human + 3 bots)
#   http://localhost:3000/arena?match=<id>&as=2    (join an existing match in a 2nd tab)

# 5. e2e
E2E_BASE_URL=http://localhost:3000 CLICKHOUSE_URL=http://127.0.0.1:8123 \
  pnpm test:e2e e2e/arena-multiplayer.spec.ts
```

For the RawBLOB read-only path, create the `arena_reader` user (ADR 0003 DDL) and set
`ARENA_READER_URL=http://arena_reader:<pw>@127.0.0.1:8123`; without it the proxy uses a
labelled main-client fallback.
