import { AppShell } from "../../../components/app-shell";
import { DashboardTabs } from "../../../components/dashboard-tabs";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Telemetry command center</p>
            <h1 className="page-title-compact">Runs</h1>
          </div>
          <p className="page-dek">
            Every playthrough the swarm and humans have recorded, straight from game_runs.
          </p>
        </header>

        <DashboardTabs active="runs" />

        <section className="section-block">
          <p className="empty-state">The runs explorer is on its way.</p>
        </section>
      </main>
    </AppShell>
  );
}
