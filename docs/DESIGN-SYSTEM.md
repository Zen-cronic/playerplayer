# PlayerPlayer design system

## Product signal

PlayerPlayer should read as a game-design instrument, not a generic AI chat or a
generic observability dashboard. Within five seconds a judge should understand the
loop: play a level, ask the agent what happened, compare a mutation, and inspect the
evidence behind the answer.

The implementation is token-driven rather than ad hoc: semantic tokens, a 4px
rhythm, shared primitives, explicit interaction states, and a small number of
signature visual ideas carried across every route.

## Visual direction

- **Mood:** editorial control room; calm enough for analysis, kinetic enough for a
  game demo.
- **Foundation:** warm off-white canvas, paper surfaces, near-black ink, 1px
  structural rules.
- **Signals:** violet marks AI actions, ember marks danger/regression, acid yellow
  marks live compute, green marks verified/healthy states.
- **Instrument surfaces:** the game, heatmaps, raw telemetry, and the `/arena`
  match grid are the only dark surfaces. This makes live evidence feel embedded in
  the product instead of placed in another card. The arena's ClickHouse-rendered
  SVG frame deliberately mirrors the React grid's palette and radius, so toggling
  between them reads as the same surface drawn by a different engine — not as a
  different component.
- **Signature element:** the swarm field — a faint tile grid and small moving nodes
  derived from the game map. It appears in the game stage, AI launcher, and data
  visualization chrome, never as general decoration.

## Tokens

- `--ps-canvas`: application background
- `--ps-paper`: primary surface
- `--ps-ink`: primary text and strong controls
- `--ps-muted`: secondary copy
- `--ps-line` / `--ps-line-strong`: structural dividers
- `--ps-violet` / `--ps-violet-soft`: agent actions and selections
- `--ps-ember` / `--ps-ember-soft`: deaths and regressions
- `--ps-acid`: live compute and ClickHouse evidence
- `--ps-success`: healthy connections and improvements
- `--ps-instrument`: game and visualization background

Spacing follows a 4px base grid. Controls are 40px minimum. General surfaces use
0–12px radii; fully rounded geometry is reserved for status chips and compact
actions. Shadows are reserved for floating UI (the copilot and tooltips).

## Typography

Use one neutral sans stack for interface and display text, with the system monospace
stack for telemetry, labels, coordinates, and query provenance. Hierarchy comes from
scale, weight, and color rather than many unrelated type styles.

## Shared components

- `AppShell`: brand, demo route navigation, global live state
- `page-intro`: route eyebrow, title, short explanatory copy
- `metric-grid` / `metric-cell`: compact evidence summaries
- `section-heading`: indexed section label plus explanation
- SDK `Copilot`, `StatusChip`, and chart cards: the same components in chat, popover,
  and analytics drill-ins
- `LevelCanvas`: one rendering vocabulary for heatmaps, deltas, and replays

## Interaction rules

- All hover/focus color transitions use 150ms cubic-bezier(0.4, 0, 0.2, 1).
- Focus uses a visible 2px violet outline with a 2px offset.
- Hover may shift a primary control by at most 1px; data surfaces never move.
- Streaming/live states may pulse a small indicator, not entire containers.
- `prefers-reduced-motion` removes non-essential transitions and animation.

## Responsive behavior

The full product hierarchy must survive narrow screens. Three-column and two-column
workspaces collapse to one column, navigation labels remain reachable, game and map
canvases fit their containers, and data tables scroll horizontally without clipping
row actions.

## Guardrails

Do not add decorative gradients to page chrome, glass cards, neon bloom, excessive
rounding, stock art, or invented metrics. Every number shown in the demo must remain
derived from the existing ClickHouse-backed data contract.
