import level1 from "../../vendor/tilemap-pack/assets/maps/level1.json";
import level2 from "../../vendor/tilemap-pack/assets/maps/level2.json";
import level3 from "../../vendor/tilemap-pack/assets/maps/level3.json";
import level4 from "../../vendor/tilemap-pack/assets/maps/level4.json";
import level5 from "../../vendor/tilemap-pack/assets/maps/level5.json";

interface TiledMap {
  width: number;
  height: number;
  layers: Array<{
    type: string;
    data?: number[] | string;
    encoding?: string;
    objects?: Array<{ type?: string; x: number; y: number }>;
  }>;
  tilesets: Array<{
    firstgid: number;
    tileproperties?: Record<string, { collide?: boolean }>;
  }>;
}

export interface LevelObject {
  type: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
}

export interface LevelGeometry {
  room: string;
  widthTiles: number;
  heightTiles: number;
  /** row-major, true = collide tile */
  walls: boolean[];
  objects: LevelObject[];
}

const MAPS: Record<string, TiledMap> = {
  Level1: level1 as unknown as TiledMap,
  Level2: level2 as unknown as TiledMap,
  Level3: level3 as unknown as TiledMap,
  Level4: level4 as unknown as TiledMap,
  Level5: level5 as unknown as TiledMap,
};

// Tiled base64 layer data = little-endian uint32 GIDs. Works in browser and
// Node (atob vs Buffer).
function decodeTiles(layer: { data?: number[] | string; encoding?: string }): number[] {
  if (Array.isArray(layer.data)) return layer.data;
  if (typeof layer.data === "string" && layer.encoding === "base64") {
    const bin =
      typeof atob === "function"
        ? atob(layer.data)
        : Buffer.from(layer.data, "base64").toString("binary");
    const out: number[] = new Array(bin.length / 4);
    for (let i = 0; i < out.length; i++) {
      out[i] =
        (bin.charCodeAt(i * 4) |
          (bin.charCodeAt(i * 4 + 1) << 8) |
          (bin.charCodeAt(i * 4 + 2) << 16) |
          (bin.charCodeAt(i * 4 + 3) << 24)) >>>
        0;
    }
    return out;
  }
  throw new Error("unsupported tile layer encoding");
}

const cache = new Map<string, LevelGeometry>();

export function levelGeometry(room: string): LevelGeometry {
  const cached = cache.get(room);
  if (cached) return cached;

  const map = MAPS[room];
  if (!map) throw new Error(`unknown room ${room}`);

  const collide = new Set<number>();
  for (const ts of map.tilesets) {
    for (const [localId, props] of Object.entries(ts.tileproperties ?? {})) {
      if (props.collide) collide.add(ts.firstgid + Number(localId));
    }
  }

  const tileLayer = map.layers.find((l) => l.type === "tilelayer");
  const tiles = tileLayer ? decodeTiles(tileLayer) : [];
  const walls = tiles.map((gid) => collide.has(gid));

  const objects: LevelObject[] = (
    map.layers.find((l) => l.type === "objectgroup")?.objects ?? []
  ).map((o) => ({
    type: o.type || "unknown",
    x: o.x,
    y: o.y,
    tileX: Math.floor(o.x / 16),
    tileY: Math.floor(o.y / 16),
  }));

  const geometry: LevelGeometry = {
    room,
    widthTiles: map.width,
    heightTiles: map.height,
    walls,
    objects,
  };
  cache.set(room, geometry);
  return geometry;
}
