import type { Intent } from "./arena";

// Grid bot policies for arena mode. These mirror the headless swarm's archetypes
// (explorer/rusher/cautious) and its seeded determinism, adapted from continuous
// cursor-key steering to discrete grid intents. Pure functions: given the world at
// a tick and a seeded RNG, return one intent — so a durable match loop can recompute
// them identically on a retry.

// mulberry32, mirrored from src/game/bot.ts (kept self-contained so a Trigger task
// bundle never pulls the Phaser-coupled game module).
export function mulberry32(seedString: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seedString.length; i++) {
    h = Math.imul(h ^ seedString.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BotArchetype = "explorer" | "rusher" | "cautious";
export const BOT_ARCHETYPES: BotArchetype[] = ["explorer", "rusher", "cautious"];

export interface Point {
  x: number;
  y: number;
}

export interface BotWorld {
  self: Point;
  others: Point[]; // other alive players
  coins: Point[]; // coins remaining
  width: number;
  height: number;
  walkable: Set<string>; // "x,y" cells that are not walls
  hazards: Set<string>; // "x,y" hazard cells
}

const key = (x: number, y: number): string => `${x},${y}`;
const DELTAS: Record<Exclude<Intent, "stay">, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const MOVES: Exclude<Intent, "stay">[] = ["up", "down", "left", "right"];

function target(self: Point, intent: Intent): Point {
  if (intent === "stay") return self;
  return { x: self.x + DELTAS[intent].x, y: self.y + DELTAS[intent].y };
}
function walkableInto(world: BotWorld, p: Point): boolean {
  return world.walkable.has(key(p.x, p.y));
}
function nearest(from: Point, pts: Point[]): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const p of pts) {
    const d = Math.abs(p.x - from.x) + Math.abs(p.y - from.y);
    if (d < bestD || (d === bestD && best && (p.x < best.x || (p.x === best.x && p.y < best.y)))) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// Reduce a target delta to a single-axis intent (larger axis first; deterministic
// x-before-y tiebreak), mirroring steerTowards' sign reduction.
function intentToward(self: Point, dest: Point): Intent {
  const dx = dest.x - self.x;
  const dy = dest.y - self.y;
  if (dx === 0 && dy === 0) return "stay";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

// A safe move avoids walls and hazards; among safe moves prefer the one closest to
// `goal` (or, with no goal, a seeded pick). Falls back to 'stay'.
function safeMove(world: BotWorld, rng: () => number, goal: Point | null, avoid: Point | null): Intent {
  const candidates = MOVES.filter((m) => {
    const t = target(world.self, m);
    return walkableInto(world, t) && !world.hazards.has(key(t.x, t.y));
  });
  if (candidates.length === 0) return "stay";
  const score = (m: Intent): number => {
    const t = target(world.self, m);
    let s = 0;
    if (goal) s -= Math.abs(t.x - goal.x) + Math.abs(t.y - goal.y);
    if (avoid) s += Math.abs(t.x - avoid.x) + Math.abs(t.y - avoid.y);
    return s;
  };
  if (!goal && !avoid) return candidates[Math.floor(rng() * candidates.length)];
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const m of candidates) {
    const s = score(m);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

// One intent for a bot given the world at the current frontier tick.
//   explorer — wanders; random safe step (fumble baked into randomness).
//   rusher   — beelines the nearest coin, ignores hazards (greedy axis step).
//   cautious — pursues coins but flees a player within 2 cells and never steps on a hazard.
export function botIntent(archetype: BotArchetype, world: BotWorld, rng: () => number): Intent {
  if (archetype === "explorer") {
    // 15% dither: sometimes hold, otherwise a random safe step.
    if (rng() < 0.15) return "stay";
    return safeMove(world, rng, null, null);
  }
  if (archetype === "rusher") {
    const coin = nearest(world.self, world.coins);
    if (!coin) return safeMove(world, rng, null, null);
    return intentToward(world.self, coin); // greedy — may hit a wall (clamped) or hazard (dies)
  }
  // cautious
  const threat = nearest(world.self, world.others);
  if (threat && Math.abs(threat.x - world.self.x) + Math.abs(threat.y - world.self.y) <= 2) {
    return safeMove(world, rng, null, threat); // flee, staying safe
  }
  const coin = nearest(world.self, world.coins);
  return safeMove(world, rng, coin, null); // pursue a coin without stepping on a hazard
}
