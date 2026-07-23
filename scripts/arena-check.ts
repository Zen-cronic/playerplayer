import { getClickHouse } from "../src/lib/clickhouse";
import { loadDotEnv } from "../src/lib/env";
import {
  createMatch,
  submitIntent,
  stepBots,
  resolveTick,
  emitTickTelemetry,
  getState,
  coinsRemaining,
  matchStatus,
  type Intent,
  type PlayerState,
} from "../src/lib/arena";
import {
  parseAsciiArena,
  geometryFromTiledLevel,
  ARENA_PRESETS,
  assignSpawns,
} from "../src/lib/arena-geometry";
import { BOT_ARCHETYPES } from "../src/lib/arena-bot";

// Deterministic engine test for ClickHouse Arena. Exercises the real resolution
// SQL against a ClickHouse instance and asserts every rule. Run against a LOCAL
// ClickHouse only (writes scratch matches); refuses a non-local CLICKHOUSE_URL so
// it can never touch the submission's cloud database.
//
//   CLICKHOUSE_URL=http://127.0.0.1:8123 pnpm arena:check

loadDotEnv();

const URL = process.env.CLICKHOUSE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(URL)) {
  console.error(`arena:check refuses a non-local CLICKHOUSE_URL (got "${URL}"). Point it at a local CH.`);
  process.exit(2);
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    console.error(`  FAIL: ${msg}`);
    failures++;
  }
}
function posOf(state: PlayerState[], id: number): PlayerState {
  const p = state.find((s) => s.playerId === id);
  if (!p) throw new Error(`player ${id} missing from state`);
  return p;
}

// A fresh match id per run keeps the test rerunnable without cleanup.
const RUN = `check-${process.pid}-${Date.now()}`;

async function digest(matchId: string, tick: number): Promise<string> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `SELECT toString(cityHash64(toString(arraySort(groupArray((player_id,x,y,score,alive)))))) AS d
            FROM match_state WHERE match_id = {m:String} AND tick = {t:UInt32}`,
    query_params: { m: matchId, t: tick },
    format: "JSONEachRow",
  });
  const [{ d }] = await rs.json<{ d: string }>();
  return d;
}

// The spike scenario, rebuilt through the public engine API. Same six rules in one
// tick; the resulting state must be byte-identical to the standalone spike.
async function spikeScenario(matchId: string): Promise<void> {
  const arena = parseAsciiArena([
    "......",
    "#..C..",
    ".....H",
  ]);
  await createMatch(
    { matchId, room: "spike", width: arena.width, height: arena.height, maxTicks: 8, tickMs: 200 },
    arena.cells,
    [
      { playerId: 1, kind: "human", x: 1, y: 1 },
      { playerId: 2, kind: "bot", x: 2, y: 2 },
      { playerId: 3, kind: "bot", x: 4, y: 0 },
      { playerId: 4, kind: "bot", x: 0, y: 0 },
      { playerId: 5, kind: "bot", x: 3, y: 0 },
      { playerId: 6, kind: "bot", x: 5, y: 1 },
    ],
  );
  const intents: [number, Intent][] = [
    [1, "right"],
    [2, "up"],
    [3, "right"],
    [4, "down"],
    [5, "down"],
    [6, "down"],
  ];
  for (const [pid, intent] of intents) await submitIntent(matchId, 0, pid, intent);
  const wrote = await resolveTick(matchId, 1);
  assert(wrote, "resolveTick(1) wrote state");

  const s = await getState(matchId, 1);
  assert(posOf(s, 1).x === 2 && posOf(s, 1).y === 1, "P1 wins tiebreak -> (2,1)");
  assert(posOf(s, 2).x === 2 && posOf(s, 2).y === 2, "P2 loses tiebreak, holds (2,2)");
  assert(posOf(s, 3).x === 5 && posOf(s, 3).y === 0, "P3 normal move -> (5,0)");
  assert(posOf(s, 4).x === 0 && posOf(s, 4).y === 0, "P4 wall clamp, holds (0,0)");
  assert(posOf(s, 5).x === 3 && posOf(s, 5).y === 1 && posOf(s, 5).score === 1, "P5 coin pickup -> (3,1) score 1");
  assert(posOf(s, 6).x === 5 && posOf(s, 6).y === 2 && !posOf(s, 6).alive, "P6 hazard death -> (5,2) alive 0");

  const coins = await coinsRemaining(matchId, 1);
  assert(coins.length === 0, "coin consumed (0 remaining)");

  const d = await digest(matchId, 1);
  assert(d === "211480828294239070", `tick-1 state digest matches the spike (${d})`);

  // Idempotency: a second resolveTick(1) is a no-op and adds no rows.
  const again = await resolveTick(matchId, 1);
  assert(!again, "resolveTick(1) again is a no-op");
  const ch = getClickHouse();
  const rs = await ch.query({
    query: `SELECT count() AS n FROM match_state WHERE match_id = {m:String} AND tick = 1`,
    query_params: { m: matchId },
    format: "JSONEachRow",
  });
  const [{ n }] = await rs.json<{ n: string }>();
  assert(Number(n) === 6, "tick-1 still has exactly 6 rows after re-resolve");
}

