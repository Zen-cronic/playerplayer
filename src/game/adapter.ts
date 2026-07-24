import { runBot, type RunOptions, type RunResult } from "./harness";

// The engine seam. Everything downstream of a HeadlessAdapter is engine-agnostic and ships
// in @playerplayer/sdk (telemetry shape, ClickHouse MVs, chat cards, delta heatmap); the
// adapter is the ONE engine-specific piece — it runs a headless playthrough and emits
// telemetry in the shared shape. Port to another engine by implementing this interface;
// nothing downstream changes. Scope, stated honestly: the popover + play-telemetry capture
// install into any web game with no adapter, but the simulation half (the headless
// counterfactual swarm) needs a per-engine adapter — this repo ships Phaser's, no game gets
// a bot swarm "for free".
export interface HeadlessAdapter {
  /** Engine identifier, e.g. "phaser". Available for run metadata/provenance. */
  readonly engine: string;
  /**
   * Run ONE headless playthrough of `opts.level` under `opts.seed`/`opts.archetype`,
   * applying `opts.mapPath` (a mutated level) when given; resolve with telemetry + verdict.
   * Must be deterministic for a fixed seed so baseline and mutated variants stay matched —
   * that guarantee is for the flat-out path; the live-lane `pace`/`onFlush` options trade
   * frame determinism for pacing/streaming and are never used for experiments.
   *
   * Concurrency: ONE run at a time per process. The swarm parallelizes by fanning bot-run
   * tasks across separate workers, not two adapters in one process — the Phaser adapter
   * drives a process-global sim clock, so overlapping runs would corrupt telemetry. A new
   * engine's adapter may relax this if its engine allows.
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
