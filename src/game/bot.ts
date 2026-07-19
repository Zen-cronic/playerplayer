export type BotArchetype = "explorer";

interface CursorKeysLike {
  up: { isDown: boolean };
  down: { isDown: boolean };
  left: { isDown: boolean };
  right: { isDown: boolean };
}

interface PlayerLike {
  x: number;
  y: number;
  alive: boolean;
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

// Explorer archetype: random-walk with direction persistence and stuck
// detection. Drives the game's own Player class by setting the cursor-key
// flags its update() reads — no game code is modified or bypassed.
export class ExplorerBot {
  private rand: () => number;
  private dirX = 0;
  private dirY = 0;
  private nextDecideAt = 0;
  private lastStuckCheckAt = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(seed: string) {
    this.rand = mulberry32(seed);
  }

  tick(simTime: number, player: PlayerLike, keys: CursorKeysLike): void {
    if (!player.alive) {
      this.release(keys);
      return;
    }

    if (simTime >= this.nextDecideAt) {
      this.pickDirection();
      this.nextDecideAt = simTime + 350 + this.rand() * 400;
    }

    if (simTime - this.lastStuckCheckAt >= 500) {
      const moved = Math.hypot(player.x - this.lastX, player.y - this.lastY);
      const tryingToMove = this.dirX !== 0 || this.dirY !== 0;
      if (tryingToMove && moved < 3) {
        this.pickDirection();
      }
      this.lastX = player.x;
      this.lastY = player.y;
      this.lastStuckCheckAt = simTime;
    }

    keys.left.isDown = this.dirX < 0;
    keys.right.isDown = this.dirX > 0;
    keys.up.isDown = this.dirY < 0;
    keys.down.isDown = this.dirY > 0;
  }

  release(keys: CursorKeysLike): void {
    keys.left.isDown = false;
    keys.right.isDown = false;
    keys.up.isDown = false;
    keys.down.isDown = false;
  }

  private pickDirection(): void {
    const [dx, dy] = DIRECTIONS[Math.floor(this.rand() * DIRECTIONS.length)];
    this.dirX = dx;
    this.dirY = dy;
  }
}
