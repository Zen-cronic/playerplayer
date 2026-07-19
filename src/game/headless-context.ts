import "@geckos.io/phaser-on-nodejs";
import Phaser from "phaser";

// Faster-than-realtime sim: Phaser's TimeStep ignores RAF timestamps and reads
// window.performance.now() directly (TimeStep.step), so both the RAF scheduler
// and the clock must serve synthetic fixed-step time. Each frame advances sim
// time by exactly 1000/60 ms and is scheduled with setImmediate, so wall-clock
// speed is bounded only by CPU.
const STEP_MS = 1000 / 60;
let simTime = 0;

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
  setImmediate(() => {
    const fn = pendingFrames.get(id);
    if (!fn) return;
    pendingFrames.delete(id);
    simTime += STEP_MS;
    fn(simTime);
  });
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
