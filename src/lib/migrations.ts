import { createHash } from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";
import { MIGRATIONS, type Migration } from "../../migrations";
import { READ_SETTINGS } from "./clickhouse";

// Forward-only migrations with a hard responsibility split: the CLI (scripts/migrate.ts)
// is the ONLY path that applies migrations; app/worker processes call ensureMigrations(),
// which only VERIFIES the ledger and throws when the database is behind or drifted. That
// split makes a concurrent double-apply (two cold processes both backfilling) impossible.

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id UInt32,
    name String,
    checksum String,
    applied_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = ReplacingMergeTree(applied_at)
  ORDER BY id
`;

export function checksumOf(m: Migration): string {
  return createHash("sha256")
    .update(m.statements.join("\n--;--\n") + JSON.stringify(m.postChecks ?? []))
    .digest("hex");
}

interface LedgerRow {
  id: number;
  name: string;
  checksum: string;
  applied_at: string;
}

// argMax reads correctly even with unmerged ReplacingMergeTree duplicates — no FINAL/
// OPTIMIZE. The max() output must NOT be aliased back to `applied_at`: ClickHouse
// substitutes aliases into sibling expressions, turning argMax(name, applied_at) into an
// aggregate-inside-aggregate (ILLEGAL_AGGREGATION).
async function readLedger(ch: ClickHouseClient): Promise<Map<number, LedgerRow>> {
  const rs = await ch.query({
    query: `
      SELECT id,
             argMax(name, applied_at) AS name,
             argMax(checksum, applied_at) AS checksum,
             toString(max(applied_at)) AS last_applied
      FROM schema_migrations
      GROUP BY id
      ORDER BY id
    `,
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const rows = await rs.json<Omit<LedgerRow, "applied_at"> & { last_applied: string }>();
  return new Map(rows.map((r) => [Number(r.id), { id: Number(r.id), name: r.name, checksum: r.checksum, applied_at: r.last_applied }]));
}

function isMissingLedger(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNKNOWN_TABLE|doesn't exist|does not exist|Code:\s*60/i.test(msg);
}

export type MigrationState = "applied" | "pending" | "drift";

export interface MigrationStatus {
  id: number;
  name: string;
  state: MigrationState;
  appliedAt?: string;
}

export async function migrationStatus(ch: ClickHouseClient): Promise<MigrationStatus[]> {
  let ledger: Map<number, LedgerRow>;
  try {
    ledger = await readLedger(ch);
  } catch (e) {
    if (!isMissingLedger(e)) throw e;
    ledger = new Map();
  }
  return MIGRATIONS.map((m) => {
    const row = ledger.get(m.id);
    if (!row) return { id: m.id, name: m.name, state: "pending" as const };
    const state = row.checksum === checksumOf(m) ? ("applied" as const) : ("drift" as const);
    return { id: m.id, name: m.name, state, appliedAt: row.applied_at };
  });
}

async function runPostChecks(ch: ClickHouseClient, m: Migration): Promise<void> {
  for (const check of m.postChecks ?? []) {
    const [a, b] = await Promise.all(
      [check.sqlA, check.sqlB].map(async (query) => {
        const rs = await ch.query({ query, format: "JSONEachRow", clickhouse_settings: READ_SETTINGS });
        return rs.json<Record<string, unknown>>();
      }),
    );
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(
        `parity check "${check.name}" failed for ${m.id}_${m.name}\n  A: ${JSON.stringify(a)}\n  B: ${JSON.stringify(b)}`,
      );
    }
  }
}

// CLI-only. Applies pending migrations in order; recorded only after statements AND
// postChecks succeed, so a failed run leaves it pending and re-runnable. Checksum drift on
// an applied migration is a hard failure — never edit an applied migration, add a new one.
export async function applyPending(
  ch: ClickHouseClient,
  log: (line: string) => void = () => {},
): Promise<MigrationStatus[]> {
  await ch.command({ query: LEDGER_DDL, clickhouse_settings: { wait_end_of_query: 1 } });
  const ledger = await readLedger(ch);
  const applied: MigrationStatus[] = [];
  for (const m of MIGRATIONS) {
    const row = ledger.get(m.id);
    const checksum = checksumOf(m);
    if (row) {
      if (row.checksum !== checksum) {
        throw new Error(`checksum drift on applied migration ${m.id}_${m.name} — never edit an applied migration`);
      }
      continue;
    }
    const started = Date.now();
    for (const [i, statement] of m.statements.entries()) {
      try {
        await ch.command({ query: statement, clickhouse_settings: { wait_end_of_query: 1 } });
      } catch (e) {
        throw new Error(
          `${m.id}_${m.name} failed at statement ${i + 1}/${m.statements.length}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    await runPostChecks(ch, m);
    await ch.insert({
      table: "schema_migrations",
      values: [{ id: m.id, name: m.name, checksum }],
      format: "JSONEachRow",
    });
    log(`${m.id}_${m.name} … applied (${Date.now() - started}ms)`);
    applied.push({ id: m.id, name: m.name, state: "applied" });
  }
  return applied;
}

// CLI `verify`: re-run parity checks of every applied, reverifiable migration. Apply-time-
// only gates (reverifiable: false) are reported, not re-run — their source data diverges
// after cutover by design.
export async function verifyApplied(
  ch: ClickHouseClient,
  log: (line: string) => void = () => {},
): Promise<void> {
  const statuses = await migrationStatus(ch);
  for (const s of statuses) {
    if (s.state !== "applied") continue;
    const m = MIGRATIONS.find((x) => x.id === s.id)!;
    if (m.reverifiable === false) {
      log(`${m.id}_${m.name} … apply-time gate (${m.postChecks?.length ?? 0} checks passed at apply; source diverges post-cutover by design)`);
      continue;
    }
    await runPostChecks(ch, m);
    log(`${m.id}_${m.name} … ${m.postChecks?.length ?? 0} checks OK`);
  }
}

let migrationsReady: Promise<void> | null = null;

// App/worker entry point: verify-only, memoized per process. Throws when the database is
// behind or drifted — never applies anything. Callers degrade opaquely (the ingest route
// 500s generically; a Trigger run fails visibly).
export function ensureMigrations(ch: ClickHouseClient): Promise<void> {
  migrationsReady ??= (async () => {
    let statuses: MigrationStatus[];
    try {
      statuses = await migrationStatus(ch);
    } catch (e) {
      if (isMissingLedger(e)) {
        throw new Error('ClickHouse schema is uninitialized — run "pnpm migrate"');
      }
      throw e;
    }
    const bad = statuses.filter((s) => s.state !== "applied");
    if (bad.length > 0) {
      const detail = bad.map((s) => `${s.id}_${s.name}:${s.state}`).join(", ");
      throw new Error(`ClickHouse schema is behind — run "pnpm migrate" (${detail})`);
    }
  })().catch((e) => {
    migrationsReady = null;
    throw e;
  });
  return migrationsReady;
}
