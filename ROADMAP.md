# ROADMAP — post-hackathon

> **Clearly labelled: nothing in this file was built during the hackathon.**
> It is the honest continuation of what shipped — each item names the seam in
> today's code it would grow from. What *did* ship is in the
> [README](./README.md) and [SCHEMA.md](./SCHEMA.md).

## Authenticated multi-game ingest protocol

Today's `/api/ingest` is a same-origin demo surface: `human-*` run ids, the
demo game's fixed event enum, a hardcoded experiment. It already accepts
bounded custom `props` and a `gameId` into the JSON envelope — the protocol
version replaces the endpoint with per-game API keys, game-defined event
types, per-game experiments, and rate limits. The schema needs nothing: the
envelope (`game_id` + typed universals + `props JSON`) was built for exactly
this.

## Time-bucketed rollups with aligned retention

`game_events` deliberately carries no TTL: `game_heatmap` is an incremental MV
target with no time bucket, and TTL deletions on a source are never subtracted
from an incremental aggregate — expiry would silently corrupt it. The scale
design adds a time bucket to the rollup key, monthly partitions on the raw
firehose, and TTLs whose windows are aligned across raw and rolled-up tables
(raw expires, buckets survive).

## Real multiplayer ingestion

The live-ops lane already streams paced bot telemetry mid-run (~80 events/sec
sustained in the demo) through the same envelope a multiplayer game would use.
The multiplayer version is the ingest protocol above plus sharded run-id
namespaces and sustained-load benchmarks — the read side (heatmaps, deltas,
live panel) needs no changes.

## More engine adapters

The swarm's one engine-specific piece is the documented `HeadlessAdapter`
contract (`src/game/adapter.ts`); this repo ships Phaser's. A Godot headless
adapter or a Unity batch-mode adapter implements `run(opts) → RunResult` and
inherits everything else — the MVs aggregate its telemetry and the same cards
render it. No game gets a bot swarm "for free"; this is the honest per-engine
cost, made as small as we know how to make it.

## Onboarding agent

`describeLevel` already introspects the real Tiled map to ground mutations.
The onboarding agent extends that: point it at a repo, it reads the map/object
layers, proposes the instrumentation points, generates the adapter scaffold,
and emits a migration adding typed JSON path hints for that game's hot fields
— "it learns your game" as a first-run experience.

## Trigger streams for sub-second UI progress

Swarm progress is visible today via `metadata.parent` increments (Trigger
dashboard) and the ClickHouse-polled live panel. The next step is
`chat.stream.writer` custom data parts so the approval card itself shows
"12/36 bots done" mid-turn without polling.

## Postgres OLTP hybrid

ClickHouse stays the analytical spine; a small OLTP tier would hold accounts,
projects, and saved experiment notes if this becomes a product. Deliberately
out of scope for the hackathon build, where ClickHouse-as-primary is the point.
