// Shown while the dashboard's server components run their ClickHouse queries.
// A skeleton keeps the layout stable instead of flashing a blank page on the
// drill-in's three-query fetch.
import { AppShell } from "../../components/app-shell";

export default function DashboardLoading() {
  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad" aria-busy="true" aria-label="Loading analytics">
        <p className="eyebrow">Querying ClickHouse</p>
        <div className="mt-5 skeleton-line" />
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="skeleton-panel" />
          <div className="skeleton-panel" />
        </div>
        <div className="mt-12 skeleton-panel !h-[420px]" />
      </main>
    </AppShell>
  );
}
