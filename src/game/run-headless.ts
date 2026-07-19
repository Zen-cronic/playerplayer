import { runBot } from "./harness";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const runs = Number(arg("runs", "1"));
  const seedBase = arg("seed", "spike");

  let totalSim = 0;
  let totalWall = 0;

  for (let i = 0; i < runs; i++) {
    const result = await runBot({ seed: `${seedBase}-${i}` });
    totalSim += result.simMs;
    totalWall += result.wallMs;
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
      `→ ${(totalSim / Math.max(totalWall, 1)).toFixed(1)}x realtime`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
