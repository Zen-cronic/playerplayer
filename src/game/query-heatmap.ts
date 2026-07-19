import fs from "node:fs";
import path from "node:path";
import { heatmap, progressionFunnel, runCounts } from "../lib/queries";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadDotEnv(): void {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

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
        line += walls.has(tiles[y * map.width + x]) ? "#" : " ";
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
