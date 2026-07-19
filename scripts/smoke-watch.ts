import { tasks, runs } from "@trigger.dev/sdk";
import { loadDotEnv } from "../src/lib/env";

async function main() {
  loadDotEnv();
  const offsetDays = Number(process.argv[process.argv.indexOf("--offset-days") + 1] || 0);
  const handle = await tasks.trigger("regression-watch", {
    scheduleId: "manual-test",
    timestamp: new Date(Date.now() + offsetDays * 86_400_000),
    lastTimestamp: undefined,
    timezone: "UTC",
    upcoming: [],
  });
  console.log(`triggered regression-watch: ${handle.id}`);
  const deadline = Date.now() + 420_000;
  for (;;) {
    const run = await runs.retrieve(handle.id);
    if (run.status === "COMPLETED") {
      console.log("COMPLETED:", JSON.stringify(run.output));
      break;
    }
    if (["FAILED", "CRASHED", "CANCELED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT"].includes(run.status)) {
      throw new Error(`${run.status}: ${JSON.stringify(run.error ?? {})}`);
    }
    if (Date.now() > deadline) throw new Error(`timeout (${run.status})`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
