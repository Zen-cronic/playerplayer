import { runBot } from "./harness";
import { simNow } from "./headless-context";

// Diagnostic: sequential runs must not leak RAF loops (constant pos-sample
// density, zero sim-clock advance while idle).
async function main() {
  for (let i = 0; i < 3; i++) {
    const r = await runBot({ seed: `leak-${i}`, timeoutSimMs: 30_000 });
    console.log(`run ${i}: pos=${r.events.filter((e) => e.type === "pos").length} (expect ~300) simMs=${r.simMs}`);
  }
  const a = simNow();
  await new Promise((r) => setTimeout(r, 300));
  console.log("idle sim advance over 300ms wall:", Math.round(simNow() - a), "ms (expect 0)");
  process.exit(0);
}
main();
