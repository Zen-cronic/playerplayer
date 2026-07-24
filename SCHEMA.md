# SCHEMA.md — the ClickHouse data model, as built

This documents the **current** architecture and the reasoning behind every
choice, following the official
[schema design](https://clickhouse.com/docs/data-modeling/schema-design) and
[data modeling](https://clickhouse.com/docs/data-modeling/overview) guidance.
Where we deviate from a general rule, the deviation is stated with its reason.
The schema is managed by a versioned migration chain (below) — it was evolved
**mid-hackathon** from a demo-game-shaped v1 to the game-agnostic v2 envelope,
with the 684k-row backfill parity-checked before cutover.

## Tables

### `game_events` — the telemetry firehose

```sql
CREATE TABLE game_events (
  game_id       LowCardinality(String) DEFAULT 'tilemap-demo',
  experiment_id String,
  variant       LowCardinality(String),
  run_id        String,
  archetype     LowCardinality(String),
  t             UInt32 CODEC(Delta(4), ZSTD(1)),
  type          LowCardinality(String),
  x             Float32 CODEC(Gorilla, ZSTD(1)),
  y             Float32 CODEC(Gorilla, ZSTD(1)),
  room          LowCardinality(String),
  props         JSON(max_dynamic_paths = 64, health Int8, coins UInt16, detail String),
  inserted_at   DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
) ENGINE = MergeTree
ORDER BY (game_id, experiment_id, variant, run_id, t)
```

- **The envelope split.** Universal fields (identity, time, position, event
  type) are typed columns; **game-specific** fields ride the `props` JSON
  column. The demo game's hot fields are declared as **typed path hints**, so
  `props.coins` is a real `UInt16` subcolumn — columnar speed for this game,
  schemalessness for the next one. Even `windowFunnel` conditions run directly
  on `props.coins`. `max_dynamic_paths = 64` bounds subcolumn explosion if a
  game sends arbitrary props (overflow paths degrade to shared storage, still
  queryable).
- **Key order is query-aligned** and approximately cardinality-ascending:
  `game_id` (1 value today) → `experiment_id` (~20) → `variant` (~2–3 per
  experiment) → `run_id` (~1k) → `t`. One deliberate exception to literal
  low-to-high ordering: `experiment_id` precedes the lower-cardinality
  `variant` because **every** read filters experiment first and `variant`
  never appears in a filter without it — filter alignment beats the cardinality
  rule when they conflict.
- **Two read patterns, one copy:** aggregate heatmaps come from the MV below;
  per-run ghost-trail replay is a primary-key range scan on the full sort-key
  prefix. No duplicate storage, no joins.
- **Codecs:** `t` is monotone within each run → `Delta`; `x/y` are smooth ~10Hz
  positional floats → `Gorilla`; `inserted_at` is near-monotone → `Delta`. All
  wrapped in `ZSTD(1)`.
- **No partitioning.** Partitioning is a data-lifecycle tool, not a query
  optimization; at sub-GB scale it would only multiply part counts. The
  successor design at real scale is monthly partitions — see ROADMAP.
- **No TTL — deliberately.** `game_heatmap` is an *incremental* MV target with
  no time bucket; TTL deletions on the source are never subtracted from it, so
  a raw-events TTL would make the aggregate silently drift wrong over time.
  Correct expiry requires time-bucketed rollups with **aligned** retention —
  that redesign is on the roadmap, and until then the raw table keeps
  everything (fine at this volume).
- **No Nullable anywhere** (in any table): absent values are natural defaults,
  which keeps columns dense and comparisons cheap.
- **`type` is `LowCardinality(String)`, not `Enum8`** — the envelope's whole
  point is that a new game brings new event types without DDL.

### `game_runs` — one row per playthrough

Same key family (`game_id, experiment_id, variant, run_id`); typed universal
outcomes (`seed`, `verdict`, `sim_ms`, `wall_ms`); game-specific summary fields
in `props JSON(coins UInt16, rooms_visited Array(String))`. This is the durable
experiment registry — no TTL.

### `game_heatmap` + `game_heatmap_mv` — generic spatial rollup

```sql
ORDER BY (game_id, experiment_id, variant, room, gx, gy, type)
-- MV: GROUP BY those keys, n = sumSimpleState(toUInt64(1))
```

Insert-time aggregation (`AggregatingMergeTree` +
`SimpleAggregateFunction(sum)`), kept **fully generic**: the MV counts every
`(cell, event-type)` pair instead of hard-coding visit/death/damage/pickup
columns. Reads project what they mean via `sumIf(n, type = '…')`, extra types
can never pollute a result, and any future game's custom events get spatial
aggregation with zero schema work. Measured bonus: the generic narrow rollup is
*smaller* than the v1 wide one (22 KiB vs 30 KiB compressed for the same
underlying events). The before/after delta stays a **single-pass `sumIf`, no
join**.

### `agent_events` — the agent's own telemetry

```sql
ORDER BY (session_id, turn, seq)   -- TTL 90 days
```

Every prompt, tool call/result, approval, and worker error the agent produces,
written fire-and-forget (`wait_for_async_insert = 0`, failures swallowed —
observability must never block a turn; unlike game telemetry, losing a row here
is acceptable by design). `session_id` leads the key because the only
selective filter is the per-session timeline (a pure PK range scan); the
session *list* is a small-table aggregate. This table **keeps** a TTL because
nothing derives from it — the constraint that removed the firehose TTL doesn't
apply. Privacy: user-authored content renders on the public dashboard only when
`AGENT_LOG_PUBLIC=1`; tool digests are URL-stripped at write time so a
ClickHouse error can never leak a host onto a page.

### `watch_reports` — nightly canary verdicts

`ReplacingMergeTree(inserted_at)` read with `FINAL` — idempotent nightly
upserts, unchanged from v1 (it was already right).

### Arena tables — ClickHouse as the game engine

A second, independent surface (`migrations/0004_arena`): a live multiplayer grid
game whose authoritative state ClickHouse *computes*, rather than stores. Tick
N+1 is a pure SQL function of `match_state(N)` + `match_inputs(N)` +
`match_geometry`, so movement, collision tiebreaks, pickups, hazards, and scoring
resolve in one `INSERT … SELECT` (see `src/lib/arena.ts`). Five tables, all new —
nothing above is altered.

```sql
matches         (match_id, room, width, height, max_ticks, tick_ms, created_at)
                ENGINE = MergeTree ORDER BY (match_id)
match_players   (match_id, player_id, kind Enum8('human','bot'), archetype, seed, joined_at)
                ENGINE = MergeTree ORDER BY (match_id, player_id)
match_geometry  (match_id, cell_x, cell_y, kind Enum8('floor','wall','hazard','spawn','coin'))
                ENGINE = MergeTree ORDER BY (match_id, cell_x, cell_y)
match_inputs    (match_id, tick, player_id, seq, intent Enum8('up','down','left','right','stay'), …)
                ENGINE = MergeTree ORDER BY (match_id, tick, player_id, seq)
match_state     (match_id, tick, player_id, x, y, score, alive, inserted_at)
                ENGINE = ReplacingMergeTree(inserted_at) ORDER BY (match_id, tick, player_id)
```

- **`match_id` leads every key** because every read filters exactly one match,
  and usually one tick within it. Same filter-alignment principle as
  `game_events`, applied to a different access pattern.
- **`match_state` is a `ReplacingMergeTree(inserted_at)`, read with `FINAL`.**
  This is what makes concurrent advancers safe: a durable Trigger.dev loop and a
  manual `/step` can both resolve the same tick, and because resolution is
  deterministic they produce **byte-identical rows** that collapse to one per
  player. Idempotence is a property of the engine choice, not of a lock — the
  JS existence check is a fast-path skip, not the correctness guarantee.
- **Coins are not a table.** A coin is static geometry (`kind='coin'`), and
  "consumed" is *derived* from state history — no surviving player has ever stood
  on that cell. Deriving it keeps tick resolution a single write to one table
  instead of a write plus a coin-state reconciliation.
- **`Enum8` here, `LowCardinality(String)` there — deliberately opposite.**
  `game_events.type` is a string because the envelope must accept a new game's
  event types without DDL. The arena's `kind` and `intent` are closed domains the
  resolution SQL depends on by name, so an unexpected value should be a *write
  error*, not a silently-ignored row. Extensibility is right for the firehose;
  strictness is right for the rule set.
- **Codecs follow the same logic as the firehose:** `tick` is monotone within a
  match → `Delta`; `inserted_at` near-monotone → `Delta`; positions and scores
  are small integers → `ZSTD(1)`.

ClickHouse also **renders** this world: `FRAME_SQL` (`src/lib/arena-frame.ts`)
assembles an `<svg>` of the current tick — geometry, remaining coins, every
player — entirely in SQL, served as bytes via `FORMAT RawBLOB`. See
[docs/arena/](./docs/arena/) for the architecture and ADRs.

### `schema_migrations` — the ledger

`ReplacingMergeTree(applied_at) ORDER BY id`, read via `argMax` grouping so the
applied-set is correct even with unmerged duplicate rows — no `FINAL`, no
`OPTIMIZE` needed.

## Migrations

Forward-only, Alembic-style: `migrations/0001_v1_baseline` (the original DDL,
verbatim) → `0002_envelope` (v2 tables) → `0003_backfill_v1_to_v2` →
`0004_arena` (the arena tables above — additive only, no existing table
touched, so it carries no backfill and no parity gate). Properties worth
copying:

- **Single-writer is structural, not conventional.** Only the CLI
  (`pnpm migrate`) applies migrations. App and worker processes call a
  verify-only `ensureMigrations()` that throws when the database is behind or a
  checksum drifted — so a concurrent double-backfill is impossible by
  construction, not by discipline.
- **Checksummed, declarative statements.** Everything that affects the database
  — including the backfill's idempotence guard — is SQL inside the migration,
  covered by its sha256. Editing an applied migration fails hard everywhere.
- **Parity-gated backfill.** The ledger row for 0003 was only written after six
  A/B equality checks passed against live data: row counts (684,857 events /
  977 runs at the time), per-experiment death counts, a props JSON round-trip
  (`sum(coins)/sum(health)` v1 vs `sum(props.coins)/sum(props.health)`), the
  MV totals, and the registry aggregate. These checks are an **apply-time
  gate** (`reverifiable: false`): after the cutover commit v1 freezes while v2
  keeps growing, so re-running raw A/B comparisons would diverge by design —
  `pnpm migrate:verify` reports the gate instead of re-running it.
- **The MV double-count trap.** The backfill INSERT SELECT itself fires
  `game_heatmap_mv`, populating the rollup as a side effect — a naive extra
  "backfill the aggregate" statement would double every count. The parity check
  on MV totals is what turns that silent corruption into a loud failure.
- **No down-migrations.** The rollback is `git revert` of the cutover commit
  against v1 tables that were never touched — strictly safer than reverse DDL.

## Delivery semantics, by lane

| Lane | Path | Guarantee |
| --- | --- | --- |
| Chat swarms & nightly canary | one batched insert at run end, `wait_for_async_insert=1`, `bot-run` retries disabled, idempotency keys on fan-out | exactly-once telemetry (a failed run is a counted `failedRuns`, never a partial double-write) |
| Human browser play | same-origin `/api/ingest`, zod-validated, buffered | at-most-once per batch |
| Live ops (`live-*`) | mid-run chunk streaming, cursor advances only on durable ack, final insert covers the unacked tail | ops-feed grade: one ambiguous chunk can duplicate on a failure path; orphan prefixes possible if a run dies — bounded inside `live-*`, which is excluded from the registry, chat resolution, and all deltas |
| Agent log | fire-and-forget, `wait_for_async_insert=0` | best-effort by design |

Paced (live-lane) runs are additionally **not frame-deterministic** vs flat-out
runs (~2% event drift from timer-vs-setImmediate macrotask interleaving) —
another reason the live lane never feeds matched-seed science, which always
runs flat-out and is byte-identical run-to-run (`pnpm bot` prints a per-run
event digest to prove it).

## The honest storage numbers

Measured at backfill parity (identical 684,857 events in both tables):
`bot_events` (v1) 2.50 MiB compressed at 27× compression; `game_events` (v2)
2.67 MiB at 40×. **The envelope costs ~7% storage** — the JSON column widens
the uncompressed representation (68 → 106 MiB) and the codecs claw most of it
back. We consider that a good trade for schema adaptivity; it is not a
"compression win" and we don't claim one.
