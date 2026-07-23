-- ClickHouse Arena spike gate: prove one game tick resolves deterministically in SQL.
-- The production version lands in
-- migrations/0004_arena.ts + src/lib/arena.ts. Run against a LOCAL ClickHouse.
--
-- World (x right, y down), 6 wide x 3 tall, all floor except:
--   (0,1) wall     (3,1) floor+coin     (5,2) hazard
-- Six players, tick-0 intents chosen so each rule fires in isolation:
--   P1 (1,1) right -> (2,1)   contends with P2 for empty (2,1); lower id wins
--   P2 (2,2) up    -> (2,1)   loses tiebreak, holds at (2,2)
--   P3 (4,0) right -> (5,0)   normal move onto empty floor
--   P4 (0,0) down  -> (0,1)   blocked by wall, holds at (0,0)
--   P5 (3,0) down  -> (3,1)   steps on coin: score+1, coin consumed
--   P6 (5,1) down  -> (5,2)   steps on hazard: dies

DROP DATABASE IF EXISTS arena_spike;
CREATE DATABASE arena_spike;

CREATE TABLE arena_spike.match_geometry (
  match_id String,
  cell_x   Int32,
  cell_y   Int32,
  kind     Enum8('floor' = 1, 'wall' = 2, 'hazard' = 3, 'spawn' = 4)
) ENGINE = MergeTree ORDER BY (match_id, cell_x, cell_y);

CREATE TABLE arena_spike.match_coins (
  match_id String,
  tick     UInt32,
  cell_x   Int32,
  cell_y   Int32
) ENGINE = MergeTree ORDER BY (match_id, tick, cell_x, cell_y);

CREATE TABLE arena_spike.match_inputs (
  match_id  String,
  tick      UInt32,
  player_id UInt32,
  seq       UInt32,
  intent    Enum8('up' = 1, 'down' = 2, 'left' = 3, 'right' = 4, 'stay' = 5),
  client_ts DateTime64(3) DEFAULT now64(3),
  inserted_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree ORDER BY (match_id, tick, player_id, seq);

CREATE TABLE arena_spike.match_state (
  match_id  String,
  tick      UInt32,
  player_id UInt32,
  x         Int32,
  y         Int32,
  score     UInt32,
  alive     UInt8,
  inserted_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree ORDER BY (match_id, tick, player_id);

-- Geometry: fill the 6x3 grid as floor, then stamp the special cells.
INSERT INTO arena_spike.match_geometry (match_id, cell_x, cell_y, kind)
SELECT 'spike', x, y, 'floor'
FROM (SELECT arrayJoin(range(0, 6)) AS x) AS xs CROSS JOIN (SELECT arrayJoin(range(0, 3)) AS y) AS ys
WHERE NOT ((x = 0 AND y = 1) OR (x = 5 AND y = 2));
INSERT INTO arena_spike.match_geometry (match_id, cell_x, cell_y, kind) VALUES ('spike', 0, 1, 'wall');
INSERT INTO arena_spike.match_geometry (match_id, cell_x, cell_y, kind) VALUES ('spike', 5, 2, 'hazard');

-- One coin at (3,1).
INSERT INTO arena_spike.match_coins (match_id, tick, cell_x, cell_y) VALUES ('spike', 0, 3, 1);

-- Tick-0 authoritative state.
INSERT INTO arena_spike.match_state (match_id, tick, player_id, x, y, score, alive) VALUES
  ('spike', 0, 1, 1, 1, 0, 1),
  ('spike', 0, 2, 2, 2, 0, 1),
  ('spike', 0, 3, 4, 0, 0, 1),
  ('spike', 0, 4, 0, 0, 0, 1),
  ('spike', 0, 5, 3, 0, 0, 1),
  ('spike', 0, 6, 5, 1, 0, 1);

-- Tick-0 intents.
INSERT INTO arena_spike.match_inputs (match_id, tick, player_id, seq, intent) VALUES
  ('spike', 0, 1, 0, 'right'),
  ('spike', 0, 2, 0, 'up'),
  ('spike', 0, 3, 0, 'right'),
  ('spike', 0, 4, 0, 'down'),
  ('spike', 0, 5, 0, 'down'),
  ('spike', 0, 6, 0, 'down');

-- The resolution: state(1) = f( state(0), inputs(0), geometry, coins(0) ).
INSERT INTO arena_spike.match_state (match_id, tick, player_id, x, y, score, alive, inserted_at)
WITH
  cur AS (
    SELECT player_id, x, y, score, alive
    FROM arena_spike.match_state
    WHERE match_id = 'spike' AND tick = 0
  ),
  inp AS (
    SELECT player_id, argMax(intent, seq) AS intent
    FROM arena_spike.match_inputs
    WHERE match_id = 'spike' AND tick = 0
    GROUP BY player_id
  ),
  walkable AS (
    SELECT cell_x, cell_y FROM arena_spike.match_geometry
    WHERE match_id = 'spike' AND kind != 'wall'
  ),
  hazard AS (
    SELECT cell_x, cell_y FROM arena_spike.match_geometry
    WHERE match_id = 'spike' AND kind = 'hazard'
  ),
  coins0 AS (
    SELECT cell_x, cell_y FROM arena_spike.match_coins
    WHERE match_id = 'spike' AND tick = 0
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
           (new_alive = 1 AND (fx, fy) IN (SELECT cell_x, cell_y FROM coins0)) AS got_coin,
           score + toUInt32(new_alive = 1 AND (fx, fy) IN (SELECT cell_x, cell_y FROM coins0)) AS new_score
    FROM final
  )
SELECT 'spike' AS match_id, toUInt32(1) AS tick, player_id,
       fx AS x, fy AS y, new_score AS score, new_alive AS alive, now64(3) AS inserted_at
FROM scored
SETTINGS join_use_nulls = 1;

-- Coins(1): a coin survives only if no alive player stands on it at tick 1.
INSERT INTO arena_spike.match_coins (match_id, tick, cell_x, cell_y)
SELECT 'spike', 1, cell_x, cell_y
FROM arena_spike.match_coins
WHERE match_id = 'spike' AND tick = 0
  AND (cell_x, cell_y) NOT IN (
    SELECT x, y FROM arena_spike.match_state
    WHERE match_id = 'spike' AND tick = 1 AND alive = 1
  );

SELECT '=== tick 1 state ===' AS _;
SELECT player_id, x, y, score, alive
FROM arena_spike.match_state
WHERE match_id = 'spike' AND tick = 1
ORDER BY player_id
FORMAT PrettyCompact;

SELECT '=== coins remaining tick 1 (expect 0 rows) ===' AS _;
SELECT count() AS coins_remaining FROM arena_spike.match_coins WHERE match_id = 'spike' AND tick = 1;

SELECT '=== determinism digest (content-hash, order-independent) ===' AS _;
SELECT cityHash64(toString(arraySort(groupArray((player_id, x, y, score, alive))))) AS digest
FROM arena_spike.match_state
WHERE match_id = 'spike' AND tick = 1;
