import Link from "next/link";
import { experimentRows, watchReportRows } from "../../lib/queries";
import { getClickHouse, READ_SETTINGS } from "../../lib/clickhouse";
import { AppShell, ArrowUpRight } from "../../components/app-shell";

// Mission control, not the pitch: the chat is where questions get answered.
// This is the registry — what has run, and what the nightly canary saw.
export const dynamic = "force-dynamic";

async function stackTotals() {
  const started = Date.now();
  try {
    const rs = await getClickHouse().query({
      query: "SELECT count() AS events, uniqExact(run_id) AS runs FROM bot_events",
      format: "JSONEachRow",
      clickhouse_settings: READ_SETTINGS,
    });
    const [row] = await rs.json<{ events: string; runs: string }>();
    return {
      ok: true,
      events: Number(row?.events ?? 0),
      runs: Number(row?.runs ?? 0),
      ms: Date.now() - started,
    };
  } catch {
    return { ok: false, events: 0, runs: 0, ms: Date.now() - started };
  }
}

const VERDICT_STYLES: Record<string, string> = {
  stable: "verdict-stable",
  shifted: "verdict-shifted",
  easier: "verdict-easier",
  harder: "verdict-harder",
  "first-night": "verdict-first-night",
};

export default async function DashboardPage() {
  const [experiments, reports, totals] = await Promise.all([
    experimentRows(),
    watchReportRows(),
    stackTotals(),
  ]);
  const totalDeaths = experiments.reduce((sum, experiment) => sum + experiment.deaths, 0);
  const observedRuns = experiments.reduce((sum, experiment) => sum + experiment.runs, 0);
  const deathRate = observedRuns > 0 ? Math.round((totalDeaths / observedRuns) * 100) : 0;

  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Telemetry command center</p>
            <h1 className="page-title-compact">Experiment registry</h1>
          </div>
          <p className="page-dek">
            Every hypothesis the agent has tested, the variants it compared, and the
            nightly canary watching for a spatial regression.
          </p>
        </header>

        <section className="metric-grid" aria-label="Experiment overview">
          <div className="metric-cell">
            <span className="metric-label">Bot runs</span>
            <strong className="metric-value">{totals.runs.toLocaleString()}</strong>
            <span className="metric-note">Across every retained trace</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">Telemetry events</span>
            <strong className="metric-value">{totals.events.toLocaleString()}</strong>
            <span className="metric-note">
              ClickHouse Cloud · {totals.events.toLocaleString()} events from{" "}
              {totals.runs.toLocaleString()} runs · {totals.ms}ms
            </span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">Experiments</span>
            <strong className="metric-value">{experiments.length}</strong>
            <span className="metric-note">Server-rendered from bot_runs</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">Observed deaths</span>
            <strong className="metric-value">{deathRate}%</strong>
            <span className="metric-note">{totalDeaths.toLocaleString()} across registry rows</span>
          </div>
        </section>

        <section className="section-block" aria-labelledby="watch-heading">
          <header className="section-heading">
            <span className="section-index">01</span>
            <h2 id="watch-heading">Nightly regression watch</h2>
            <p>Fixed seeds turn a shifting play pattern into a comparable nightly signal.</p>
          </header>
          {reports.length === 0 ? (
            <p className="empty-state">No canary runs yet — the schedule fires at 03:00 UTC.</p>
          ) : (
            <ul className="watch-list">
              {reports.map((report) => (
                <li key={`${report.room}-${report.date}`} className="watch-row">
                  <span className="watch-date">{report.date}</span>
                  <span className={`verdict ${VERDICT_STYLES[report.verdict] ?? "verdict-stable"}`}>
                    {report.verdict}
                  </span>
                  <span className="watch-summary">
                    {(report.deathRate * 100).toFixed(0)}% deaths over {report.runs} fixed-seed runs
                  </span>
                  <span className="watch-detail">
                    {report.cellsChanged} cells changed vs {report.prevDate}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section-block" aria-labelledby="experiments-heading">
          <header className="section-heading">
            <span className="section-index">02</span>
            <h2 id="experiments-heading">Experiments</h2>
            <p>Select any row to inspect its spatial delta, death heatmap, and funnel.</p>
          </header>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>experiment</th>
                  <th>variants</th>
                  <th>runs</th>
                  <th>deaths</th>
                  <th>last run</th>
                </tr>
              </thead>
              <tbody>
                {experiments.map((experiment) => {
                  const pct = experiment.runs
                    ? Math.round((experiment.deaths / experiment.runs) * 100)
                    : 0;
                  return (
                    <tr key={experiment.experimentId}>
                      <td>
                        <Link
                          href={`/dashboard/${encodeURIComponent(experiment.experimentId)}`}
                          className="experiment-link"
                        >
                          {experiment.experimentId}
                          <ArrowUpRight />
                        </Link>
                      </td>
                      <td className="variant-list">{experiment.variants.join(", ")}</td>
                      <td>{experiment.runs}</td>
                      <td className="death-cell">
                        <span className="death-cell-line">
                          <span>{experiment.deaths} <span className="muted-copy">({pct}%)</span></span>
                          <span className="death-rate-track" aria-hidden="true">
                            <span className="death-rate-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                          </span>
                        </span>
                      </td>
                      <td className="table-mono muted-copy">{experiment.lastRun}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
