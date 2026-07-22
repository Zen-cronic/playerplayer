// Single source for the v2 envelope's game identity. Every query filters on
// game_id and every writer stamps it; the demo game is one tenant of a
// multi-game schema, not the schema itself.
export const DEMO_GAME_ID = "tilemap-demo";
