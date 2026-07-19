import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Phaser, simNow, clearPendingFrames } from "./headless-context";
import { TelemetryBuffer } from "./telemetry";
import { ExplorerBot, type BotArchetype } from "./bot";
import Level from "../../vendor/tilemap-pack/src/scenes/Level.js";

// Assets resolve from cwd first (matches both `trigger dev` and the deployed
// bundle, where additionalFiles copies vendor/ relative to the bundle root),
// falling back to source-relative for other entry points.
function resolveVendor(): string {
  const fromCwd = path.resolve(process.cwd(), "vendor/tilemap-pack");
  if (fs.existsSync(path.join(fromCwd, "assets/atlas.json"))) return fromCwd;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../vendor/tilemap-pack");
}

const VENDOR = resolveVendor();

export interface RunOptions {
  seed: string;
  archetype?: BotArchetype;
  level?: string;
  timeoutSimMs?: number;
  sampleIntervalMs?: number;
}

export interface RunResult {
  seed: string;
  archetype: BotArchetype;
  verdict: "win" | "lose" | "timeout";
  simMs: number;
  wallMs: number;
  coins: number;
  roomsVisited: string[];
  events: TelemetryBuffer["events"];
}

interface LevelSceneLike extends Phaser.Scene {
  player?: {
    x: number;
    y: number;
    alive: boolean;
    input: {
      up: { isDown: boolean };
      down: { isDown: boolean };
      left: { isDown: boolean };
      right: { isDown: boolean };
    };
  };
}

export function runBot(opts: RunOptions): Promise<RunResult> {
  const {
    seed,
    archetype = "explorer",
    level = "Level1",
    timeoutSimMs = 90_000,
    sampleIntervalMs = 100,
  } = opts;

  return new Promise<RunResult>((resolve, reject) => {
    const telemetry = new TelemetryBuffer();
    const bot = new ExplorerBot(seed);
    const wallStart = Date.now();
    // The sim clock is process-global and keeps counting across sequential
    // games, so every run must measure from its own start.
    let simStart = simNow();
    let lastSampleAt = 0;
    let lastPlayer: LevelSceneLike["player"] | null = null;
    let finished = false;
    let game: Phaser.Game;

    const roomsVisited: string[] = [];

    const state = () => {
      const scene = game.scene.getScene("Level") as LevelSceneLike | null;
      const p = scene?.player;
      const registry = game.registry;
      return {
        x: p ? Math.round(p.x * 10) / 10 : 0,
        y: p ? Math.round(p.y * 10) / 10 : 0,
        room: String(registry.get("load") ?? level),
        health: Number(registry.get("health_current") ?? 0),
        coins: Number(registry.get("coins_current") ?? 0),
      };
    };

    const record = (type: TelemetryBuffer["events"][number]["type"], detail = "") => {
      telemetry.add({ t: Math.round(simNow() - simStart), type, detail, ...state() });
    };

    const finish = (verdict: RunResult["verdict"]) => {
      if (finished) return;
      finished = true;
      record("run_end", verdict);
      const result: RunResult = {
        seed,
        archetype,
        verdict,
        simMs: Math.round(simNow() - simStart),
        wallMs: Date.now() - wallStart,
        coins: state().coins,
        roomsVisited,
        events: telemetry.events,
      };
      game.events.off(Phaser.Core.Events.POST_STEP, onPostStep);
      // destroy() only marks pendingDestroy; teardown happens on the game's
      // next step, and its final step re-requests a frame after DESTROY
      // fires. Flush that zombie frame on the next tick, before resolving,
      // so the next run boots onto a clean scheduler.
      game.events.once(Phaser.Core.Events.DESTROY, () => {
        setImmediate(() => {
          clearPendingFrames();
          resolve(result);
        });
      });
      setImmediate(() => game.destroy(false));
    };

    const onPostStep = () => {
      if (finished) return;
      const scene = game.scene.getScene("Level") as LevelSceneLike | null;
      const p = scene?.player;

      if (p && p !== lastPlayer) {
        // New Player instance = fresh Level.create() (run start or room change)
        lastPlayer = p;
        const room = state().room;
        if (!roomsVisited.includes(room)) roomsVisited.push(room);
        record("room_enter");
      }

      if (p?.input) {
        bot.tick(simNow(), p, p.input);
      }

      if (simNow() - lastSampleAt >= sampleIntervalMs) {
        lastSampleAt = simNow();
        if (p) record("pos");
      }

      if (simNow() - simStart > timeoutSimMs) finish("timeout");
    };

    class Boot extends Phaser.Scene {
      constructor() {
        super({ key: "Boot" });
      }
      preload() {
        this.load.atlas(
          "atlas",
          path.join(VENDOR, "assets/atlas.png"),
          path.join(VENDOR, "assets/atlas.json"),
        );
        this.load.image("tiles", path.join(VENDOR, "assets/tiles/tiles.png"));
        for (let i = 1; i <= 5; i++) {
          this.load.tilemapTiledJSON(`Level${i}Map`, path.join(VENDOR, `assets/maps/level${i}.json`));
        }
      }
      create() {
        // Mirrors the vendored Preload.initRegistry(), except newGame=false to
        // skip the tutorial bitmapText (we don't load the font headless).
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
        simStart = simNow();
        lastSampleAt = simStart;
        record("run_start");
        this.scene.start("Level");
      }
    }

    // Registered under the key the vendored Level targets on win/lose.
    class RunEnd extends Phaser.Scene {
      constructor() {
        super({ key: "GameOver" });
      }
      init(data: unknown) {
        finish(data === "win" ? "win" : "lose");
      }
    }

    try {
      game = new Phaser.Game({
        type: Phaser.HEADLESS,
        width: 640,
        height: 360,
        banner: false,
        audio: { noAudio: true },
        seed: [seed],
        physics: { default: "arcade" },
        fps: { target: 60 },
        scene: [Boot, Level, RunEnd],
      });

      game.registry.events.on(
        "changedata-coins_current",
        (_parent: unknown, value: number, prev: number) => {
          if (!finished && value > (prev ?? 0)) record("pickup_coin");
        },
      );
      game.registry.events.on(
        "changedata-health_current",
        (_parent: unknown, value: number, prev: number) => {
          if (finished) return;
          if (value < prev) record("damage", `-${prev - value}`);
          else if (value > prev) record("heal", `+${value - prev}`);
          if (value <= 0) record("death");
        },
      );
      game.events.on(Phaser.Core.Events.POST_STEP, onPostStep);
    } catch (err) {
      reject(err);
    }
  });
}
