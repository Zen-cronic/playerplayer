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

(win as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame = (
  cb: (t: number) => void,
) => {
  simTime += STEP_MS;
  setImmediate(() => cb(simTime));
  return 0;
};

(win as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame = () => {};

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
