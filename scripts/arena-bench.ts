import { getClickHouse } from "../src/lib/clickhouse";
import { loadDotEnv } from "../src/lib/env";
import { createMatch, stepBots, resolveTick, emitTickTelemetry, matchStatus, type PlayerSeed } from "../src/lib/arena";
import { geometryFromTiledLevel, assignSpawns } from "../src/lib/arena-geometry";
import { BOT_ARCHETYPES } from "../src/lib/arena-bot";

// Reproducible scale benchmark for the ClickHouse Arena engine. Runs a large
// many-bot match on the real level1 geometry and reports resolution latency and
// throughput. Numbers are LOCAL single-node (one laptop, the userspace CH binary) —
// honest as a lower bound, not a cloud claim. Local CH only.
//
//   CLICKHOUSE_URL=http://127.0.0.1:8123 pnpm arena:bench [players] [ticks]

loadDotEnv();
const URL = process.env.CLICKHOUSE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(URL)) {
  console.error(`arena:bench refuses a non-local CLICKHOUSE_URL (got "${URL}").`);
  process.exit(2);
}

const PLAYERS = Math.max(2, Number(process.argv[2] ?? 24));
const TICKS = Math.max(5, Number(process.argv[3] ?? 60));

function pct(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function main(): Promise<void> {
  const matchId = `bench-${process.pid}-${Date.now()}`;
  const arena = geometryFromTiledLevel("level1");
  const starts = assignSpawns(arena, PLAYERS);
  const players: PlayerSeed[] = starts.map((s, i) => ({
    playerId: i + 1,
    kind: "bot",
    archetype: BOT_ARCHETYPES[i % BOT_ARCHETYPES.length],
    seed: `bench:${i + 1}`,
    x: s.x,
    y: s.y,
  }));

  console.log(`arena:bench on level1 (${arena.width}x${arena.height}, ${arena.cells.length} cells)`);
  console.log(`players=${PLAYERS} ticks=${TICKS}`);
  await createMatch({ matchId, room: "level1", width: arena.width, height: arena.height, maxTicks: TICKS + 5, tickMs: 0 }, arena.cells, players);

  const resolveMs: number[] = [];
  const stepBotsMs: number[] = [];
  const teleMs: number[] = [];
  const wallStart = performance.now();

  for (let tick = 1; tick <= TICKS; tick++) {
    const t0 = performance.now();
    await stepBots(matchId, tick - 1);
    const t1 = performance.now();
    await resolveTick(matchId, tick);
    const t2 = performance.now();
    await emitTickTelemetry(matchId, tick);
    const t3 = performance.now();
    stepBotsMs.push(t1 - t0);
    resolveMs.push(t2 - t1);
    teleMs.push(t3 - t2);
    const st = await matchStatus(matchId);
    if (st.over) {
      console.log(`(match ended early at tick ${tick}: alive ${st.alive})`);
      break;
    }
  }
  const wallMs = performance.now() - wallStart;

  const ch = getClickHouse();
  const rowsRs = await ch.query({
    query: `SELECT count() AS state_rows FROM match_state WHERE match_id = {m:String}`,
    query_params: { m: matchId },
    format: "JSONEachRow",
  });
  const [{ state_rows }] = await rowsRs.json<{ state_rows: string }>();

  const resSorted = [...resolveMs].sort((a, b) => a - b);
  const done = resolveMs.length;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const avg = (a: number[]) => sum(a) / a.length;

  console.log("\n=== resolution (the ClickHouse INSERT...SELECT, incl. idempotency guard) ===");
  console.log(`  ticks resolved:     ${done}`);
  console.log(`  avg:                ${avg(resolveMs).toFixed(2)} ms`);
  console.log(`  p50 / p95 / max:    ${pct(resSorted, 50).toFixed(2)} / ${pct(resSorted, 95).toFixed(2)} / ${resSorted[resSorted.length - 1].toFixed(2)} ms`);
  console.log(`  resolution rate:    ${(1000 / avg(resolveMs)).toFixed(0)} ticks/sec (single match, sequential)`);
  console.log(`  player-updates/sec: ${((PLAYERS * 1000) / avg(resolveMs)).toFixed(0)} (players resolved per second)`);
  console.log("\n=== per-tick breakdown (avg) ===");
  console.log(`  stepBots (bot policy + intent insert): ${avg(stepBotsMs).toFixed(2)} ms`);
  console.log(`  resolveTick (CH resolution):           ${avg(resolveMs).toFixed(2)} ms`);
  console.log(`  emitTickTelemetry (game_events + MV):  ${avg(teleMs).toFixed(2)} ms`);
  console.log("\n=== totals ===");
  console.log(`  state rows written: ${state_rows} (${PLAYERS} players x ${done} ticks)`);
  console.log(`  full-loop wall:     ${wallMs.toFixed(0)} ms for ${done} ticks (${(1000 / (wallMs / done)).toFixed(1)} full-ticks/sec incl. bots + telemetry)`);

  await ch.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
