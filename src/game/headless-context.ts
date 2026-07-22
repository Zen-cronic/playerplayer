import "@geckos.io/phaser-on-nodejs";
import Phaser from "phaser";

// Faster-than-realtime sim: Phaser's TimeStep ignores RAF timestamps and reads
// window.performance.now() directly (TimeStep.step), so both the RAF scheduler
// and the clock must serve synthetic fixed-step time. Each frame advances sim
// time by exactly 1000/60 ms and is scheduled with setImmediate, so wall-clock
// speed is bounded only by CPU.
const STEP_MS = 1000 / 60;
let simTime = 0;

// Live-mode pacing. Sim time still advances exactly STEP_MS per dispatched
// frame (t stamps and durations stay sim-clocked), but timer-paced dispatch
// interleaves Node macrotasks differently than setImmediate, so a paced run's
// frame sequence can drift a few frames from the flat-out run for the same
// seed (measured: ~2% event drift, same verdict/route). Pacing is therefore
// LIVE-LANE ONLY — matched-seed science (experiments, nightly canary) always
// runs flat-out, which stays byte-identical run-to-run.
let frameDelayMs = 0;

/** Approximate a realtime multiple (clamped 1..20); null/0 = flat-out. */
export function setSimPace(multiplier: number | null): void {
  frameDelayMs =
    multiplier && multiplier > 0 ? STEP_MS / Math.min(Math.max(multiplier, 1), 20) : 0;
}

const win = (globalThis as { window?: Window & { performance: Performance } }).window;
if (!win) throw new Error("phaser-on-nodejs did not install a global window");

// Phaser's RAF wrapper re-requests unconditionally and relies entirely on
// cancelAnimationFrame(handle) to stop the loop (RequestAnimationFrame.stop),
// so handles must be real — a no-op cancel leaks a spinning loop per game.
let nextRafId = 1;
const pendingFrames = new Map<number, (t: number) => void>();

(win as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame = (
  cb: (t: number) => void,
) => {
  const id = nextRafId++;
  pendingFrames.set(id, cb);
  const dispatch = () => {
    const fn = pendingFrames.get(id);
    if (!fn) return;
    pendingFrames.delete(id);
    simTime += STEP_MS;
    fn(simTime);
  };
  if (frameDelayMs > 0) setTimeout(dispatch, frameDelayMs);
  else setImmediate(dispatch);
  return id;
};

(win as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame = (id: number) => {
  pendingFrames.delete(id);
};

// Phaser's RAF step() cancels only the currently-executing frame's stale
// handle during destroy, then re-requests unconditionally — a destroyed
// game's loop can never stop itself. With one game at a time, flushing all
// pending frames after DESTROY kills the zombie chain.
export function clearPendingFrames(): void {
  pendingFrames.clear();
}

Object.defineProperty(win.performance, "now", {
  value: () => simTime,
  configurable: true,
  writable: true,
});

// The vendored game references Phaser as a global (upstream used a webpack shim).
(globalThis as { Phaser?: typeof Phaser }).Phaser = Phaser;

export { Phaser };

export function simNow(): number {
  return simTime;
}
