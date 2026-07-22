"use client";

import { AppShell } from "../../components/app-shell";

// Segment error boundary for /dashboard and /dashboard/[experiment]. A momentary
// ClickHouse hiccup should degrade to a retryable card, never a raw 500 on a
// recorded, shared surface. The message is fixed — a connection error can carry
// the host, so we never render error.detail here.
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <AppShell active="analytics">
      <main className="demo-page error-shell">
        <div className="error-panel">
          <span className="eyebrow">Connection interrupted</span>
          <h1>Couldn&apos;t reach the data layer</h1>
          <p>
          The dashboard reads live from ClickHouse and the query didn&apos;t come back. This is
          usually transient — try again in a moment.
          </p>
          <div className="error-actions">
            <button onClick={reset} className="primary-link">Try again</button>
            <a href="/" className="secondary-link">Back to the game</a>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
