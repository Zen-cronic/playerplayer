import { getClickHouse, READ_SETTINGS } from "./clickhouse";
import { ensureMigrations } from "./migrations";
import { ARENA_GAME_ID, ARENA_TILE } from "./tables";

// ClickHouse Arena: the authoritative engine of a live multiplayer grid game.
// State(N+1) is a pure SQL function of state(N) + inputs(N) + geometry, computed
// by ClickHouse — the DB is the game server. This module owns the schema-facing
// engine (seed, submit intent, resolve tick, read state); the Trigger.dev
// match-loop is the clock that calls resolveTick tick by tick.

export type Intent = "up" | "down" | "left" | "right" | "stay";
export const INTENTS: Intent[] = ["up", "down", "left", "right", "stay"];

export type CellKind = "floor" | "wall" | "hazard" | "spawn" | "coin";

export interface Cell {
  x: number;
  y: number;
  kind: CellKind;
}

export interface PlayerSeed {
  playerId: number;
  kind: "human" | "bot";
  archetype?: string;
  seed?: string;
  x: number;
  y: number;
}

export interface MatchSpec {
  matchId: string;
  room: string;
  width: number;
  height: number;
  maxTicks: number;
  tickMs: number;
}

export interface PlayerState {
  playerId: number;
  x: number;
  y: number;
  score: number;
  alive: boolean;
}

// The tick-resolution query. Parametrized {matchId}, {fromTick}=N, {toTick}=N+1.
// Every rule of the game lives here, computed by ClickHouse:
//   move intent -> wall clamp -> P-vs-P collision tiebreak -> hazard -> coin/score.
// Membership is tested with tuple-IN subqueries, never LEFT JOIN: ClickHouse fills
// unmatched LEFT JOIN rows with type defaults (not NULL), which would read a
// missing geometry cell as a real enum kind. The single LEFT JOIN (cur<->inp for
// intent) runs under join_use_nulls=1 so coalesce(..., 'stay') sees a true NULL.
//
// Collision model (deterministic, single-pass): a move succeeds only if the target
// is walkable, not currently occupied by an alive player (no same-tick trains), and
// the player wins row_number() OVER (PARTITION BY target,elig ORDER BY player_id).
// Coins are derived: a coin cell counts as picked up only if no surviving player has
// stood on it at any earlier tick (`eaten`), so resolveTick writes only match_state.
export const RESOLUTION_SQL = `
INSERT INTO match_state (match_id, tick, player_id, x, y, score, alive, inserted_at)
WITH
  cur AS (
    SELECT player_id, x, y, score, alive
    FROM match_state
    WHERE match_id = {matchId:String} AND tick = {fromTick:UInt32}
  ),
  inp AS (
    SELECT player_id, argMax(intent, seq) AS intent
    FROM match_inputs
    WHERE match_id = {matchId:String} AND tick = {fromTick:UInt32}
    GROUP BY player_id
  ),
  walkable AS (
    SELECT cell_x, cell_y FROM match_geometry
    WHERE match_id = {matchId:String} AND kind != 'wall'
  ),
  hazard AS (
    SELECT cell_x, cell_y FROM match_geometry
    WHERE match_id = {matchId:String} AND kind = 'hazard'
  ),
  coincells AS (
    SELECT cell_x, cell_y FROM match_geometry
    WHERE match_id = {matchId:String} AND kind = 'coin'
  ),
  eaten AS (
    SELECT DISTINCT x AS cx, y AS cy
    FROM match_state
    WHERE match_id = {matchId:String} AND tick <= {fromTick:UInt32} AND alive = 1
      AND (x, y) IN (SELECT cell_x, cell_y FROM coincells)
  ),
  occupied AS (
    SELECT x, y FROM cur WHERE alive = 1
  ),
  pre AS (
    SELECT c.player_id AS player_id, c.x AS x, c.y AS y, c.score AS score, c.alive AS alive,
           coalesce(i.intent, 'stay') AS intent
    FROM cur AS c LEFT JOIN inp AS i USING (player_id)
  ),
  desired AS (
    SELECT player_id, x, y, score, alive, intent,
           x + toInt32(intent = 'right') - toInt32(intent = 'left') AS dx,
           y + toInt32(intent = 'down')  - toInt32(intent = 'up')   AS dy
    FROM pre
  ),
  resolved AS (
    SELECT player_id, x, y, score, alive, dx, dy,
           (dx, dy) IN (SELECT cell_x, cell_y FROM walkable) AS dwalk,
           (dx, dy) IN (SELECT x, y FROM occupied)          AS docc,
           (alive = 1 AND dwalk AND NOT (dx = x AND dy = y) AND NOT docc) AS elig,
           row_number() OVER (PARTITION BY dx, dy, elig ORDER BY player_id) AS rnk,
           (elig AND rnk = 1) AS win,
           if(win, dx, x) AS fx,
           if(win, dy, y) AS fy
    FROM desired
  ),
  final AS (
    SELECT player_id, fx, fy, score, alive,
           (alive = 1 AND (fx, fy) IN (SELECT cell_x, cell_y FROM hazard)) AS died,
           if(alive = 0, 0, if(died, 0, 1)) AS new_alive
    FROM resolved
  ),
  scored AS (
    SELECT player_id, fx, fy, new_alive,
           (new_alive = 1
             AND (fx, fy) IN (SELECT cell_x, cell_y FROM coincells)
             AND (fx, fy) NOT IN (SELECT cx, cy FROM eaten)) AS got_coin,
           score + toUInt32(new_alive = 1
             AND (fx, fy) IN (SELECT cell_x, cell_y FROM coincells)
             AND (fx, fy) NOT IN (SELECT cx, cy FROM eaten)) AS new_score
    FROM final
  )
SELECT {matchId:String} AS match_id, {toTick:UInt32} AS tick, player_id,
       fx AS x, fy AS y, new_score AS score, new_alive AS alive, now64(3) AS inserted_at
FROM scored
SETTINGS join_use_nulls = 1
`;

