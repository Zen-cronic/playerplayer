import { tasks, runs } from "@trigger.dev/sdk";
import { loadDotEnv } from "../src/lib/env";
import type { helloClickhouse } from "../src/trigger/hello-clickhouse";
import type { botRun } from "../src/trigger/bot-run";

// Smoke test for the Trigger.dev leg: requires `pnpm dev:trigger` running.
// Triggers hello-clickhouse (CH round-trip) and one bot-run (full pipeline
// inside a task), then polls both to completion.
async function poll(runId: string, label: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const run = await runs.retrieve(runId);
    if (run.status === "COMPLETED") {
      console.log(`${label}: COMPLETED`);
      console.log(`  output: ${JSON.stringify(run.output).slice(0, 300)}`);
      return;
    }
    if (["FAILED", "CRASHED", "CANCELED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT"].includes(run.status)) {
      throw new Error(`${label}: ${run.status} — ${JSON.stringify(run.error ?? {})}`);
    }
    if (Date.now() > deadline) throw new Error(`${label}: poll timeout (status ${run.status})`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  loadDotEnv();

  const hello = await tasks.trigger<typeof helloClickhouse>("hello-clickhouse", {
    message: "smoke test via trigger.dev",
  });
  console.log(`triggered hello-clickhouse: ${hello.id}`);
  await poll(hello.id, "hello-clickhouse");

  const bot = await tasks.trigger<typeof botRun>("bot-run", {
    experimentId: "trigger-smoke",
    variant: "baseline",
    seed: "smoke-0",
    archetype: "rusher",
  });
  console.log(`triggered bot-run: ${bot.id}`);
  await poll(bot.id, "bot-run");

  console.log("\ntrigger.dev smoke: ALL GREEN");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
