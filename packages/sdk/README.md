# playtest-copilot

An in-game chat copilot for level designers. Ask *"where do runs die?"* and it
renders a death **heatmap** over your level; ask *"what if I move this enemy?"*
and it re-simulates the level and renders the before/after **delta heatmap** —
the chat answers with a visual, not a wall of text.

The widget is engine-agnostic React. It renders the cards, the level-map
overlays, the human-vs-swarm ghost trail, and the human-in-the-loop approval
gate. The host supplies the two Trigger.dev server actions and (optionally) a
ClickHouse-backed drill-down.

## What installs anywhere — and what doesn't

The **popover and play-telemetry capture install into any web game.** What needs
a per-engine adapter is the *bot swarm simulation* — running your level headless
to generate the counterfactual. The reference app ships a **Phaser** headless
adapter; other engines need their own. This package is the UI + telemetry half;
it makes no claim to swarm any game out of the box.

## Install

```bash
npm install playtest-copilot
```

```tsx
import { CopilotPopover } from "playtest-copilot";
import "playtest-copilot/styles.css"; // compiled utilities — no Tailwind required

export function Game() {
  return (
    <>
      {/* your <canvas> game */}
      <CopilotPopover
        accessToken={({ chatId }) => mintChatAccessToken(chatId)}      // server action
        startSession={({ chatId, clientData }) =>                        // server action
          startChatSession({ chatId, clientData })}
        onDrillDown={fetchCulpritRuns}                                   // optional: click a hotspot → replay
        suggestions={["Where do runs die?", "How does my run compare to the swarm?"]}
      />
    </>
  );
}
```

`accessToken` and `startSession` are the standard Trigger.dev chat server
actions (`auth.createPublicToken` scoped to the chat, and
`chat.createStartSessionAction`). They run on your server so the
`TRIGGER_SECRET_KEY` never reaches the browser. `onDrillDown` runs a ClickHouse
query on your server; omit it and heatmaps stay static.

## Exports

`Copilot`, `CopilotPopover` — the widget (full-screen or popover).
`HeatmapCard`, `DeltaCard`, `FunnelCard`, `LevelCanvas`, `StatusChip` — the
individual renderers, for building your own surface (e.g. a dashboard).

## Peer dependencies

`react` `react-dom` `ai` `@ai-sdk/react` `@trigger.dev/sdk` — one copy resolved
from the host.

## License

MIT
