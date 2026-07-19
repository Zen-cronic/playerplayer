import fs from "node:fs";
import path from "node:path";

export type Mutation =
  | { op: "move_object"; objectType: string; index: number; toX: number; toY: number }
  | { op: "copy_tile"; from: { x: number; y: number }; to: { x: number; y: number } };

interface TiledObject {
  type?: string;
  x: number;
  y: number;
}

interface TiledLayer {
  name: string;
  type: string;
  data?: number[] | string;
  encoding?: string;
  objects?: TiledObject[];
}

interface TiledMap {
  width: number;
  height: number;
  layers: TiledLayer[];
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

function encodeTiles(tiles: number[]): string {
  const buf = Buffer.alloc(tiles.length * 4);
  for (let i = 0; i < tiles.length; i++) buf.writeUInt32LE(tiles[i], i * 4);
  return buf.toString("base64");
}

export function vendorMapPath(room: string): string {
  return path.resolve(process.cwd(), `vendor/tilemap-pack/assets/maps/${room.toLowerCase()}.json`);
}

// Applies mutations to a vendored map and writes the variant map JSON.
// move_object uses px coords (Tiled object space); copy_tile uses tile coords
// and clones a tile GID — "copy floor over wall" opens geometry, the reverse
// closes it. Returns the output path.
export function applyMutations(room: string, mutations: Mutation[], outPath: string): string {
  const map = JSON.parse(fs.readFileSync(vendorMapPath(room), "utf8")) as TiledMap;

  for (const m of mutations) {
    if (m.op === "move_object") {
      const layer = map.layers.find((l) => l.type === "objectgroup");
      if (!layer?.objects) throw new Error("no object layer");
      const matches = layer.objects.filter((o) => o.type === m.objectType);
      const target = matches[m.index];
      if (!target) {
        throw new Error(`no ${m.objectType} at index ${m.index} (found ${matches.length})`);
      }
      target.x = m.toX;
      target.y = m.toY;
    } else if (m.op === "copy_tile") {
      const layer = map.layers.find((l) => l.type === "tilelayer");
      if (!layer) throw new Error("no tile layer");
      const tiles = decodeTiles(layer);
      const gid = tiles[m.from.y * map.width + m.from.x];
      tiles[m.to.y * map.width + m.to.x] = gid;
      layer.data = encodeTiles(tiles);
      layer.encoding = "base64";
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(map));
  return outPath;
}
