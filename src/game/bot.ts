export type BotArchetype = "explorer" | "rusher" | "cautious";

export const ARCHETYPES: BotArchetype[] = ["explorer", "rusher", "cautious"];

interface CursorKeysLike {
  up: { isDown: boolean };
  down: { isDown: boolean };
  left: { isDown: boolean };
  right: { isDown: boolean };
}

interface SpriteLike {
  x: number;
  y: number;
  alive?: boolean;
  active?: boolean;
  frame?: { name?: string };
}

export interface BotContext {
  player: SpriteLike & { alive: boolean };
  keys: CursorKeysLike;
  /** The live Level scene; archetypes read enemy/pickup positions from the game's own groups. */
  scene?: {
    enemies?: { getChildren(): SpriteLike[] };
    pickups?: { getChildren(): SpriteLike[] };
  };
}

// Deterministic PRNG so runs are reproducible for a given seed.
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

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Every archetype drives the game's own Player class by setting the
// cursor-key flags its update() reads — no game code is modified or bypassed.
// Skill noise: each decision has a `fumbleChance` of picking a random
// direction instead of the intended one, so bots are believably imperfect.
abstract class BaseBot {
  protected rand: () => number;
  protected dirX = 0;
  protected dirY = 0;
  protected nextDecideAt = 0;
  private lastStuckCheckAt = 0;
  private lastX = 0;
  private lastY = 0;
  protected abstract fumbleChance: number;
  protected abstract decideIntervalMs: number;

  constructor(seed: string) {
    this.rand = mulberry32(seed);
  }

  tick(simTime: number, ctx: BotContext): void {
    if (!ctx.player.alive) {
      this.release(ctx.keys);
      return;
    }

    if (simTime >= this.nextDecideAt) {
      if (this.rand() < this.fumbleChance) this.randomDirection();
      else this.decide(ctx);
      this.nextDecideAt = simTime + this.decideIntervalMs * (0.7 + this.rand() * 0.6);
    }

    if (simTime - this.lastStuckCheckAt >= 500) {
      const moved = Math.hypot(ctx.player.x - this.lastX, ctx.player.y - this.lastY);
      if ((this.dirX !== 0 || this.dirY !== 0) && moved < 3) this.randomDirection();
      this.lastX = ctx.player.x;
      this.lastY = ctx.player.y;
      this.lastStuckCheckAt = simTime;
    }

    ctx.keys.left.isDown = this.dirX < 0;
    ctx.keys.right.isDown = this.dirX > 0;
    ctx.keys.up.isDown = this.dirY < 0;
    ctx.keys.down.isDown = this.dirY > 0;
  }

  release(keys: CursorKeysLike): void {
    keys.left.isDown = false;
    keys.right.isDown = false;
    keys.up.isDown = false;
    keys.down.isDown = false;
  }

  protected abstract decide(ctx: BotContext): void;

  protected randomDirection(): void {
    const [dx, dy] = DIRECTIONS[Math.floor(this.rand() * DIRECTIONS.length)];
    this.dirX = dx;
    this.dirY = dy;
  }

  protected steerTowards(ctx: BotContext, tx: number, ty: number, flee = false): void {
    const sign = flee ? -1 : 1;
    const dx = (tx - ctx.player.x) * sign;
    const dy = (ty - ctx.player.y) * sign;
    this.dirX = Math.abs(dx) > 8 ? Math.sign(dx) : 0;
    this.dirY = Math.abs(dy) > 8 ? Math.sign(dy) : 0;
    if (this.dirX === 0 && this.dirY === 0) this.randomDirection();
  }

  protected nearest(ctx: BotContext, sprites: SpriteLike[]): SpriteLike | null {
    let best: SpriteLike | null = null;
    let bestDist = Infinity;
    for (const s of sprites) {
      if (s.active === false || s.alive === false) continue;
      const d = Math.hypot(s.x - ctx.player.x, s.y - ctx.player.y);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }
}

// Wanders at random; the difficulty baseline.
export class ExplorerBot extends BaseBot {
  protected fumbleChance = 0.1;
  protected decideIntervalMs = 500;
  protected decide(): void {
    this.randomDirection();
  }
}

// Beelines for the nearest coin, ignoring danger — the speedrunner shape.
export class RusherBot extends BaseBot {
  protected fumbleChance = 0.15;
  protected decideIntervalMs = 250;
  protected decide(ctx: BotContext): void {
    const coins = (ctx.scene?.pickups?.getChildren() ?? []).filter(
      (p) => p.frame?.name === "coins",
    );
    const target = this.nearest(ctx, coins);
    if (target) this.steerTowards(ctx, target.x, target.y);
    else this.randomDirection();
  }
}

// Collects like the explorer but flees any enemy inside its comfort radius.
export class CautiousBot extends BaseBot {
  protected fumbleChance = 0.05;
  protected decideIntervalMs = 300;
  private comfortRadius = 96;
  protected decide(ctx: BotContext): void {
    const threat = this.nearest(ctx, ctx.scene?.enemies?.getChildren() ?? []);
    if (threat && Math.hypot(threat.x - ctx.player.x, threat.y - ctx.player.y) < this.comfortRadius) {
      this.steerTowards(ctx, threat.x, threat.y, true);
      return;
    }
    const coins = (ctx.scene?.pickups?.getChildren() ?? []).filter(
      (p) => p.frame?.name === "coins",
    );
    const target = this.nearest(ctx, coins);
    if (target) this.steerTowards(ctx, target.x, target.y);
    else this.randomDirection();
  }
}

export function makeBot(archetype: BotArchetype, seed: string): BaseBot {
  switch (archetype) {
    case "rusher":
      return new RusherBot(seed);
    case "cautious":
      return new CautiousBot(seed);
    default:
      return new ExplorerBot(seed);
  }
}
