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
import { experimentAgentTrail, promptForTurn, type LineageStep } from "../../../lib/agent-queries";
import { runsSpan } from "../../../lib/ops-queries";
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
  const [cells, funnel, deltaCells, trail, span] = await Promise.all([
    heatmap(experimentId, variantA, ROOM),
    progressionFunnel(experimentId, variantA),
    variantB ? heatmapDelta(experimentId, variantA, variantB, ROOM) : Promise.resolve(null),
    experimentAgentTrail(experimentId).catch(() => [] as LineageStep[]),
    runsSpan(experimentId).catch(() => null),
  ]);
  const queryMs = Date.now() - started;

  // Lineage pieces: only rendered when the agent actually drove this
  // experiment — dashboard-seeded experiments have no trail and must not look
  // broken. The prompt is user-authored, so it follows the same privacy gate
  // as /dashboard/agent.
  const firstTrail = trail[0];
  const prompt = firstTrail
    ? await promptForTurn(firstTrail.sessionId, firstTrail.turn).catch(() => null)
    : null;
  const showUserContent = process.env.AGENT_LOG_PUBLIC === "1";
  const approvals = trail.filter((t) => t.kind === "approval");
  const spanSeconds =
    span && span.first !== span.last
      ? Math.max(1, Math.round((Date.parse(span.last) - Date.parse(span.first)) / 1000))
      : null;
  const deathsA = deltaCells?.reduce((s, c) => s + c.deathsA, 0) ?? 0;
  const deathsB = deltaCells?.reduce((s, c) => s + c.deathsB, 0) ?? 0;
  const rateA = (counts[variantA] ?? 0) > 0 ? deathsA / (counts[variantA] ?? 1) : 0;
  const rateB = variantB && (counts[variantB] ?? 0) > 0 ? deathsB / (counts[variantB] ?? 1) : 0;
  const deltaPp = variantB ? Math.round((rateB - rateA) * 100) : 0;

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

        {trail.length > 0 && (
          <section className="section-block" aria-labelledby="lineage-heading">
            <header className="section-heading">
              <span className="section-index">00</span>
              <h2 id="lineage-heading">Lineage</h2>
              <p>How this experiment came to exist — prompt, approval, swarm, verdict.</p>
            </header>
            <ul className="watch-list">
              <li className="watch-row">
                <span className="watch-date">{(prompt?.ts ?? firstTrail.ts).slice(0, 19)}</span>
                <span className="verdict verdict-stable">prompt</span>
                <span className="watch-summary">
                  {prompt
                    ? showUserContent
                      ? prompt.content
                      : "designer prompt (content hidden · AGENT_LOG_PUBLIC=0)"
                    : "asked in chat"}
                </span>
                <span className="watch-detail">
                  session {firstTrail.sessionId.slice(0, 10)} · turn {firstTrail.turn}
                </span>
              </li>
              {approvals.map((a, i) => (
                <li key={`appr-${i}`} className="watch-row">
                  <span className="watch-date">{a.ts.slice(0, 19)}</span>
                  <span className="verdict verdict-first-night">approval</span>
                  <span className="watch-summary">
                    {a.tool} · {a.content}
                  </span>
                  <span className="watch-detail">human-in-the-loop gate</span>
                </li>
              ))}
              {span && (
                <li className="watch-row">
                  <span className="watch-date">{span.first.slice(0, 19)}</span>
                  <span className="verdict verdict-shifted">swarm</span>
                  <span className="watch-summary">
                    {span.runs} runs{spanSeconds ? ` over ${spanSeconds}s` : ""}
                  </span>
                  <span className="watch-detail">matched seeds, both variants</span>
                </li>
              )}
              {deltaCells && variantB && (
                <li className="watch-row">
                  <span className="watch-date">{span?.last.slice(0, 19) ?? ""}</span>
                  <span
                    className={`verdict ${deltaPp < 0 ? "verdict-easier" : deltaPp > 0 ? "verdict-harder" : "verdict-stable"}`}
                  >
                    verdict
                  </span>
                  <span className="watch-summary">
                    {Math.round(rateA * 100)}% → {Math.round(rateB * 100)}% deaths
                    {deltaPp !== 0
                      ? ` (${deltaPp > 0 ? "up" : "down"} ${Math.abs(deltaPp)}pp)`
                      : " (no clear change)"}
                  </span>
                  <span className="watch-detail">from the delta card below</span>
                </li>
              )}
            </ul>
          </section>
        )}

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
