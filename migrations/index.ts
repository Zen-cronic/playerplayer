import type { Migration } from "./types";
import { v1Baseline } from "./0001_v1_baseline";
import { envelope } from "./0002_envelope";
import { backfill } from "./0003_backfill";

export type { Migration, ParityCheck } from "./types";

export const MIGRATIONS: Migration[] = [v1Baseline, envelope, backfill];

// Fail at import time, not mid-apply: the chain must be strictly increasing so
// "applied set + first pending" is unambiguous everywhere it is read.
for (let i = 0; i < MIGRATIONS.length; i++) {
  const m = MIGRATIONS[i];
  if (!Number.isInteger(m.id) || m.id <= 0 || !m.name) {
    throw new Error(`migration at index ${i} has an invalid id/name`);
  }
  if (i > 0 && m.id <= MIGRATIONS[i - 1].id) {
    throw new Error(`migration ids must be strictly increasing (${MIGRATIONS[i - 1].id} then ${m.id})`);
  }
}
