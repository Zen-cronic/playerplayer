# Playtest Swarm

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
fix worked: **the death rate falls about 25 points (~53% → ~28%)**. Ask instead to
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

## How ClickHouse is used (primary database, load-bearing)

ClickHouse is the only datastore. It carries the telemetry firehose *and* every
analytical view the chat renders — no OLTP tier in the hot path.

- **`bot_events`** — `MergeTree` ordered by `(experiment_id, variant, run_id, t)`.
  One table serves two very different reads from a single copy: the aggregate
  heatmap (via the materialized view below) **and** per-run replay — clicking a
  death cell is a **primary-key range scan** over one run's ~10 Hz stream, no
  scan of the firehose.
- **`heatmap_cells`** — `AggregatingMergeTree` fed by an **insert-time
  materialized view** (`heatmap_cells_mv`) using `sumSimpleState` to grid-bin
  visits / deaths / damage / coin-pickups per cell as events land. Heatmaps read
  pre-aggregated state, so they stay fast while the swarm is still inserting.
- **Delta** = a single-pass `sumIf` over `heatmap_cells` comparing `baseline` vs
  `mutated` in one query — **no joins**.
- **`windowFunnel`** drives the progression funnel (started → 1 coin → 3 coins →
  5 coins), computed per variant.
- **`watch_reports`** — `ReplacingMergeTree` (read with `FINAL`) stores the
  nightly canary's verdicts idempotently.
- **Ingestion** uses asynchronous inserts (`async_insert=1`) with per-run
  client-side buffering, so a swarm of bots each emitting ~10 Hz never causes
  part explosion.
- **Human runs land in the same `bot_events` table** as `archetype='human'` —
  **no schema migration** — so the ghost-overlay comparison is just the existing
  heatmap MV plus a primary-key replay, keyed on a new archetype value.

Measured on ClickHouse Cloud during development: **over 390,000 events across
590+ runs** (and still growing as the swarm runs), with heatmap reads over the
materialized-view aggregate returning in **≈70 ms at rest and the low-hundreds
of milliseconds during active ingest** — the live figures are shown in the app
header and on every card footer (`N runs · M cells · <table (engine)> · Xms`),
so a judge can verify the database is doing real work, not decorating a toy
table.

## How Trigger.dev is used (orchestration, load-bearing)

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
- **Realtime** — the frontend uses `useTriggerChatTransport`, so tool results,
  token streams, and the approval gate flow to the popover live.
- **Context discipline** — read tools return compact `toModelOutput` digests
  (totals + hotspots named by nearest object, e.g. *"3 tiles from slime #0"*)
  rather than raw cell arrays, so the model's context stays small and it answers
  with the rendered card instead of re-narrating coordinates.

## Install into your own game (SDK)

The chat widget is extracted as an npm package, **`playtest-copilot`**, and this
app dogfoods it — the game popover, `/chat`, and the dashboard drill-in all
import the package, not the source.

```tsx
import { CopilotPopover } from "playtest-copilot";
import "playtest-copilot/styles.css"; // compiled utilities — no Tailwind required

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

> The package builds locally (`pnpm --filter playtest-copilot build`) and passes
> `npm pack` clean; **publishing it to npm as `playtest-copilot` is a
> submission-time step**, so the registry entry may not exist until then. The
> snippet above is the shipping API, and this app already imports the package
> (not the source), so the integration is exercised regardless.

## Architecture

- **`/`** — the vendored Phaser game, playable in the browser, with the copilot
  popover mounted through the SDK. Your run streams into the same ClickHouse
  table the bots write to.
- **`/chat`** — the full-screen chat surface.
- **`/dashboard`** — the experiment registry: every swarm that has run, the
  nightly canary feed, and a per-experiment drill-in that reuses the same
  heatmap / delta / funnel cards the chat renders.

Two clocks, one codebase: bots run headless Phaser on a time-warped RAF for
faster-than-realtime simulation; the human game runs the same modules on a real
RAF in the browser. The demo runs on Level 1, but the swarm boots any of the
pack's five levels from one code path — `bot-run` just takes the level id.

## Local development

```bash
pnpm install
cp .env.template .env   # fill in Trigger.dev + ClickHouse credentials
pnpm dev:trigger        # terminal 1: Trigger.dev dev server (worker)
pnpm dev                # terminal 2: Next.js (builds the SDK, then serves the app)
```

Requires a ClickHouse instance and a Trigger.dev project. The ClickHouse schema
(tables + materialized view) is in `src/lib/schema.ts`.

### Reproduce & verify

Nothing here is a fixture. The before/after experiments in the demo are real,
re-runnable matched-seed A/Bs:

```bash
pnpm seed:demo    # regenerates the demo experiments (coins-to-safety, crowd-the-corridor)
pnpm test:e2e     # drives the real flows: chat read, approval gate, ghost overlay, delta card
pnpm bot          # runs one headless bot and prints its telemetry
```

`seed:demo` moves the coins out of the slime room and re-runs the swarm — the
death rate really does fall ~25 points; crowd the chokepoint and it rises. The
numbers on every card are the live query's, shown in the provenance footer.

## License

MIT — see [LICENSE](./LICENSE). All code developed within the hackathon build
window. The playable level uses the open-source
[phaser3-tilemap-pack](https://github.com/B3L7/phaser3-tilemap-pack) assets.
