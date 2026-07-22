"use client";

export interface FunnelOutput {
  experimentId: string;
  variant: string;
  stages: Array<{ stage: string; runs: number }>;
}

export function FunnelCard({ output }: { output: FunnelOutput }) {
  const started = Math.max(1, output.stages[0]?.runs ?? 1);
  const completed = output.stages.at(-1)?.runs ?? 0;
  return (
    <figure className="ps-data-card ps-funnel-card">
      <figcaption className="ps-card-header">
        <span>
          <span className="ps-card-eyebrow">Run progression</span>
          <strong>progression funnel</strong>
        </span>
        <span className="ps-card-context">{output.variant} · {output.experimentId}</span>
      </figcaption>
      <div className="ps-funnel-overview">
        <span><small>Started</small><strong>{started}</strong></span>
        <span aria-hidden="true">→</span>
        <span><small>Final stage</small><strong>{completed}</strong></span>
        <span className="ps-funnel-rate">{((completed / started) * 100).toFixed(0)}% retained</span>
      </div>
      <div className="ps-funnel-rows">
        {output.stages.map((s, index) => {
          const pct = (s.runs / started) * 100;
          // The label stays truthful; only the drawn bar is clamped so a
          // malformed (non-monotonic or negative) tool output can't overflow
          // the track.
          const barWidth = Math.max(0, Math.min(100, pct));
          return (
            <div key={s.stage} className="ps-funnel-row">
              <span className="ps-funnel-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="ps-funnel-stage">{s.stage}</span>
              <div className="ps-funnel-track">
                <div
                  className="ps-funnel-fill"
                  style={{ width: `${barWidth}%` }}
                  aria-hidden
                />
              </div>
              <span className="ps-funnel-value">
                {s.runs} ({pct.toFixed(0)}%)
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
