// Single source for the v2 envelope's game identity. Every query filters on
// game_id and every writer stamps it; the demo game is one tenant of a
// multi-game schema, not the schema itself.
export const DEMO_GAME_ID = "tilemap-demo";

// Arena mode is a second tenant of the same envelope: the CH-authoritative grid
// game emits death/pickup telemetry into game_events under this game_id, so the
// existing heatmap MV and chat.agent() copilot light up over multiplayer matches
// with no new analytics code. Arena tile coords are emitted at cell*TILE so the
// heatmap MV's floor(x/16) recovers the exact cell.
export const ARENA_GAME_ID = "arena-grid";
export const ARENA_TILE = 16;
