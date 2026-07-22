import { createHash, randomUUID } from "node:crypto";
import { phaserAdapter } from "./adapter";
import { loadDotEnv, cliArg as arg } from "../lib/env";

async function main() {
  const runs = Number(arg("runs", "1"));
  const seedBase = arg("seed", "spike");
  const insert = process.argv.includes("--insert");
  const experimentId = arg("experiment", "local-spike");
  const variant = arg("variant", "baseline");
  // Live-mode pacing dial (e.g. --pace 3 ≈ 3x realtime). Note: paced runs are
  // NOT frame-deterministic vs flat-out (see headless-context) — the digest
  // below compares flat-out runs to each other, which must be identical.
  const pace = Number(arg("pace", "0")) || undefined;

  if (insert) loadDotEnv();

  let totalSim = 0;
  let totalWall = 0;
  let totalRows = 0;

  const archetype = arg("archetype", "explorer") as import("./bot").BotArchetype;

  for (let i = 0; i < runs; i++) {
    const result = await phaserAdapter.run({ seed: `${seedBase}-${i}`, archetype, pace });
    totalSim += result.simMs;
    totalWall += result.wallMs;
    // Wall-independent digest over the full event stream (t/type/x/y/state) —
    // two flat-out runs of the same seed must print the same digest.
    const digest = createHash("sha256")
      .update(result.events.map((e) => `${e.t}|${e.type}|${e.x}|${e.y}|${e.health}|${e.coins}|${e.detail}`).join("\n"))
      .digest("hex")
      .slice(0, 16);
    console.log(`run ${i}: events digest ${digest}`);

    if (insert) {
      const { insertRunTelemetry } = await import("../lib/ingest");
      const runId = randomUUID();
      const { eventRows } = await insertRunTelemetry({ experimentId, variant, runId }, result);
      totalRows += eventRows + 1;
      console.log(`    → inserted ${eventRows} game_events rows + 1 game_runs row (run_id ${runId})`);
    }
    const counts = result.events.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `run ${i}: ${result.verdict.padEnd(7)} sim=${(result.simMs / 1000).toFixed(1)}s ` +
        `wall=${(result.wallMs / 1000).toFixed(1)}s coins=${result.coins} ` +
        `rooms=[${result.roomsVisited.join(",")}] events=${result.events.length} ` +
        `(${Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(" ")})`,
    );
    if (process.argv.includes("--verbose")) {
      for (const e of result.events) {
        if (e.type === "pos") continue;
        console.log(
          `    t=${String(e.t).padStart(6)}ms ${e.type.padEnd(12)} (${e.x},${e.y}) ` +
            `hp=${e.health} coins=${e.coins} room=${e.room} ${e.detail}`,
        );
      }
    }
  }

  console.log(
    `\n${runs} run(s): total sim ${(totalSim / 1000).toFixed(1)}s in wall ${(totalWall / 1000).toFixed(1)}s ` +
      `→ ${(totalSim / Math.max(totalWall, 1)).toFixed(1)}x realtime` +
      (insert ? ` | ${totalRows} rows inserted into ClickHouse` : ""),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
