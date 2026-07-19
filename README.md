# Playtest Swarm

**The agent that re-runs your level to prove the fix.**

A chat agent for game designers, built on [Trigger.dev](https://trigger.dev) `chat.agent()` and [ClickHouse](https://clickhouse.com) for the ClickHouse × Trigger.dev AI Hackathon 2026.

Ask "where do runs die?" and it dispatches a swarm of headless bots to play your level, streaming ~10Hz positional telemetry into ClickHouse, and answers with a death heatmap — not a paragraph. Ask "what if I move this platform?" and it mutates the level (with your approval), re-runs the swarm, and renders the before/after delta heatmap that proves whether the change worked.

## Stack

- **Trigger.dev** — `chat.agent()` durable conversation, batch fan-out bot swarm, Realtime progress streams, scheduled regression watch
- **ClickHouse** — primary database: telemetry firehose, AggregatingMergeTree heatmap materialized views, `windowFunnel` progression analysis
- **Next.js** — chat UI with canvas heatmap overlays

## Setup

```bash
pnpm install
cp .env.template .env   # fill in Trigger.dev + ClickHouse credentials
pnpm dev:trigger        # terminal 1: Trigger.dev dev server
pnpm dev                # terminal 2: Next.js
```

## License

MIT