const WRITE_SETTINGS = { async_insert: 1, wait_for_async_insert: 1 } as const;

// Create a match: register it, seed geometry + player registry, and write the
// tick-0 authoritative state at each player's start cell.
export async function createMatch(
  spec: MatchSpec,
  cells: Cell[],
  players: PlayerSeed[],
): Promise<void> {
  const ch = getClickHouse();
  await ensureMigrations(ch);

  await ch.insert({
    table: "matches",
    values: [
      {
        match_id: spec.matchId,
        room: spec.room,
        width: spec.width,
        height: spec.height,
        max_ticks: spec.maxTicks,
        tick_ms: spec.tickMs,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: WRITE_SETTINGS,
  });

  if (players.length > 0) {
    await ch.insert({
      table: "match_players",
      values: players.map((p) => ({
        match_id: spec.matchId,
        player_id: p.playerId,
        kind: p.kind,
        archetype: p.archetype ?? "",
        seed: p.seed ?? "",
      })),
      format: "JSONEachRow",
      clickhouse_settings: WRITE_SETTINGS,
    });
  }

  if (cells.length > 0) {
    await ch.insert({
      table: "match_geometry",
      values: cells.map((c) => ({ match_id: spec.matchId, cell_x: c.x, cell_y: c.y, kind: c.kind })),
      format: "JSONEachRow",
      clickhouse_settings: WRITE_SETTINGS,
    });
  }

  await ch.insert({
    table: "match_state",
    values: players.map((p) => ({
      match_id: spec.matchId,
      tick: 0,
      player_id: p.playerId,
      x: p.x,
      y: p.y,
      score: 0,
      alive: 1,
    })),
    format: "JSONEachRow",
    clickhouse_settings: WRITE_SETTINGS,
  });
}

// A player (human via the API, or a bot task) appends an intent for a tick.
export async function submitIntent(
  matchId: string,
  tick: number,
  playerId: number,
  intent: Intent,
  seq = 0,
): Promise<void> {
  const ch = getClickHouse();
  await ensureMigrations(ch);
  await ch.insert({
    table: "match_inputs",
    values: [{ match_id: matchId, tick, player_id: playerId, seq, intent }],
    format: "JSONEachRow",
    clickhouse_settings: WRITE_SETTINGS,
  });
}

// Advance the world to `toTick` (from toTick-1). Idempotent: if tick `toTick`
// already exists it is a no-op, so a durable-loop retry cannot double-advance.
// Returns whether it wrote this call (false = already resolved).
export async function resolveTick(matchId: string, toTick: number): Promise<boolean> {
  if (toTick < 1) throw new Error("toTick must be >= 1");
  const ch = getClickHouse();
  await ensureMigrations(ch);

  const already = await ch.query({
    query: `SELECT count() AS n FROM match_state WHERE match_id = {matchId:String} AND tick = {toTick:UInt32}`,
    query_params: { matchId, toTick },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const [{ n }] = await already.json<{ n: string }>();
  if (Number(n) > 0) return false;

  await ch.command({
    query: RESOLUTION_SQL,
    query_params: { matchId, fromTick: toTick - 1, toTick },
  });
  return true;
}

// Read the authoritative world at a tick (default: the latest resolved tick).
export async function getState(matchId: string, tick?: number): Promise<PlayerState[]> {
  const ch = getClickHouse();
  const atTick =
    tick ??
    (await (async () => {
      const rs = await ch.query({
        query: `SELECT max(tick) AS t FROM match_state WHERE match_id = {matchId:String}`,
        query_params: { matchId },
        format: "JSONEachRow",
        clickhouse_settings: READ_SETTINGS,
      });
      const [{ t }] = await rs.json<{ t: string }>();
      return Number(t);
    })());

  const rs = await ch.query({
    query: `
      SELECT player_id, x, y, score, alive
      FROM match_state
      WHERE match_id = {matchId:String} AND tick = {tick:UInt32}
      ORDER BY player_id
    `,
    query_params: { matchId, tick: atTick },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const rows = await rs.json<{ player_id: string; x: string; y: string; score: string; alive: number }>();
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    x: Number(r.x),
    y: Number(r.y),
    score: Number(r.score),
    alive: Number(r.alive) === 1,
  }));
}

// Coin cells that survive at `tick`: a coin no surviving player has ever stood on.
export async function coinsRemaining(matchId: string, tick: number): Promise<Cell[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT cell_x, cell_y
      FROM match_geometry
      WHERE match_id = {matchId:String} AND kind = 'coin'
        AND (cell_x, cell_y) NOT IN (
          SELECT x, y FROM match_state
          WHERE match_id = {matchId:String} AND tick <= {tick:UInt32} AND alive = 1
        )
      ORDER BY cell_x, cell_y
    `,
    query_params: { matchId, tick },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const rows = await rs.json<{ cell_x: string; cell_y: string }>();
  return rows.map((r) => ({ x: Number(r.cell_x), y: Number(r.cell_y), kind: "coin" as const }));
}

// Analytics reuse bridge: project one salient event per player per tick into the
// existing game_events envelope (game_id='arena-grid', experiment_id=matchId), so
// the existing game_heatmap_mv, heatmapDelta, and chat.agent() copilot light up
// over live multiplayer matches with no new analytics code. Cell coords are emitted
// at cell*ARENA_TILE so the heatmap MV's floor(x/16) recovers the exact cell. One
// deterministic INSERT...SELECT — the MV fires as a side effect.
export async function emitTickTelemetry(matchId: string, tick: number): Promise<void> {
  if (tick < 1) return;
  const ch = getClickHouse();
  await ch.command({
    query: `
      INSERT INTO game_events (game_id, experiment_id, variant, run_id, archetype, t, type, x, y, room, props)
      WITH
        cur AS (SELECT player_id, x, y, score, alive FROM match_state WHERE match_id = {matchId:String} AND tick = {tick:UInt32}),
        prev AS (SELECT player_id, score, alive FROM match_state WHERE match_id = {matchId:String} AND tick = {tick:UInt32} - 1),
        pl AS (SELECT player_id, kind, archetype FROM match_players WHERE match_id = {matchId:String})
      SELECT
        {gameId:String} AS game_id,
        {matchId:String} AS experiment_id,
        'live' AS variant,
        {matchId:String} AS run_id,
        if(pl.archetype != '', pl.archetype, toString(pl.kind)) AS archetype,
        {tick:UInt32} AS t,
        multiIf(cur.alive = 0 AND prev.alive = 1, 'death',
                cur.score > prev.score, 'pickup_coin',
                'pos') AS type,
        toFloat32(cur.x * {tile:UInt16}) AS x,
        toFloat32(cur.y * {tile:UInt16}) AS y,
        (SELECT any(room) FROM matches WHERE match_id = {matchId:String}) AS room,
        map('health', toInt8(cur.alive * 100), 'coins', toUInt16(cur.score)) AS props
      FROM cur
      LEFT JOIN prev USING (player_id)
      LEFT JOIN pl USING (player_id)
      WHERE NOT (cur.alive = 0 AND prev.alive = 0)
      SETTINGS join_use_nulls = 0
    `,
    query_params: { matchId, tick, tile: ARENA_TILE, gameId: ARENA_GAME_ID },
  });
}

export interface MatchStatus {
  tick: number;
  alive: number;
  total: number;
  maxTicks: number;
  over: boolean;
}

// A match is over when the clock hits max_ticks or at most one player is left alive.
export async function matchStatus(matchId: string): Promise<MatchStatus> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `
      SELECT
        max(tick) AS latest_tick,
        countIf(alive = 1) AS alive,
        count() AS total,
        (SELECT any(max_ticks) FROM matches WHERE match_id = {matchId:String}) AS max_ticks
      FROM match_state
      WHERE match_id = {matchId:String}
        AND tick = (SELECT max(tick) FROM match_state WHERE match_id = {matchId:String})
    `,
    query_params: { matchId },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const [row] = await rs.json<{ latest_tick: string; alive: string; total: string; max_ticks: string }>();
  const tick = Number(row?.latest_tick ?? 0);
  const alive = Number(row?.alive ?? 0);
  const total = Number(row?.total ?? 0);
  const maxTicks = Number(row?.max_ticks ?? 0);
  return { tick, alive, total, maxTicks, over: tick >= maxTicks || alive <= 1 };
}
