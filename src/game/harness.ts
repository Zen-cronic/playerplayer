import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Phaser, simNow, clearPendingFrames, setSimPace } from "./headless-context";
import { TelemetryBuffer } from "./telemetry";
import { makeBot, type BotArchetype } from "./bot";
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
  /** Absolute path to a (possibly mutated) map JSON for `level`; defaults to the vendored map. */
  mapPath?: string;
  timeoutSimMs?: number;
  sampleIntervalMs?: number;
  /**
   * Live mode: approximate realtime multiple (clamped 1..20). The sim clock
   * stays synthetic (t stamps unchanged in meaning), but paced dispatch can
   * drift the frame sequence a few frames vs flat-out for the same seed — so
   * pace is live-lane only; matched-seed science always runs flat-out.
   */
  pace?: number;
  /**
   * Live mode: streaming sink for newly-recorded event chunks. One chunk in
   * flight at a time; the cursor advances only on a durable ack, and the first
   * failure stops mid-run flushing (the final insert covers the tail). Never
   * called when absent.
   */
  onFlush?: (events: TelemetryBuffer["events"]) => Promise<void>;
  /** Wall-clock cadence for onFlush. Default 750ms. */
  flushIntervalMs?: number;
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
  /** How many leading events were already delivered (acked) via onFlush. */
  flushedEvents: number;
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
  enemies?: { getChildren(): Array<{ x: number; y: number; alive?: boolean; active?: boolean }> };
  pickups?: {
    getChildren(): Array<{ x: number; y: number; active?: boolean; frame?: { name?: string } }>;
  };
}

export function runBot(opts: RunOptions): Promise<RunResult> {
  const {
    seed,
    archetype = "explorer",
    level = "Level1",
    mapPath,
    timeoutSimMs = 90_000,
    sampleIntervalMs = 100,
    pace,
    onFlush,
    flushIntervalMs = 750,
  } = opts;

  return new Promise<RunResult>((resolve, reject) => {
    const telemetry = new TelemetryBuffer();
    const bot = makeBot(archetype, seed);
    const wallStart = Date.now();
    // The sim clock is process-global and keeps counting across sequential
    // games, so every run must measure from its own start.
    let simStart = simNow();
    let lastSampleAt = 0;
    let lastPlayer: LevelSceneLike["player"] | null = null;
    let finished = false;
    let game: Phaser.Game;

    const roomsVisited: string[] = [];

    // Streaming flush state: strictly ordered, gap-free delivery. The cursor
    // advances ONLY when a chunk is durably acked, so a failed chunk is simply
    // re-covered by the final end-of-run insert (see insertRunTelemetry's
    // skipEventRows) — never re-sent mid-run, never lost.
    let flushedCursor = 0;
    let inFlight: Promise<void> | null = null;
    let flushDegraded = false;
    let lastFlushWall = Date.now();

    setSimPace(pace ?? null);

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
      const result: Omit<RunResult, "flushedEvents"> = {
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
      // destroy() only marks pendingDestroy; teardown happens on the game's next step, whose
      // final step re-requests a frame after DESTROY fires. Flush that zombie frame on the
      // next tick before resolving, so the next run boots onto a clean scheduler. Pacing
      // resets here (one paced run must never leak its pace into the next), and any in-flight
      // chunk settles first so flushedEvents is the true acked cursor.
      game.events.once(Phaser.Core.Events.DESTROY, () => {
        setImmediate(async () => {
          if (inFlight) await inFlight.catch(() => {});
          setSimPace(null);
          clearPendingFrames();
          resolve({ ...result, flushedEvents: flushedCursor });
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
        bot.tick(simNow(), { player: p, keys: p.input, scene: scene ?? undefined });
      }

      if (simNow() - lastSampleAt >= sampleIntervalMs) {
        lastSampleAt = simNow();
        if (p) record("pos");
      }

      // Streaming flush: fire-and-forget relative to the frame loop (never
      // blocks a frame), single chunk in flight, degrade-on-first-failure.
      if (
        onFlush &&
        !flushDegraded &&
        !inFlight &&
        Date.now() - lastFlushWall >= flushIntervalMs &&
        telemetry.events.length > flushedCursor
      ) {
        const upTo = telemetry.events.length;
        const chunk = telemetry.events.slice(flushedCursor, upTo);
        inFlight = onFlush(chunk)
          .then(() => {
            flushedCursor = upTo;
          })
          .catch(() => {
            flushDegraded = true;
          })
          .finally(() => {
            inFlight = null;
            lastFlushWall = Date.now();
          });
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
          const key = `Level${i}Map`;
          const file =
            mapPath && key === `${level}Map`
              ? mapPath
              : path.join(VENDOR, `assets/maps/level${i}.json`);
          this.load.tilemapTiledJSON(key, file);
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
      setSimPace(null);
      reject(err);
    }
  });
}