// Determinism: the same scenario in a second match yields the identical digest.
async function determinism(): Promise<void> {
  const a = `${RUN}-detA`;
  const b = `${RUN}-detB`;
  await spikeScenarioQuiet(a);
  await spikeScenarioQuiet(b);
  const da = await digest(a, 1);
  const db = await digest(b, 1);
  assert(da === db && da === "211480828294239070", `two independent matches agree (${da})`);
}
async function spikeScenarioQuiet(matchId: string): Promise<void> {
  const arena = parseAsciiArena(["......", "#..C..", ".....H"]);
  await createMatch(
    { matchId, room: "spike", width: arena.width, height: arena.height, maxTicks: 8, tickMs: 200 },
    arena.cells,
    [
      { playerId: 1, kind: "human", x: 1, y: 1 },
      { playerId: 2, kind: "bot", x: 2, y: 2 },
      { playerId: 3, kind: "bot", x: 4, y: 0 },
      { playerId: 4, kind: "bot", x: 0, y: 0 },
      { playerId: 5, kind: "bot", x: 3, y: 0 },
      { playerId: 6, kind: "bot", x: 5, y: 1 },
    ],
  );
  const intents: [number, Intent][] = [[1, "right"], [2, "up"], [3, "right"], [4, "down"], [5, "down"], [6, "down"]];
  for (const [pid, intent] of intents) await submitIntent(matchId, 0, pid, intent);
  await resolveTick(matchId, 1);
}

// Multi-tick walk: one player crosses a 5-cell corridor over 4 ticks, then a wall.
async function corridorWalk(matchId: string): Promise<void> {
  const arena = parseAsciiArena(["S....#"]); // spawn, four floors, wall at x5
  await createMatch(
    { matchId, room: "corridor", width: arena.width, height: arena.height, maxTicks: 10, tickMs: 200 },
    arena.cells,
    [{ playerId: 1, kind: "bot", x: 0, y: 0 }],
  );
  for (let tick = 0; tick < 6; tick++) {
    await submitIntent(matchId, tick, 1, "right");
    await resolveTick(matchId, tick + 1);
  }
  const s = await getState(matchId);
  assert(posOf(s, 1).x === 4, "corridor walk stops at x=4 (wall at x=5 blocks the 5th step)");
  const status = await matchStatus(matchId);
  assert(status.over === true, "single survivor -> match over");
}

// Real Tiled geometry reuse.
async function tiledReuse(): Promise<void> {
  const g = geometryFromTiledLevel("level1");
  assert(g.width === 50 && g.height === 38, "level1 is 50x38");
  assert(g.cells.length === 50 * 38, "every cell classified");
  const walls = g.cells.filter((c) => c.kind === "wall").length;
  const coins = g.cells.filter((c) => c.kind === "coin").length;
  const hazards = g.cells.filter((c) => c.kind === "hazard").length;
  assert(walls > 0, `level1 has walls (${walls})`);
  assert(coins > 0, `level1 has coins (${coins})`);
  assert(hazards > 0, `level1 has hazards (${hazards})`);
  assert(g.spawns.length > 0, `level1 has spawns (${g.spawns.length})`);
}

