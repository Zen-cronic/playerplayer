import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadDotEnv } from "../src/lib/env";
import { phaserAdapter } from "../src/game/adapter";
import { applyMutations, type Mutation } from "../src/game/mutate";
import { insertRunTelemetry } from "../src/lib/ingest";
import { ARCHETYPES } from "../src/game/bot";

// Reproduces the three demo experiments the video walks through, so the deltas
// are honest and re-runnable rather than a one-off in the database. Each is a
// real matched-seed A/B on Level1: same seeds play baseline and mutated, so the
// before/after is paired. Run: `npx tsx scripts/seed-demo.ts` (needs .env).
//
// The findings these produce are the point of the tool:
// - coins-to-safety: the coins sit deep in the slime room and lure rushers to
//   their deaths; moving them to the safe upper area drops the death rate hard
//   (a fix that WORKS — deaths down ~25pp, well above the ±8pp noise band).
// - crowd-the-corridor: piling the slimes onto the chokepoint every bot crosses
//   makes it worse (a change that BACKFIRES — deaths up).
//
// The demo's third beat — the obvious fix that does NOTHING (moving a chasing
// enemy just relocates deaths) — is best shown live, not seeded: whether a
// single enemy move nets zero depends on the exact destination and the seed
// sample, so pinning it as a fixed asset would overstate it. Run the what-if in
// the app and report whatever the swarm actually says.

const LEVEL = "Level1";
const RUNS_PER_VARIANT = Number(process.env.SEED_RUNS ?? 18);

interface DemoExperiment {
  id: string;
  mutations: Mutation[];
}

const t = (tile: number) => tile * 16;

const EXPERIMENTS: DemoExperiment[] = [
  {
    id: "coins-to-safety",
    // Move all 10 coins up to the safe area near spawn (tile ~22,5).
    mutations: Array.from({ length: 10 }, (_, i) => ({
      op: "move_object",
      objectType: "coins",
      index: i,
      toX: t(16 + (i % 8) * 2),
      toY: t(9 + Math.floor(i / 8)),
    })),
  },
  {
    id: "crowd-the-corridor",
    // Pile all 6 slimes onto the corridor chokepoint every bot must cross.
    mutations: Array.from({ length: 6 }, (_, i) => ({
      op: "move_object",
      objectType: "slime",
      index: i,
      toX: t(21 + (i % 3)),
      toY: t(15 + Math.floor(i / 3)),
    })),
  },
];

async function runVariant(experimentId: string, variant: string, mutations?: Mutation[]) {
  let mapPath: string | undefined;
  if (mutations?.length) {
    mapPath = applyMutations(
      LEVEL,
      mutations,
      path.join(os.tmpdir(), `seed-${experimentId}-${variant}`, "level1.json"),
    );
  }
  let deaths = 0;
  for (let i = 0; i < RUNS_PER_VARIANT; i++) {
    const result = await phaserAdapter.run({
      seed: `seed-${i}`,
      archetype: ARCHETYPES[i % ARCHETYPES.length],
      level: LEVEL,
      mapPath,
    });
    if (result.verdict === "lose") deaths++;
    await insertRunTelemetry({ experimentId, variant, runId: randomUUID() }, result);
  }
  return deaths;
}

async function main() {
  loadDotEnv();
  for (const { id, mutations } of EXPERIMENTS) {
    const baseline = await runVariant(id, "baseline");
    const mutated = await runVariant(id, "mutated", mutations);
    const bp = Math.round((100 * baseline) / RUNS_PER_VARIANT);
    const mp = Math.round((100 * mutated) / RUNS_PER_VARIANT);
    console.log(
      `${id.padEnd(22)} baseline ${bp}% → mutated ${mp}%  (Δ ${mp - bp > 0 ? "+" : ""}${mp - bp}pp)`,
    );
  }
  console.log("\nseeded demo experiments into ClickHouse.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
