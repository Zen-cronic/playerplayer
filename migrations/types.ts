// Declarative migration format: everything that affects the database lives in
// `statements` (including any idempotence guards, expressed as SQL), so the
// checksum over a migration fully captures its behavior. postChecks gate the
// ledger write — a migration is only recorded as applied after its statements
// AND its parity checks pass.
export interface ParityCheck {
  name: string;
  // Both sides run with READ_SETTINGS; their JSONEachRow results must be
  // deeply equal. Give every multi-row query a total ORDER BY.
  sqlA: string;
  sqlB: string;
}

export interface Migration {
  id: number; // strictly increasing, unique
  name: string;
  statements: string[];
  postChecks?: ParityCheck[];
}
