"use client";

import { useState, useMemo, useTransition } from "react";
import { LevelCanvas, TRAIL_COLORS, type CanvasTrail } from "../level/level-canvas";
import { Provenance } from "./provenance";

// The drill-down is injected rather than imported: this component ships in the
// SDK, and the host owns the ClickHouse credentials that answer the query.
export interface DrillDown {
  (args: { experimentId: string; variant: string; room: string; gx: number; gy: number }): Promise<{
    runs: Array<{ runId: string; archetype: string; seed: string; coins: number; simMs: number }>;
    trails: CanvasTrail[];
    queryMs: number;
  }>;
}

export interface HeatmapOutput {
  experimentId: string;
  variant: string;
  room: string;
  runs: number;
  queryMs?: number;
  /** The human player's own run, drawn over the swarm aggregate. */
  humanTrail?: CanvasTrail | null;
  human?: { survivedMs: number; coins: number; died: boolean };
  nearby?: {
    radiusTiles: number;
    byArchetype: Array<{ archetype: string; deaths: number; runs: number }>;
  } | null;
  cells: Array<{
    gx: number;
    gy: number;
    visits: number;
    deaths: number;
    damage: number;
    coin_pickups: number;
  }>;
}

export function HeatmapCard({
  output,
  onDrillDown,
}: {
  output: HeatmapOutput;
  onDrillDown?: DrillDown;
}) {
  const { cellColors, byKey, totalDeaths, hottest } = useMemo(() => {
    const byKey = new Map(output.cells.map((c) => [`${c.gx},${c.gy}`, c]));
    const maxDeaths = Math.max(1, ...output.cells.map((c) => c.deaths));
    const maxVisits = Math.max(1, ...output.cells.map((c) => c.visits));
    const colors = new Map<string, string>();
    for (const c of output.cells) {
      if (c.deaths > 0) {
        colors.set(`${c.gx},${c.gy}`, `rgba(237,87,54,${0.38 + 0.6 * (c.deaths / maxDeaths)})`);
      } else if (c.visits > 0) {
        colors.set(
          `${c.gx},${c.gy}`,
          `rgba(91,77,245,${0.08 + 0.36 * (Math.log1p(c.visits) / Math.log1p(maxVisits))})`,
        );
      }
    }
    const totalDeaths = output.cells.reduce((s, c) => s + c.deaths, 0);
    const hottest = output.cells.reduce(
      (best, c) => (c.deaths > (best?.deaths ?? 0) ? c : best),
      null as HeatmapOutput["cells"][number] | null,
    );
    return { cellColors: colors, byKey, totalDeaths, hottest };
  }, [output]);

  const summary =
    `${output.variant} · ${output.runs} runs · ${totalDeaths} deaths` +
    (hottest ? ` · hottest cell (${hottest.gx},${hottest.gy}) with ${hottest.deaths}` : "");

  const [replay, setReplay] = useState<{
    gx: number;
    gy: number;
    runs: Array<{ runId: string; archetype: string; seed: string; coins: number; simMs: number }>;
    trails: CanvasTrail[];
    queryMs: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const openCell = (gx: number, gy: number) => {
    if (!onDrillDown) return;
    const cell = byKey.get(`${gx},${gy}`);
    if (!cell || cell.deaths === 0) return;
    startTransition(async () => {
      const res = await onDrillDown({
        experimentId: output.experimentId,
        variant: output.variant,
        room: output.room,
        gx,
        gy,
      });
      setReplay({ gx, gy, runs: res.runs, trails: res.trails, queryMs: res.queryMs });
    });
  };

  return (
    <figure className="ps-data-card ps-heatmap-card">
      <figcaption className="ps-card-header">
        <span>
          <span className="ps-card-eyebrow">Spatial evidence</span>
          <strong>{output.room} death heatmap</strong>
        </span>
        <span className="ps-card-context">
          {output.variant} · {output.experimentId}
        </span>
      </figcaption>
      <div className="ps-card-metrics">
        <span><small>Runs</small><strong>{output.runs}</strong></span>
        <span><small>Deaths</small><strong>{totalDeaths}</strong></span>
        <span>
          <small>Hottest cell</small>
          <strong>{hottest ? `${hottest.gx}, ${hottest.gy}` : "—"}</strong>
        </span>
      </div>
      <div className="ps-map-frame">
      <LevelCanvas
        room={output.room}
        cellColors={cellColors}
        onCellClick={onDrillDown ? openCell : undefined}
        // A hotspot replay takes over the canvas; otherwise the player's own
        // ghost trail stays pinned over the swarm heatmap.
        trails={replay?.trails ?? (output.humanTrail ? [output.humanTrail] : undefined)}
        keepCellColors={!replay && Boolean(output.humanTrail)}
        tooltipFor={(gx, gy) => {
          const c = byKey.get(`${gx},${gy}`);
          if (!c) return null;
          const base = `(${gx},${gy}) deaths ${c.deaths} · visits ${c.visits} · damage ${c.damage}`;
          return c.deaths > 0 && onDrillDown
            ? `${base} — click to replay the runs that died here`
            : base;
        }}
      />
      </div>
      {replay ? (
        <div className="ps-replay-panel">
          <div className="ps-replay-header">
            <span>
              {replay.runs.length} run{replay.runs.length === 1 ? "" : "s"} died at ({replay.gx},
              {replay.gy})
            </span>
            <button onClick={() => setReplay(null)}>
              back to heatmap
            </button>
          </div>
          <ul className="ps-replay-list">
            {replay.runs.map((r) => (
              <li key={r.runId}>
                <span style={{ color: TRAIL_COLORS[r.archetype] }}>{r.archetype}</span> · seed{" "}
                {r.seed} · {r.coins} coins · survived {(r.simMs / 1000).toFixed(1)}s
              </li>
            ))}
          </ul>
          <p className="ps-replay-provenance">
            trails read from bot_events by primary key in {replay.queryMs}ms
          </p>
        </div>
      ) : (
        pending && <p className="ps-pending-state">Loading culprit runs…</p>
      )}
      {output.human && (
        <div className="ps-human-run">
          <div className="ps-human-run-title">
            <span className="ps-human-trail" aria-hidden />
            <span>
              your run · {(output.human.survivedMs / 1000).toFixed(0)}s · {output.human.coins} coins
              · {output.human.died ? "died" : "no death recorded"}
            </span>
          </div>
          {output.nearby && output.human.died && (
            <ul className="ps-human-nearby">
              {output.nearby.byArchetype
                .filter((a) => a.archetype !== "human" && a.runs > 0)
                .map((a) => (
                  <li key={a.archetype}>
                    {Math.round((a.deaths / a.runs) * 100)}% of {a.archetype} runs died within{" "}
                    {output.nearby!.radiusTiles} tiles of where you did
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      <Provenance
        runs={output.runs}
        cells={output.cells.length}
        queryMs={output.queryMs}
        source="heatmap_cells (AggregatingMergeTree MV)"
      />
      <span className="sr-only">{summary}</span>
    </figure>
  );
}
