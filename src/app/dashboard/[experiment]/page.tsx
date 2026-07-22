import Link from "next/link";
import { notFound } from "next/navigation";
import {
  experimentRoom,
  heatmap,
  heatmapDelta,
  listExperimentRefs,
  progressionFunnel,
  runCounts,
} from "../../../lib/queries";
import { HeatmapCard, DeltaCard, FunnelCard } from "playtest-copilot";
import { AppShell } from "../../../components/app-shell";

export const dynamic = "force-dynamic";

// Drill-in reuses the exact card components the chat renders — the dashboard
// is a second consumer of the same visual vocabulary, not a parallel UI.
export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ experiment: string }>;
}) {
  const { experiment } = await params;
  const experimentId = decodeURIComponent(experiment);

  const refs = await listExperimentRefs(100);
  const ref = refs.find((r) => r.experimentId === experimentId);
  if (!ref) notFound();

  // Derive the map from the data, not a Level1 assumption — a Level2-5 swarm
  // renders over its own geometry with correct labels.
  const ROOM = await experimentRoom(experimentId);
  const counts = await runCounts(experimentId);
  const variantA = ref.variants.includes("baseline") ? "baseline" : ref.variants[0];
  const variantB = ref.variants.find((v) => v !== variantA);

  const started = Date.now();
  const [cells, funnel, deltaCells] = await Promise.all([
    heatmap(experimentId, variantA, ROOM),
    progressionFunnel(experimentId, variantA),
    variantB ? heatmapDelta(experimentId, variantA, variantB, ROOM) : Promise.resolve(null),
  ]);
  const queryMs = Date.now() - started;

  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="experiment-intro">
          <div>
            <p className="eyebrow">Experiment evidence</p>
            <h1>{experimentId}</h1>
            <div className="experiment-meta">
              <span className="meta-chip">{ROOM}</span>
              <span className="meta-chip">
                {ref.variants.length} variant{ref.variants.length === 1 ? "" : "s"}
              </span>
              <span className="meta-chip">{ref.runs} total runs</span>
            </div>
          </div>
          <Link href="/dashboard" className="secondary-link">
            ← Experiment registry
          </Link>
        </header>

        <section className="metric-grid" aria-label="Experiment query summary">
          <div className="metric-cell">
            <span className="metric-label">Primary variant</span>
            <strong className="metric-value">{variantA}</strong>
            <span className="metric-note">{counts[variantA] ?? 0} matched runs</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">Compared with</span>
            <strong className="metric-value">{variantB ?? "—"}</strong>
            <span className="metric-note">
              {variantB ? `${counts[variantB] ?? 0} matched runs` : "Single-variant experiment"}
            </span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">Aggregated cells</span>
            <strong className="metric-value">{cells.length.toLocaleString()}</strong>
            <span className="metric-note">Materialized heatmap evidence</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">Query latency</span>
            <strong className="metric-value">{queryMs}ms</strong>
            <span className="metric-note">Three ClickHouse reads in parallel</span>
          </div>
        </section>

        <div className="visualization-stack">
          {deltaCells && variantB && (
            <section className="visualization-section" aria-labelledby="delta-heading">
              <header className="visualization-copy">
                <span className="section-index">01</span>
                <h2 id="delta-heading">Counterfactual delta</h2>
                <p>
                  Red cells got worse after the level mutation; green cells improved.
                  Matched seeds make the spatial comparison fair.
                </p>
              </header>
              <div className="visualization-card-slot">
                <DeltaCard
                  output={{
                    experimentId,
                    variantA,
                    variantB,
                    room: ROOM,
                    runsA: counts[variantA] ?? 0,
                    runsB: counts[variantB] ?? 0,
                    queryMs,
                    totals: {
                      deathsA: deltaCells.reduce((s, c) => s + c.deathsA, 0),
                      deathsB: deltaCells.reduce((s, c) => s + c.deathsB, 0),
                      deathRateA:
                        (counts[variantA] ?? 0) > 0
                          ? deltaCells.reduce((s, c) => s + c.deathsA, 0) / (counts[variantA] ?? 1)
                          : 0,
                      deathRateB:
                        (counts[variantB] ?? 0) > 0
                          ? deltaCells.reduce((s, c) => s + c.deathsB, 0) / (counts[variantB] ?? 1)
                          : 0,
                    },
                    cells: deltaCells,
                  }}
                />
              </div>
            </section>
          )}

          <section className="visualization-section" aria-labelledby="heatmap-heading">
            <header className="visualization-copy">
              <span className="section-index">{deltaCells && variantB ? "02" : "01"}</span>
              <h2 id="heatmap-heading">Failure field</h2>
              <p>
                Traffic builds a violet trace through the level. Ember cells mark deaths;
                select a hotspot to replay the exact culprit runs.
              </p>
            </header>
            <div className="visualization-card-slot">
              <HeatmapCard
                output={{
                  experimentId,
                  variant: variantA,
                  room: ROOM,
                  runs: counts[variantA] ?? 0,
                  queryMs,
                  cells,
                }}
              />
            </div>
          </section>

          <section className="visualization-section" aria-labelledby="funnel-heading">
            <header className="visualization-copy">
              <span className="section-index">{deltaCells && variantB ? "03" : "02"}</span>
              <h2 id="funnel-heading">Progression funnel</h2>
              <p>
                A quick read on how far players get before the level turns into friction.
              </p>
            </header>
            <div className="visualization-card-slot">
              <FunnelCard output={{ experimentId, variant: variantA, stages: funnel }} />
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
