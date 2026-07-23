import type { Migration } from "./types";

// Arena mode: ClickHouse is the authoritative engine of a live multiplayer grid
// game. Tick N+1 is a pure SQL function of match_state(N) + match_inputs(N) +
// match_geometry, so the database — not application code — resolves movement,
// collisions, pickups, hazards, and scoring (see src/lib/arena.ts). New tables
// only; nothing existing is altered. All arena tables are keyed by match_id
// first because every read filters a single match (and usually a single tick).
//
// Coins are NOT a stored table: a coin is static geometry (kind='coin') and
// "consumed" is derived from state history (no surviving player has stood on the
// cell). That keeps tick resolution a single INSERT into match_state, so a
// durable-loop retry guarded by "does tick T exist?" is idempotent with no
// partial-write window.
export const arena: Migration = {
  id: 4,
  name: "arena",
  statements: [
    `
  CREATE TABLE IF NOT EXISTS matches (
    match_id String,
    room LowCardinality(String),
    width UInt16,
    height UInt16,
    max_ticks UInt32,
    tick_ms UInt32,
    created_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = MergeTree
  ORDER BY (match_id)
`,
    `
  CREATE TABLE IF NOT EXISTS match_players (
    match_id String,
    player_id UInt32,
    kind Enum8('human' = 1, 'bot' = 2),
    archetype LowCardinality(String) DEFAULT '',
    seed String DEFAULT '',
    joined_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = MergeTree
  ORDER BY (match_id, player_id)
`,
    `
  CREATE TABLE IF NOT EXISTS match_geometry (
    match_id String,
    cell_x Int32,
    cell_y Int32,
    kind Enum8('floor' = 1, 'wall' = 2, 'hazard' = 3, 'spawn' = 4, 'coin' = 5)
  )
  ENGINE = MergeTree
  ORDER BY (match_id, cell_x, cell_y)
`,
    `
  CREATE TABLE IF NOT EXISTS match_inputs (
    match_id String,
    tick UInt32 CODEC(Delta(4), ZSTD(1)),
    player_id UInt32,
    seq UInt32,
    intent Enum8('up' = 1, 'down' = 2, 'left' = 3, 'right' = 4, 'stay' = 5),
    client_ts DateTime64(3) DEFAULT now64(3),
    inserted_at DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
  )
  ENGINE = MergeTree
  ORDER BY (match_id, tick, player_id, seq)
`,
    `
  CREATE TABLE IF NOT EXISTS match_state (
    match_id String,
    tick UInt32 CODEC(Delta(4), ZSTD(1)),
    player_id UInt32,
    x Int32 CODEC(ZSTD(1)),
    y Int32 CODEC(ZSTD(1)),
    score UInt32 CODEC(ZSTD(1)),
    alive UInt8,
    inserted_at DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  ORDER BY (match_id, tick, player_id)
`,
  ],
};
