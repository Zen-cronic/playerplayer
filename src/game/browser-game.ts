// Browser boot for the SAME vendored game the swarm plays headless. The bots
// drive it through Phaser.HEADLESS with a time-warped clock; a human drives it
// here on real RAF. One codebase, two clocks — that's what makes "you died
// where 62% of rushers die" an honest comparison.
//
// The vendored sources reference a global `Phaser`, so it must be assigned
// before those modules evaluate — hence the dynamic imports.

export interface BrowserGameOptions {
  parent: HTMLElement;
  level?: string;
  onEvent?: (event: BrowserGameEvent) => void;
}

export interface BrowserGameEvent {
  t: number;
  type: "run_start" | "pos" | "pickup_coin" | "damage" | "heal" | "death" | "run_end" | "room_enter";
  x: number;
  y: number;
  room: string;
  health: number;
  coins: number;
  detail: string;
}

export interface BrowserGameHandle {
  destroy(): void;
}

const SAMPLE_INTERVAL_MS = 100;

export async function startBrowserGame(opts: BrowserGameOptions): Promise<BrowserGameHandle> {
  const { parent, level = "Level1", onEvent } = opts;

  const PhaserMod = await import("phaser");
  const Phaser = (PhaserMod as unknown as { default: typeof import("phaser") }).default ?? PhaserMod;
  (window as unknown as { Phaser: unknown }).Phaser = Phaser;

  const Level = (await import("../../vendor/tilemap-pack/src/scenes/Level.js")).default;

  let game: Phaser.Game;
  let startedAt = 0;
  let lastSampleAt = 0;
  let lastPlayer: unknown = null;
  let ended = false;

  const state = () => {
    const scene = game.scene.getScene("Level") as unknown as {
      player?: { x: number; y: number };
    } | null;
    const p = scene?.player;
    const r = game.registry;
    return {
      x: p ? Math.round(p.x * 10) / 10 : 0,
      y: p ? Math.round(p.y * 10) / 10 : 0,
      room: String(r.get("load") ?? level),
      health: Number(r.get("health_current") ?? 0),
      coins: Number(r.get("coins_current") ?? 0),
    };
  };

  const record = (type: BrowserGameEvent["type"], detail = "") => {
    onEvent?.({ t: Math.round(performance.now() - startedAt), type, detail, ...state() });
  };

  class BrowserBoot extends Phaser.Scene {
    constructor() {
      super({ key: "Boot" });
    }
    preload() {
      this.load.atlas("atlas", "/game/atlas.png", "/game/atlas.json");
      this.load.image("tiles", "/game/tiles/tiles.png");
      for (let i = 1; i <= 5; i++) {
        this.load.tilemapTiledJSON(`Level${i}Map`, `/game/maps/level${i}.json`);
      }
    }
    create() {
      // Mirrors the vendored Preload.initRegistry(); newGame=false skips the
      // tutorial bitmapText, whose font we don't vendor.
      const r = this.registry;
      r.set("newGame", false);
      r.set("health_max", 4);
      r.set("health_current", 4);
      r.set("magic_max", 20);
      r.set("magic_current", 20);
      r.set("coins_max", 50);
      r.set("coins_current", 0);
      r.set("load", level);
      r.set("spawn", "spawnCenter");
      startedAt = performance.now();
      lastSampleAt = startedAt;
      record("run_start");
      this.scene.start("Level");
    }
  }

  class GameOver extends Phaser.Scene {
    constructor() {
      super({ key: "GameOver" });
    }
    init(data: unknown) {
      if (ended) return;
      ended = true;
      record("run_end", data === "win" ? "win" : "lose");
    }
    create() {
      const { width, height } = this.scale;
      this.add
        .text(width / 2, height / 2, ended ? "run over — reload to play again" : "", {
          color: "#e4e4e7",
          fontSize: "16px",
        })
        .setOrigin(0.5);
    }
  }

  const onPostStep = () => {
    const scene = game.scene.getScene("Level") as unknown as { player?: unknown } | null;
    const p = scene?.player;
    if (p && p !== lastPlayer) {
      lastPlayer = p;
      record("room_enter");
    }
    const now = performance.now();
    if (p && now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
      lastSampleAt = now;
      record("pos");
    }
  };

  game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 640,
    height: 360,
    parent,
    banner: false,
    pixelArt: true,
    // The audio pack isn't vendored; noAudio makes the game's sound.add() calls
    // no-op instead of 404ing, exactly as in the headless harness.
    audio: { noAudio: true },
    physics: { default: "arcade" },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BrowserBoot, Level, GameOver],
  });

  game.registry.events.on(
    "changedata-coins_current",
    (_p: unknown, value: number, prev: number) => {
      if (value > (prev ?? 0)) record("pickup_coin");
    },
  );
  game.registry.events.on(
    "changedata-health_current",
    (_p: unknown, value: number, prev: number) => {
      if (value < prev) record("damage", `-${prev - value}`);
      else if (value > prev) record("heal", `+${value - prev}`);
      if (value <= 0) record("death");
    },
  );
  game.events.on(Phaser.Core.Events.POST_STEP, onPostStep);

  return {
    destroy() {
      game.events.off(Phaser.Core.Events.POST_STEP, onPostStep);
      game.destroy(true);
    },
  };
}
