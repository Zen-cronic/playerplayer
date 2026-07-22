import { AppShell } from "../../../components/app-shell";
import { DashboardTabs } from "../../../components/dashboard-tabs";

export const dynamic = "force-dynamic";

export default async function LiveOpsPage() {
  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Telemetry command center</p>
            <h1 className="page-title-compact">Live ops</h1>
          </div>
          <p className="page-dek">
            Watch a wave of streaming bots land in ClickHouse in real time — the data shape
            of a multiplayer game, live.
          </p>
        </header>

        <DashboardTabs active="live" />

        <section className="section-block">
          <p className="empty-state">The live panel is on its way.</p>
        </section>
      </main>
    </AppShell>
  );
}
