"use client";

export interface FunnelOutput {
  experimentId: string;
  variant: string;
  stages: Array<{ stage: string; runs: number }>;
}

export function FunnelCard({ output }: { output: FunnelOutput }) {
  const started = Math.max(1, output.stages[0]?.runs ?? 1);
  return (
    <figure className="my-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <figcaption className="mb-2 text-xs font-medium text-zinc-200">
        progression funnel · {output.variant} · {output.experimentId}
      </figcaption>
      <div className="space-y-1">
        {output.stages.map((s) => {
          const pct = (s.runs / started) * 100;
          // The label stays truthful; only the drawn bar is clamped so a
          // malformed (non-monotonic or negative) tool output can't overflow
          // the track.
          const barWidth = Math.max(0, Math.min(100, pct));
          return (
            <div key={s.stage} className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-zinc-400">{s.stage}</span>
              <div className="h-4 flex-1 rounded bg-zinc-900">
                <div
                  className="h-4 rounded bg-indigo-600"
                  style={{ width: `${barWidth}%` }}
                  aria-hidden
                />
              </div>
              <span className="w-20 shrink-0 text-right text-zinc-400">
                {s.runs} ({pct.toFixed(0)}%)
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
