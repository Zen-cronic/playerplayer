import { AppShell } from "../../../components/app-shell";
import { DashboardTabs } from "../../../components/dashboard-tabs";
import { LiveOpsClient } from "./live-client";

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
            Paced bots stream telemetry into ClickHouse mid-run while this panel polls the
            firehose — the data shape of a multiplayer game, watched live.
          </p>
        </header>

        <DashboardTabs active="live" />

        <LiveOpsClient />
      </main>
    </AppShell>
  );
}
