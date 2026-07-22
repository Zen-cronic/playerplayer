import { createClient } from "@clickhouse/client";
import { loadDotEnv } from "../src/lib/env";
import { applyPending, migrationStatus, verifyApplied } from "../src/lib/migrations";

// The ONE code path that applies migrations (ensureMigrations only verifies).
//   pnpm migrate         apply pending, in order
//   pnpm migrate:status  ledger vs code — exit 1 if anything pending/drifted
//   pnpm migrate:verify  re-run parity checks of applied migrations
loadDotEnv();

// Error messages can embed the connection URL (with credentials) on transport
// failures — scrub before printing.
function scrub(text: string): string {
  const url = process.env.CLICKHOUSE_URL;
  let out = url ? text.split(url).join("[clickhouse-url]") : text;
  out = out.replace(/https?:\/\/\S+/g, "[url]");
  return out;
}

async function main(): Promise<number> {
  const cmd = process.argv[2] ?? "up";
  const url = process.env.CLICKHOUSE_URL;
  if (!url) {
    console.error("CLICKHOUSE_URL is not set (need .env)");
    return 1;
  }
  // Own client, not the app singleton: a backfill INSERT SELECT needs more
  // headroom than the default 30s request timeout.
  const ch = createClient({ url, request_timeout: 300_000 });
  try {
    if (cmd === "up") {
      const applied = await applyPending(ch, (line) => console.log(`  ${line}`));
      console.log(applied.length === 0 ? "nothing to apply — ledger is current" : `applied ${applied.length} migration(s)`);
      return 0;
    }
    if (cmd === "status") {
      const statuses = await migrationStatus(ch);
      for (const s of statuses) {
        const when = s.appliedAt ? ` @ ${s.appliedAt}` : "";
        console.log(`  ${String(s.id).padStart(4, "0")}_${s.name.padEnd(24)} ${s.state.toUpperCase()}${when}`);
      }
      return statuses.every((s) => s.state === "applied") ? 0 : 1;
    }
    if (cmd === "verify") {
      await verifyApplied(ch, (line) => console.log(`  ${line}`));
      console.log("all parity checks passed");
      return 0;
    }
    console.error(`unknown command "${cmd}" — use up | status | verify`);
    return 1;
  } catch (e) {
    console.error(scrub(e instanceof Error ? e.message : String(e)));
    return 1;
  } finally {
    await ch.close();
  }
}

main().then((code) => process.exit(code));
