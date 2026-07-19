import path from "node:path";
import { randomUUID } from "node:crypto";
import { runBot } from "./harness";
import { ARCHETYPES } from "./bot";
import { applyMutations, type Mutation } from "./mutate";
import { insertRunTelemetry } from "../lib/ingest";
import { loadDotEnv, cliArg } from "../lib/env";

// The default demo what-if: move the ambush slime guarding the Level1
// corridor mouth (352,272) down into the open lower room.
const DEFAULT_SPEC: Mutation[] = [
  { op: "move_object", objectType: "slime", index: 0, toX: 272, toY: 464 },
];

// Runs a matched-seed A/B experiment: same seeds play the vendored map
// (variant "baseline") and the mutated map (variant "mutated"), so the delta
// heatmap compares paired runs, not different luck.
async function main() {
  loadDotEnv();
  const experimentId = cliArg("experiment", `cf-${Date.now()}`);
  const runs = Number(cliArg("runs", "30"));
  const room = cliArg("room", "Level1");
  const seedBase = cliArg("seed", "cf");
  const spec = JSON.parse(cliArg("spec", JSON.stringify(DEFAULT_SPEC))) as Mutation[];

  const mutatedMap = applyMutations(
    room,
    spec,
    path.resolve(process.cwd(), `.variants/${experimentId}/${room.toLowerCase()}.json`),
  );
  console.log(`experiment ${experimentId}: ${runs} matched-seed runs per variant`);
  console.log(`mutation spec: ${JSON.stringify(spec)}`);

  for (const [variant, mapPath] of [
    ["baseline", undefined],
    ["mutated", mutatedMap],
  ] as const) {
    const wallStart = Date.now();
    let deaths = 0;
    let rows = 0;
    for (let i = 0; i < runs; i++) {
      // Mixed cohort: archetypes round-robin, same seed+archetype pairing on
      // both variants so the comparison stays paired.
      const result = await runBot({
        seed: `${seedBase}-${i}`,
        archetype: ARCHETYPES[i % ARCHETYPES.length],
        level: room,
        mapPath,
      });
      const { eventRows } = await insertRunTelemetry(
        { experimentId, variant, runId: randomUUID() },
        result,
      );
      rows += eventRows + 1;
      if (result.verdict === "lose") deaths++;
    }
    console.log(
      `  ${variant.padEnd(8)}: ${deaths}/${runs} runs died | ${rows} rows | ${((Date.now() - wallStart) / 1000).toFixed(1)}s wall`,
    );
  }

  console.log(
    `\ndelta view:\n  CLICKHOUSE_URL=... pnpm exec tsx src/game/query-heatmap.ts --experiment ${experimentId} --compare mutated`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
