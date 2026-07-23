import fs from "node:fs";
import path from "node:path";
import type { Cell, CellKind } from "./arena";

// Geometry sources for arena matches. Two paths:
//   1. ASCII arenas — compact, legible, deterministic; used by tests and small demos.
//   2. Real Tiled levels — reuse the game's existing maps (walls from the tileset's
//      `collide` property, spawns/hazards/coins from the object layer), so the arena
//      shares geometry with the Phaser platformer instead of re-inventing it.

export interface ParsedArena {
  width: number;
  height: number;
  cells: Cell[];
  spawns: { x: number; y: number }[];
}

// ASCII legend: '#'=wall '.'=floor 'H'=hazard 'C'=coin 'S'=spawn (spawn is walkable).
const ASCII_KIND: Record<string, CellKind> = {
  "#": "wall",
  ".": "floor",
  H: "hazard",
  C: "coin",
  S: "spawn",
};

export function parseAsciiArena(rows: string[]): ParsedArena {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const cells: Cell[] = [];
  const spawns: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x] ?? "#";
      const kind = ASCII_KIND[ch];
      if (!kind) throw new Error(`unknown arena char '${ch}' at (${x},${y})`);
      cells.push({ x, y, kind });
      if (kind === "spawn") spawns.push({ x, y });
    }
  }
  return { width, height, cells, spawns };
}

interface TiledLayer {
  name: string;
  type: string;
  data?: number[] | string;
  encoding?: string;
  objects?: { type?: string; gid?: number; x: number; y: number }[];
}
interface TiledTileset {
  name: string;
  firstgid: number;
  tileproperties?: Record<string, { collide?: boolean }>;
}
interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

function decodeTiles(layer: TiledLayer): number[] {
  if (Array.isArray(layer.data)) return layer.data;
  if (typeof layer.data === "string" && layer.encoding === "base64") {
    const buf = Buffer.from(layer.data, "base64");
    const out: number[] = new Array(buf.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = buf.readUInt32LE(i * 4);
    return out;
  }
  throw new Error("unsupported tile layer encoding");
}

function vendorMapPath(room: string): string {
  return path.resolve(process.cwd(), `vendor/tilemap-pack/assets/maps/${room.toLowerCase()}.json`);
}

const HAZARD_OBJECT_TYPES = new Set(["enemy", "slime", "demon"]);

// Build arena geometry from a vendored Tiled level. Walls come from the base
// tileLayer (tile whose `collide` tileproperty is true); spawns/hazards/coins are
// overlaid from the object layer. Object cells use Level.js's +8/-8 center offset
// (tile objects are anchored bottom-left in Tiled).
export function geometryFromTiledLevel(room: string): ParsedArena {
  const map = JSON.parse(fs.readFileSync(vendorMapPath(room), "utf8")) as TiledMap;
  const { width, height } = map;

  const tileLayer = map.layers.find((l) => l.type === "tilelayer");
  if (!tileLayer) throw new Error(`level ${room} has no tile layer`);
  const base = map.tilesets.find((t) => t.tileproperties);
  const firstgid = base?.firstgid ?? 1;
  const collide = new Set<number>();
  for (const [localId, props] of Object.entries(base?.tileproperties ?? {})) {
    if (props.collide === true) collide.add(Number(localId));
  }

  const tiles = decodeTiles(tileLayer);
  const kindAt = new Map<string, CellKind>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gid = tiles[y * width + x] ?? 0;
      const isWall = gid > 0 && collide.has(gid - firstgid);
      kindAt.set(`${x},${y}`, isWall ? "wall" : "floor");
    }
  }

  const spawns: { x: number; y: number }[] = [];
  const objLayer = map.layers.find((l) => l.type === "objectgroup");
  for (const o of objLayer?.objects ?? []) {
    const cx = Math.floor((o.x + 8) / map.tilewidth);
    const cy = Math.floor((o.y - 8) / map.tilewidth);
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    const key = `${cx},${cy}`;
    if (o.type === "spawn") {
      kindAt.set(key, "spawn");
      spawns.push({ x: cx, y: cy });
    } else if (o.type && HAZARD_OBJECT_TYPES.has(o.type)) {
      kindAt.set(key, "hazard");
    } else if (o.type === "coins") {
      kindAt.set(key, "coin");
    }
  }

  const cells: Cell[] = [];
  for (const [key, kind] of kindAt) {
    const [x, y] = key.split(",").map(Number);
    cells.push({ x, y, kind });
  }
  return { width, height, cells, spawns };
}
