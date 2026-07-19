import fs from "node:fs";
import path from "node:path";
import { heatmap, heatmapDelta, progressionFunnel, runCounts } from "../lib/queries";
import { loadDotEnv, cliArg as arg } from "../lib/env";

interface TiledMap {
  width: number;
  height: number;
  layers: Array<{ name: string; type: string; data?: number[] | string; encoding?: string }>;
  tilesets: Array<{
    name: string;
    firstgid: number;
    tileproperties?: Record<string, { collide?: boolean }>;
  }>;
}

// The game's walls are the tiles Level.js marks via
// setCollisionByProperty({ collide: true }) — same source of truth here.
function collideGids(map: TiledMap): Set<number> {
  const out = new Set<number>();
  for (const ts of map.tilesets) {
    for (const [localId, props] of Object.entries(ts.tileproperties ?? {})) {
      if (props.collide) out.add(ts.firstgid + Number(localId));
    }
  }
  return out;
}

// Tiled base64 layer data = little-endian uint32 GIDs, one per tile.
function decodeTileData(layer: { data?: number[] | string; encoding?: string }): number[] {
  if (Array.isArray(layer.data)) return layer.data;
  if (typeof layer.data === "string" && layer.encoding === "base64") {
    const buf = Buffer.from(layer.data, "base64");
    const out: number[] = new Array(buf.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = buf.readUInt32LE(i * 4);
    return out;
  }
  throw new Error("unsupported tile layer encoding");
}

// ASCII sanity render: walls from the Tiled collide layer, death intensity on
// top. The real product renders this as a canvas overlay; this proves the
// spatial signal is legible before any frontend exists.
async function main() {
  loadDotEnv();
  const experimentId = arg("experiment", "local-spike");
  const variant = arg("variant", "baseline");
  const room = arg("room", "Level1");
  const metric = arg("metric", "deaths") as "deaths" | "visits" | "damage";

  const mapFile = path.resolve(
    process.cwd(),
    `vendor/tilemap-pack/assets/maps/${room.toLowerCase()}.json`,
  );
  const map = JSON.parse(fs.readFileSync(mapFile, "utf8")) as TiledMap;
  const tileLayer = map.layers.find((l) => l.type === "tilelayer");
  if (!tileLayer?.data) throw new Error(`no tilelayer in ${mapFile}`);
  const tiles = decodeTileData(tileLayer);
  const walls = collideGids(map);

  const wallChar = (x: number, y: number) => (walls.has(tiles[y * map.width + x]) ? "#" : " ");
  const compare = arg("compare", "");

  if (compare) {
    // Delta view: per-run death-rate change per cell, mutated (B) vs baseline (A).
    const counts = await runCounts(experimentId);
    const runsA = counts[variant] ?? 1;
    const runsB = counts[compare] ?? 1;
    const cells = await heatmapDelta(experimentId, variant, compare, room);
    const grid = new Map<string, number>();
    let maxAbs = 0;
    for (const c of cells) {
      const d = c.deathsB / runsB - c.deathsA / runsA;
      if (d !== 0) {
        grid.set(`${c.gx},${c.gy}`, d);
        maxAbs = Math.max(maxAbs, Math.abs(d));
      }
    }
    const RED = "\x1b[31m";
    const GREEN = "\x1b[32m";
    const RESET = "\x1b[0m";
    const lines: string[] = [];
    for (let y = 0; y < map.height; y++) {
      let line = "";
      for (let x = 0; x < map.width; x++) {
        const d = grid.get(`${x},${y}`) ?? 0;
        if (d > 0) line += `${RED}${Math.abs(d) > maxAbs / 2 ? "█" : "▲"}${RESET}`;
        else if (d < 0) line += `${GREEN}${Math.abs(d) > maxAbs / 2 ? "█" : "▽"}${RESET}`;
        else line += wallChar(x, y);
      }
      lines.push(line);
    }
    const totalA = cells.reduce((s, c) => s + c.deathsA, 0);
    const totalB = cells.reduce((s, c) => s + c.deathsB, 0);
    console.log(
      `death-rate DELTA — ${compare} vs ${variant} — experiment=${experimentId} room=${room}\n` +
        `${RED}▲/█ more deaths${RESET}  ${GREEN}▽/█ fewer deaths${RESET}\n`,
    );
    console.log(lines.join("\n"));
    console.log(
      `\ntotals: ${variant}=${totalA} deaths/${runsA} runs (${((totalA / runsA) * 100).toFixed(0)}%) → ` +
        `${compare}=${totalB} deaths/${runsB} runs (${((totalB / runsB) * 100).toFixed(0)}%)`,
    );
    process.exit(0);
  }

  const cells = await heatmap(experimentId, variant, room);
  const grid = new Map<string, number>();
  let max = 0;
  for (const c of cells) {
    const v = c[metric];
    if (v > 0) {
      grid.set(`${c.gx},${c.gy}`, v);
      max = Math.max(max, v);
    }
  }

  const RAMP = ["·", ":", "▒", "▓", "█"];
  const lines: string[] = [];
  for (let y = 0; y < map.height; y++) {
    let line = "";
    for (let x = 0; x < map.width; x++) {
      const v = grid.get(`${x},${y}`) ?? 0;
      if (v > 0) {
        line += RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1)))];
      } else {
        line += wallChar(x, y);
      }
    }
    lines.push(line);
  }

  console.log(`${metric} heatmap — experiment=${experimentId} variant=${variant} room=${room} (max cell=${max})\n`);
  console.log(lines.join("\n"));

  const counts = await runCounts(experimentId);
  const funnel = await progressionFunnel(experimentId, variant);
  console.log(`\nruns per variant: ${JSON.stringify(counts)}`);
  console.log(`funnel [${variant}]: ${funnel.map((f) => `${f.stage}=${f.runs}`).join(" → ")}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
