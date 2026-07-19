# Vendored: phaser3-tilemap-pack

Upstream: https://github.com/B3L7/phaser3-tilemap-pack @ `365d09d2b8f7c9160346c23591eff25056e0914b` (MIT, see LICENSE).

A top-down dungeon crawler by B3L7. We did not write this game — it is the subject under test for Playtest Swarm. The swarm drives the game's own unmodified player, enemy, and physics logic.

## Subset vendored

- `src/scenes/Level.js` — the entire game scene (patched, see below)
- `src/sprites/*.js` — all 11 sprite classes, unmodified
- `assets/maps/level1-5.json` — Tiled tilemaps (mutation target for counterfactuals)
- `assets/atlas.{png,json}`, `assets/tiles/tiles.png`, `assets/pack.json`

Not vendored: audio assets (headless runs use Phaser's `noAudio` mode; `sound.add()` calls no-op), `Preload`/`HUD`/`gameOver` scenes (replaced by minimal headless Boot/RunEnd scenes in `src/game/harness.ts`; Boot replicates Preload's `initRegistry()` values verbatim).

## Patches (none affect gameplay/difficulty)

1. `Level.js`: `createStaticLayer` → `createLayer` — Phaser 3.50+ API rename; the game targeted Phaser 3.17, we run 3.55.2 (minimum for headless Node via @geckos.io/phaser-on-nodejs).
