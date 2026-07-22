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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold tracking-tight">{experimentId}</h1>
          <p className="text-sm text-zinc-500">
            {ref.runs} runs across {ref.variants.length} variant
            {ref.variants.length === 1 ? "" : "s"} · {ROOM}
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← registry
        </Link>
      </header>

      {deltaCells && variantB && (
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
      )}

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

      <FunnelCard output={{ experimentId, variant: variantA, stages: funnel }} />
    </main>
  );
}
