import { AppShell } from "../../../components/app-shell";
import { DashboardTabs } from "../../../components/dashboard-tabs";

export const dynamic = "force-dynamic";

export default async function AgentLogPage() {
  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Telemetry command center</p>
            <h1 className="page-title-compact">Agent log</h1>
          </div>
          <p className="page-dek">
            Every chat session, tool call, and approval the agent has made — ClickHouse as
            the observability store for the agent itself.
          </p>
        </header>

        <DashboardTabs active="agent" />

        <section className="section-block">
          <p className="empty-state">No agent sessions logged yet.</p>
        </section>
      </main>
    </AppShell>
  );
}
