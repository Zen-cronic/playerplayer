// Public surface of the copilot widget — the entry point the npm package
// exposes and the one this app imports, so the demo dogfoods the SDK path.
export { Copilot, SuggestionButton, type CopilotProps } from "./copilot";
export { CopilotPopover, type CopilotPopoverProps } from "./popover";
export { StatusChip } from "./status-chip";
export { HeatmapCard, type HeatmapOutput, type DrillDown } from "./cards/heatmap-card";
export { DeltaCard, type DeltaOutput } from "./cards/delta-card";
export { FunnelCard, type FunnelOutput } from "./cards/funnel-card";
export { LevelCanvas, type CanvasTrail } from "./level/level-canvas";
