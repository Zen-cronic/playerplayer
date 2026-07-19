import { tasks, runs } from "@trigger.dev/sdk";
import { loadDotEnv } from "../src/lib/env";
import type { runExperiment } from "../src/trigger/run-experiment";

// Smoke test for the swarm fan-out: requires `pnpm dev:trigger` running.
// Small matched-seed A/B experiment (2 variants × N runs) through
// batchTriggerAndWait, verifying the mutations-in-payload path.
async function main() {
  loadDotEnv();
  const experimentId = `swarm-smoke-${Date.now()}`;

  const handle = await tasks.trigger<typeof runExperiment>("run-experiment", {
    experimentId,
    runsPerVariant: 6,
    mutations: [{ op: "move_object", objectType: "slime", index: 0, toX: 272, toY: 464 }],
  });
  console.log(`triggered run-experiment: ${handle.id} (experiment ${experimentId})`);

  const deadline = Date.now() + 420_000;
  for (;;) {
    const run = await runs.retrieve(handle.id);
    if (run.status === "COMPLETED") {
      console.log("run-experiment: COMPLETED");
      console.log(JSON.stringify(run.output, null, 2));
      break;
    }
    if (["FAILED", "CRASHED", "CANCELED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT"].includes(run.status)) {
      throw new Error(`run-experiment: ${run.status} — ${JSON.stringify(run.error ?? {})}`);
    }
    if (Date.now() > deadline) throw new Error(`poll timeout (status ${run.status})`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