// Analytics reuse bridge: arena events flow into the existing game_events envelope
// and the existing heatmap MV aggregates them by cell (cell*16 -> floor(x/16)).
async function telemetryBridge(matchId: string): Promise<void> {
  const arena = parseAsciiArena(["......", "#..C..", ".....H"]);
  await createMatch(
    { matchId, room: "spike", width: arena.width, height: arena.height, maxTicks: 8, tickMs: 200 },
    arena.cells,
    [
      { playerId: 1, kind: "human", x: 1, y: 1 },
      { playerId: 5, kind: "bot", archetype: "rusher", x: 3, y: 0 },
      { playerId: 6, kind: "bot", archetype: "explorer", x: 5, y: 1 },
    ],
  );
  await submitIntent(matchId, 0, 1, "right");
  await submitIntent(matchId, 0, 5, "down");
  await submitIntent(matchId, 0, 6, "down");
  await resolveTick(matchId, 1);
  await emitTickTelemetry(matchId, 1);

  const ch = getClickHouse();
  const evs = await ch.query({
    query: `SELECT archetype, type, toInt32(x) AS x, toInt32(y) AS y, toUInt16(props.coins) AS coins
            FROM game_events WHERE game_id = 'arena-grid' AND experiment_id = {m:String} ORDER BY archetype`,
    query_params: { m: matchId },
    format: "JSONEachRow",
  });
  const rows = await evs.json<{ archetype: string; type: string; x: string; y: string; coins: string }>();
  const byArch = Object.fromEntries(rows.map((r) => [r.archetype, r]));
  assert(byArch["human"]?.type === "pos" && Number(byArch["human"].x) === 32, "human -> pos event at cell*16 (x=32)");
  assert(byArch["rusher"]?.type === "pickup_coin" && Number(byArch["rusher"].coins) === 1, "rusher -> pickup_coin, coins=1");
  assert(byArch["explorer"]?.type === "death", "explorer -> death event");

  const hm = await ch.query({
    query: `SELECT type, gx, gy, sum(n) AS n FROM game_heatmap
            WHERE game_id = 'arena-grid' AND experiment_id = {m:String} GROUP BY type, gx, gy`,
    query_params: { m: matchId },
    format: "JSONEachRow",
  });
  const hrows = await hm.json<{ type: string; gx: string; gy: string; n: string }>();
  const death = hrows.find((r) => r.type === "death");
  assert(!!death && Number(death.gx) === 5 && Number(death.gy) === 2, "heatmap MV recovered death cell (5,2) from cell*16");
}

// Drive the durable loop's mechanics locally (stepBots -> resolveTick per tick,
// minus Trigger's wall-clock waits). Bot seeds are matchId-independent so two
// matches are directly comparable. Returns the final tick + a state digest.
async function runFullBotMatch(matchId: string, seedBase: string): Promise<{ finalTick: number; digest: string }> {
  const arena = parseAsciiArena(ARENA_PRESETS.demo);
  const starts = assignSpawns(arena, 4);
  const players = starts.map((s, i) => ({
    playerId: i + 1,
    kind: "bot" as const,
    archetype: BOT_ARCHETYPES[i % BOT_ARCHETYPES.length],
    seed: `${seedBase}:${i + 1}`,
    x: s.x,
    y: s.y,
  }));
  await createMatch(
    { matchId, room: "demo", width: arena.width, height: arena.height, maxTicks: 40, tickMs: 500 },
    arena.cells,
    players,
  );
  for (let tick = 1; tick <= 40; tick++) {
    await stepBots(matchId, tick - 1);
    await resolveTick(matchId, tick);
    const st = await matchStatus(matchId);
    if (st.over) break;
  }
  const st = await matchStatus(matchId);
  return { finalTick: st.tick, digest: await digest(matchId, st.tick) };
}

async function fullMatchDeterminism(): Promise<void> {
  const a = await runFullBotMatch(`${RUN}-fmA`, "det");
  const b = await runFullBotMatch(`${RUN}-fmB`, "det");
  assert(a.finalTick > 3, `match advanced past a few ticks (finalTick=${a.finalTick})`);
  assert(a.finalTick === b.finalTick, `both matches ran the same number of ticks (${a.finalTick})`);
  assert(a.digest === b.digest, `full 4-bot match is deterministic run-to-run (digest ${a.digest})`);
}

async function main(): Promise<void> {
  console.log(`arena:check against ${URL} (run ${RUN})`);
  console.log("scenario: spike rules");
  await spikeScenario(`${RUN}-spike`);
  console.log("scenario: determinism");
  await determinism();
  console.log("scenario: corridor walk + match-over");
  await corridorWalk(`${RUN}-corridor`);
  console.log("scenario: full bot match determinism (loop mechanics)");
  await fullMatchDeterminism();
  console.log("scenario: analytics reuse bridge (game_events + heatmap MV)");
  await telemetryBridge(`${RUN}-tele`);
  console.log("scenario: real Tiled level reuse");
  await tiledReuse();

  console.log(failures === 0 ? "\nALL ARENA CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await getClickHouse().close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
