# Deployment

PlayerPlayer deploys as two independent pieces that share one ClickHouse Cloud database:

- **The Next.js app → Vercel** — UI, API routes, server actions. Reads ClickHouse directly and triggers Trigger.dev tasks.
- **The background tasks → Trigger.dev cloud** — the bots, the arena match loop, and the `chat.agent` copilot.

The rule for environment variables: **a variable goes wherever the code that reads it runs.** The app runs on Vercel; the tasks run on Trigger. `CLICKHOUSE_URL` is the only one both need — same value on both.

## Environment variables

### Vercel (the app)

| Var | Required | Notes |
|---|---|---|
| `CLICKHOUSE_URL` | yes | Server-side ClickHouse reads (dashboards, arena, health). Never `NEXT_PUBLIC_*`. |
| `TRIGGER_SECRET_KEY` | yes | Triggers tasks and mints realtime tokens. Use the **prod** key (`tr_prod_…`). |
| `ARENA_READER_URL` | optional | Dedicated read-only user for the arena RawBLOB path; falls back to `CLICKHOUSE_URL`. |
| `AGENT_LOG_PUBLIC` | optional | `0`/unset hides agent prompt content on the public dashboard. |
| `TRIGGER_PROJECT_REF` | optional | Not read at runtime; harmless to include. |

Not on Vercel: `ANTHROPIC_API_KEY` — the app never calls the model.

### Trigger.dev (prod environment)

| Var | Required | Notes |
|---|---|---|
| `CLICKHOUSE_URL` | yes | Tasks read and write ClickHouse. Same value as Vercel. |
| `ANTHROPIC_API_KEY` | yes | The `chat.agent` copilot's model call runs inside the task. |

Not on Trigger: `ARENA_READER_URL` (no task reads it), `TRIGGER_SECRET_KEY` (that key is how you reach Trigger, not something a task needs).

> Trigger's **prod** and **dev** environments are separate stores, and `trigger.dev deploy` ships code, not secrets. Set prod env vars in the dashboard (project → Environment Variables → Production). Changes apply to new runs immediately — no redeploy.

## Deploy

### 1. Tasks → Trigger prod

```bash
npx trigger.dev@latest login
npx trigger.dev@latest deploy        # deploys to the prod environment
```

Then set `CLICKHOUSE_URL` and `ANTHROPIC_API_KEY` in the Trigger dashboard, and copy the prod secret key (`tr_prod_…`) from API Keys for the next step.

### 2. App → Vercel

Set the Vercel env vars above (dashboard, or `vercel env add`), then:

```bash
npx vercel@latest --prod
```

`vercel.json` pins the build to `pnpm run build` so the `prebuild` hook runs: it syncs the game assets into `public/game` (gitignored) and builds the `@playerplayer/sdk` workspace package. Both are required for the build to succeed.

## Verify

- **App up:** `/`, `/arena`, `/dashboard` return 200.
- **ClickHouse reachable:** the arena grid ticks, the heatmap and "Render in CH" toggles work, dashboards show real runs.
- **Trigger prod executing:** open the copilot and ask a question — it answers. If it hangs while the panel reads "connected," `ANTHROPIC_API_KEY` is missing on Trigger prod (the run trace in the Trigger dashboard shows `AI_LoadAPIKeyError`).
- **No host leak:** the ClickHouse host never appears client-side — all ClickHouse access is server-side (API routes) or inside tasks.

## Live-link note

The copilot and live-swarm only run when the tasks are deployed to Trigger **prod** (always-on). Pointing the app at the **dev** environment instead works only while a local `trigger.dev dev` process is running — fine for local demos, fragile for a shared link.
