import { runBot, type RunOptions, type RunResult } from "./harness";

// The engine seam.
//
// Everything DOWNSTREAM of a HeadlessAdapter is engine-agnostic and ships in the
// `playtest-copilot` SDK: the telemetry shape (TelemetryEvent), the ClickHouse
// firehose + materialized views, the chat cards, and the before/after delta
// heatmap. The adapter is the ONE engine-specific piece of the bot swarm — it
// drives a real headless playthrough and emits telemetry in the shared shape.
//
// To bring the bot-swarm counterfactual to another engine (Godot, a Unity WebGL
// export, a hand-rolled canvas game), implement this interface for that engine
// and hand it to the bot-run task. Nothing else changes: the same MVs aggregate
// its telemetry and the same cards render it.
//
// SCOPE, stated honestly: the popover + play-telemetry capture install into ANY
// web game with no adapter — they read whatever telemetry the game already
// writes. Only the *simulation* half (running your level headless to generate
// the counterfactual swarm) needs a per-engine adapter. This repo ships Phaser's;
// other engines need their own. No game gets a bot swarm "for free".
export interface HeadlessAdapter {
  /** Engine identifier, e.g. "phaser". Available for run metadata/provenance. */
  readonly engine: string;
  /**
   * Run ONE headless playthrough of `opts.level` under `opts.seed` and
   * `opts.archetype`, applying `opts.mapPath` (a mutated level) when given, and
   * resolve with the telemetry stream + verdict. Must be deterministic for a
   * fixed seed so baseline and mutated variants stay matched.
   */
  run(opts: RunOptions): Promise<RunResult>;
}

// The contract's vocabulary, re-exported from the seam so a new engine's adapter
// imports it from here rather than from the Phaser implementation file.
export type { RunOptions, RunResult } from "./harness";
export type { TelemetryEvent, TelemetryEventType } from "./telemetry";
export type { BotArchetype } from "./bot";

// The adapter this repo ships: the vendored phaser3-tilemap-pack game booted
// under @geckos.io/phaser-on-nodejs at ~700x realtime.
export const phaserAdapter: HeadlessAdapter = {
  engine: "phaser",
  run: runBot,
};
