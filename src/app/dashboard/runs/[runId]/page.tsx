import Link from "next/link";
import { notFound } from "next/navigation";
import { runHeader, runEventTimeline } from "../../../../lib/ops-queries";
import { runTrails } from "../../../../lib/queries";
import { AppShell } from "../../../../components/app-shell";
import { RunTrailCanvas } from "./run-trail";

export const dynamic = "force-dynamic";

const VERDICT_CLASS: Record<string, string> = {
  win: "verdict-easier",
  lose: "verdict-harder",
  timeout: "verdict-shifted",
};

// One playthrough, end to end: the header resolves the run by id alone, which
// hands back the full sort-key prefix — the trail and timeline reads are then
// true primary-key range scans over game_events.
export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await runHeader(decodeURIComponent(runId));
  if (!run) notFound();

  const started = Date.now();
  const [trails, events] = await Promise.all([
    runTrails(run.experimentId, run.variant, [run.runId]),
    runEventTimeline(run.experimentId, run.variant, run.runId),
  ]);
  const queryMs = Date.now() - started;

  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="experiment-intro">
          <div>
            <p className="eyebrow">Run evidence</p>
            <h1 className="table-mono">{run.runId.slice(0, 13)}…</h1>
            <div className="experiment-meta">
              <span className={`verdict ${VERDICT_CLASS[run.verdict] ?? "verdict-stable"}`}>{run.verdict}</span>
              <span className="meta-chip">{run.archetype}</span>
              <span className="meta-chip">seed {run.seed}</span>
              <span className="meta-chip">{run.room}</span>
              <span className="meta-chip">{(run.simMs / 1000).toFixed(1)}s sim</span>
              <span className="meta-chip">{run.coins} coins</span>
            </div>
          </div>
          <Link
            href={`/dashboard/${encodeURIComponent(run.experimentId)}`}
            className="secondary-link"
          >
            ← {run.experimentId}
          </Link>
        </header>

        <div className="visualization-stack">
          <section className="visualization-section" aria-labelledby="trail-heading">
            <header className="visualization-copy">
              <span className="section-index">01</span>
              <h2 id="trail-heading">Ghost trail</h2>
              <p>
                The run&apos;s ~10Hz path replayed over the level — read from game_events by
                primary key in {queryMs}ms.
              </p>
            </header>
            <div className="visualization-card-slot">
              {trails.length === 0 ? (
                <p className="empty-state">No position samples recorded for this run.</p>
              ) : (
                <RunTrailCanvas room={run.room} trails={trails} />
              )}
            </div>
          </section>

          <section className="visualization-section" aria-labelledby="timeline-heading">
            <header className="visualization-copy">
              <span className="section-index">02</span>
              <h2 id="timeline-heading">Event timeline</h2>
              <p>Every discrete event in order — position samples live in the trail above.</p>
            </header>
            <div className="visualization-card-slot">
              {events.length === 0 ? (
                <p className="empty-state">No discrete events recorded.</p>
              ) : (
                <ul className="watch-list">
                  {events.map((e, i) => (
                    <li key={`${e.t}-${e.type}-${i}`} className="watch-row">
                      <span className="watch-date">{(e.t / 1000).toFixed(2)}s</span>
                      <span className={`verdict ${e.type === "death" ? "verdict-harder" : e.type === "pickup_coin" ? "verdict-easier" : "verdict-stable"}`}>
                        {e.type}
                      </span>
                      <span className="watch-summary">
                        {e.room} · {e.health} hp · {e.coins} coins
                      </span>
                      <span className="watch-detail">{e.detail || "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
