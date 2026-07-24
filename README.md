# PlayerPlayer

**The agent that re-runs your level to prove the fix.**

A chat agent for game designers, built on [Trigger.dev](https://trigger.dev)
`chat.agent()` and [ClickHouse](https://clickhouse.com) for the ClickHouse ×
Trigger.dev AI Hackathon 2026 — *"Beyond the Wall of Text."*

Ask **"where do runs die on this level?"** and it dispatches a swarm of headless
bots to play the level, records ~10 Hz positional telemetry into ClickHouse, and
answers with a **death heatmap** drawn over your actual map — not a paragraph.
Ask **"the coins are luring players into the slime room — what if I move them to
the safe area?"** and it mutates the level (with your approval), re-runs the swarm
on matched seeds, and renders the **before/after delta heatmap** that proves the
fix worked: **the death rate falls from ~50% to ~22%** (nearly 30 points, over 100
matched runs). Ask instead to
just *move the slime off the doorway* and it proves the opposite — the death rate
barely moves, the deaths only relocate, because the enemy chases wherever you
place it. The tool tells you which of your fixes actually work.

The agent doesn't query a canned dataset — it acts to create one. Each swarm run
and level mutation *generates* the telemetry ClickHouse then aggregates, so the
agent answers a what-if by running the experiment, not by looking one up. The
answer is the product: every reply is a chart you can click into, not text about
a chart.

## The loop

1. **Ask.** "Where do runs die?" → the agent queries the aggregated heatmap.
2. **Explore.** Click a hotspot → it replays the individual runs that died there
   as animated ghost trails, straight off the telemetry by primary key.
3. **Hypothesize.** "What if I move that enemy?" → the agent proposes a concrete
   level mutation and **asks for approval before spending compute** (the
   human-in-the-loop gate).
4. **Prove.** On approval it re-runs the swarm on the *same seeds* and renders
   the delta: green where deaths dropped, red where they rose, with a verdict
   chip (`improved` / `no clear change` / `worse`) and the run count behind it.
5. **Play it yourself.** Play the level in the browser and ask *"how did I do
   versus the swarm?"* — your run is drawn as a ghost trail over the bots'
   deaths, with the archetype breakdown of who dies where you died.

## How ClickHouse is used (primary database)

ClickHouse is the only datastore. It carries the telemetry firehose *and* every
analytical view the chat renders — no OLTP tier in the hot path. The schema is a
**game-agnostic envelope** evolved mid-hackathon through a versioned migration
chain (see [SCHEMA.md](./SCHEMA.md) for every choice with rationale):

- **`game_events`** — `MergeTree` ordered by
  `(game_id, experiment_id, variant, run_id, t)` with per-column codecs
  (`Delta`/`Gorilla`/`ZSTD`). Universal fields are typed columns; game-specific
  fields ride a **`JSON` column with typed path hints**
  (`props JSON(health Int8, coins UInt16, detail String)`) — schemaless for the
  next game, columnar-fast for this one (`props.coins` reads back as a real
  `UInt16`, and even `windowFunnel` conditions run on it). One table serves two
  very different reads from a single copy: the aggregate heatmap (via the MV
  below) **and** per-run replay — clicking a death cell is a **primary-key range
  scan** over one run's ~10 Hz stream.
- **`game_heatmap`** — `AggregatingMergeTree` fed by an **insert-time
  materialized view**, deliberately **generic**: it counts every `(cell, type)`
  pair, so any event type any game emits gets spatial aggregation with zero
  schema work; reads project visits/deaths/damage/pickups with `sumIf`. The
  generic rollup is *smaller* than the wide v1 table it replaced.
- **Delta** = a single-pass `sumIf` over `game_heatmap` comparing `baseline` vs
  `mutated` in one query — **no joins**.
- **`agent_events`** — the agent's own observability store: every prompt, tool
  call, approval, and worker error, queryable like any other telemetry
  (90-day TTL; surfaced on `/dashboard/agent`).
- **`watch_reports`** — `ReplacingMergeTree` (read with `FINAL`) stores the
  nightly canary's verdicts idempotently.
- **Versioned migrations** — an Alembic-style forward-only chain
  (`migrations/0001…0004`) with a `schema_migrations` ledger, sha256 checksums,
  and **parity-checked backfill**: the 684k-row v1→v2 copy was gated on six A/B
  equality checks (counts, per-experiment deaths, props round-trip, MV totals)
  before the cutover commit. Only the CLI applies migrations; app processes
  verify and refuse to run against a stale schema.
- **Ingestion** uses asynchronous inserts (`async_insert=1`) with per-run
  client-side buffering, so a swarm of bots each emitting ~10 Hz never causes
  part explosion. Live-lane bots additionally **stream event chunks mid-run**
  (cursor-on-durable-ack, covered tail — see `/dashboard/live`).
- **Human runs land in the same `game_events` table** as `archetype='human'` —
  so the ghost-overlay comparison is just the existing heatmap MV plus a
  primary-key replay, keyed on a new archetype value.

Measured on ClickHouse Cloud during development: **over 700,000 events across
1,000+ runs** (and still growing as the swarm runs). Heatmap reads over the
materialized-view aggregate return in **≈70 ms at rest, and hold a median of
~85 ms (p90 ~140 ms) even during active ingest** (measured while a loader wrote
~900 rows/run continuously); the live-ops panel sustains **~80 events/sec of
mid-run streaming** from three concurrent paced bots. The live figures are shown
in the app header and on every card footer
(`N runs · M cells · <table (engine)> · Xms`), so a judge can verify the
database is doing real work, not decorating a toy table.

## How Trigger.dev is used (orchestration)

- **`chat.agent()`** (task `playtest-chat`) is the durable conversation. Its
  tools are the whole product surface: `describeLevel`, `runSwarm`,
  `queryHeatmap`, `queryDelta`, `compareMyRun`, `queryFunnel`, `watchReports`,
  `listExperiments`, `suggestFollowUps`.
- **Swarm fan-out** — `runSwarm` triggers `run-experiment`, which uses
  **`batchTriggerAndWait`** to fan out one `bot-run` task per bot (matched seeds
  across `baseline` and `mutated` variants) and waits for the cohort. Each
  `bot-run` boots a headless Phaser instance faster-than-realtime, buffers
  telemetry, and batch-inserts it. Ingestion is retry-safe: each child carries a
  run-scoped **`idempotencyKey`** so a parent retry re-uses runs instead of
  re-fanning-out, and `bot-run` doesn't retry (a failed run is tolerated as a
  `failedRuns` in the cohort) — so a retry never double-counts the heatmap.
- **Human-in-the-loop** — `runSwarm` is declared with **`needsApproval: true`**.
  Mutating a level and spending compute pauses for the designer to Approve or
  Deny in the UI; the run resumes on the approval token. This is the moment the
  agent asks permission before acting.
- **Scheduled proactivity** — `regression-watch` is a **`schedules.task()`**
  cron that re-runs the swarm nightly on a deterministic fixed seed (zero-noise
  canary) and writes a visual diff to `watch_reports`, surfaced on the
  dashboard.
- **Bounded queues** — bot fan-outs ride two dedicated queues
  (`swarm-bots` ×6, `live-bots` ×3) budgeted exactly against the free plan's 10
  concurrent runs, so a chat-approved swarm and the live demo never starve each
  other.
- **Live progress metadata** — every `bot-run` child increments
  `metadata.parent` (`runsCompleted`), so chat swarms, the nightly canary, and
  live waves all show mid-flight progress in the Trigger.dev dashboard; parents
  tag themselves `exp_<id>` for ops navigability.
- **`live-swarm`** — a `schemaTask` with zod-bounded waves of paced, streaming
  bots (the `/dashboard/live` demo); the public launch action is guarded by a
  data-enforced cooldown plus a global idempotency window.
- **Agent observability producers** — a per-turn **tools factory** wraps every
  chat tool in closures that log calls/results/approvals to ClickHouse, and
  `onTurnStart`/`onTurnComplete` lifecycle hooks log prompts and responses;
  `bot-run.onFailure` logs worker errors. ClickHouse observes the agent itself.
- **Realtime** — the frontend uses `useTriggerChatTransport`, so tool results,
  token streams, and the approval gate flow to the popover live.
- **Context discipline** — read tools return compact `toModelOutput` digests
  (totals + hotspots named by nearest object, e.g. *"3 tiles from slime #0"*)
  rather than raw cell arrays, so the model's context stays small and it answers
  with the rendered card instead of re-narrating coordinates.

## Arena — ClickHouse as the game engine

A second, self-contained exhibit at **`/arena`**, sharing no code with the
copilot: a live multiplayer grid game whose authoritative state ClickHouse
doesn't just *store* but **computes**.

- **The tick is one SQL statement.** State at tick N+1 is a pure function of
  `match_state(N)` + `match_inputs(N)` + `match_geometry`, so movement, collision
  tiebreaks (`row_number() OVER (PARTITION BY …)` resolves two players reaching
  the same cell), coin pickups, hazard deaths, and scoring all resolve in a
  single deterministic `INSERT … SELECT`. There is no application-side game loop
  — the database *is* the engine (`RESOLUTION_SQL` in `src/lib/arena.ts`).
- **The database draws the frame.** `FRAME_SQL` (`src/lib/arena-frame.ts`)
  assembles an `<svg>` of the current tick — geometry cells, the coins still on
  the board, every player token — entirely in SQL via
  `arrayStringConcat(groupArray(concat(…)))`, served as bytes with
  `FORMAT RawBLOB` through a read-only user and a same-origin proxy. The
  **"Rendered in ClickHouse"** toggle on `/arena` swaps the React grid for that
  SQL-drawn image. ClickHouse renders a picture of the world it just simulated.
- **Trigger.dev is the durable clock.** `match-loop` advances the match with
  `wait.for` between ticks, so an interrupted match resumes and converges on a
  byte-identical final state — proven by test, and safe because deterministic
  resolution plus `ReplacingMergeTree` makes a doubly-resolved tick collapse to
  one row per player instead of corrupting the match.

Schema in [SCHEMA.md](./SCHEMA.md); design, diagram, ADRs, and the honest fit
boundary (where an OLAP engine stops being the right tool for a game loop) in
[docs/arena/](./docs/arena/).

## Install into your own game (SDK)

The chat widget is extracted as an npm package, **`@playerplayer/sdk`**, and this
app dogfoods it — the game popover, `/chat`, and the dashboard drill-in all
import the package, not the source.

```tsx
import { CopilotPopover } from "@playerplayer/sdk";
import "@playerplayer/sdk/styles.css"; // compiled utilities — no Tailwind required

<CopilotPopover
  accessToken={({ chatId }) => mintChatAccessToken(chatId)}   // your server action
  startSession={({ chatId, clientData }) =>                    // your server action
    startChatSession({ chatId, clientData })}
  onDrillDown={fetchCulpritRuns}                               // optional: hotspot → replay
/>
```

> **Honest scope.** The **popover and play-telemetry capture install into any
> web game.** What needs a per-engine adapter is the *bot-swarm simulation* —
> running your level headless to generate the counterfactual. This repo ships a
> **Phaser** headless adapter; other engines need their own. We do not claim any
> game gets a bot swarm for free.

The swarm's engine seam is a single interface, `HeadlessAdapter`
(`src/game/adapter.ts`): given a seed, archetype, and level, `run()` drives one
headless playthrough and returns telemetry in the shared shape. Everything
downstream — the ClickHouse firehose, the materialized views, and every card the
chat renders — is engine-agnostic and consumes that telemetry unchanged, so a
new engine implements only `run()`. The repo ships the Phaser adapter
(`phaserAdapter`), and the swarm's bot-run task drives the game exclusively
through it.

> The package is **published on npm as
> [`@playerplayer/sdk`](https://www.npmjs.com/package/@playerplayer/sdk)** (MIT,
> six files, no runtime dependencies — peers only). This app imports the package
> rather than the source, so the published integration path is the one actually
> exercised.

## Architecture

- **`/`** — the vendored Phaser game, playable in the browser, with the copilot
  popover mounted through the SDK. Your run streams into the same ClickHouse
  table the bots write to.
- **`/chat`** — the full-screen chat surface.
- **`/dashboard`** — mission control, four modules:
  **Overview** (experiment registry + nightly canary feed, with a per-experiment
  drill-in that reuses the chat's cards and shows the experiment's **lineage**:
  prompt → approval → swarm → verdict); **Runs** (every playthrough, filterable,
  with per-run ghost-trail replay + event timeline); **Agent log** (every chat
  session and tool call, read back from ClickHouse — prompts render only when
  the operator sets `AGENT_LOG_PUBLIC=1`, since the dashboard is public);
  **Live ops** (launch a wave of paced bots and watch events/sec, active runs,
  and hot cells update as they stream — the data shape of a multiplayer game).
- **`/arena`** — the ClickHouse-as-game-engine exhibit: a live multiplayer match
  whose every tick is resolved (and optionally drawn) by SQL, clocked by a
  durable Trigger.dev loop.

Two clocks, one codebase: bots run headless Phaser on a time-warped RAF for
faster-than-realtime simulation; the human game runs the same modules on a real
RAF in the browser. The demo runs on Level 1, but the swarm boots any of the
pack's five levels from one code path — `bot-run` just takes the level id.

## Local development

```bash
pnpm install
cp .env.template .env   # fill in Trigger.dev + ClickHouse credentials
pnpm migrate            # apply the ClickHouse migration chain (fresh env: creates everything)
pnpm dev:trigger        # terminal 1: Trigger.dev dev server (worker)
pnpm dev                # terminal 2: Next.js (builds the SDK, then serves the app)
```

Requires a ClickHouse instance and a Trigger.dev project. The schema lives in
the versioned chain under `migrations/` (`pnpm migrate:status` shows the
ledger; `pnpm migrate:verify` re-runs re-runnable checks — the backfill's
parity checks are an apply-time gate, since v1 freezes at cutover while v2
keeps growing); only the CLI applies migrations — app processes verify and
refuse to run behind.

### Reproduce & verify

Nothing here is a fixture. The before/after experiments in the demo are real,
re-runnable matched-seed A/Bs:

```bash
pnpm seed:demo    # regenerates the demo experiments (coins-to-safety, crowd-the-corridor)
pnpm test:e2e     # drives the real flows: chat read, approval gate, ghost overlay, delta card
pnpm bot          # runs one headless bot and prints its telemetry
pnpm arena:check  # proves one arena tick resolves deterministically in SQL (local CH only)
```

The Trigger.dev leg has its own manual smoke checks, each exercising one task
end-to-end against a running `pnpm dev:trigger` worker:

```bash
pnpm smoke:trigger     # one bot-run: headless sim → batched ClickHouse insert
pnpm smoke:experiment  # a small matched-seed A/B through batchTriggerAndWait
pnpm smoke:watch       # the nightly regression canary (schedules.task)
```

`seed:demo` moves the coins out of the slime room and re-runs the swarm — the
death rate really does fall ~25 points; crowd the chokepoint and it rises. The
numbers on every card are the live query's, shown in the provenance footer.

## What's next

The post-hackathon direction is written up in [ROADMAP.md](./ROADMAP.md)
(clearly labelled — none of it was built during the event): an authenticated
multi-game ingest protocol, time-bucketed rollups with aligned retention, more
engine adapters over the `HeadlessAdapter` seam, and an onboarding agent that
introspects your map and generates the adapter for you. Today's honest scope:
the popover + telemetry install anywhere; the ingest endpoint accepts bounded
**custom telemetry properties** (`gameId` + per-event `props` into the JSON
envelope) but remains a same-origin demo surface; the swarm needs a per-engine
adapter, and this repo ships Phaser's.

## License

MIT — see [LICENSE](./LICENSE). All code developed within the hackathon build
window. The playable level uses the open-source
[phaser3-tilemap-pack](https://github.com/B3L7/phaser3-tilemap-pack) assets.
