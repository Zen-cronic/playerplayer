"use client";

import { useState, useMemo, useTransition } from "react";
import { LevelCanvas, type CanvasTrail } from "../level/level-canvas";
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
        colors.set(`${c.gx},${c.gy}`, `rgba(239,68,68,${0.35 + 0.6 * (c.deaths / maxDeaths)})`);
      } else if (c.visits > 0) {
        colors.set(
          `${c.gx},${c.gy}`,
          `rgba(59,130,246,${0.06 + 0.3 * (Math.log1p(c.visits) / Math.log1p(maxVisits))})`,
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
    <figure className="my-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <figcaption className="mb-2 flex items-baseline justify-between text-xs">
        <span className="font-medium text-zinc-200">
          {output.room} death heatmap · {output.variant}
        </span>
        <span className="text-zinc-500">
          {output.runs} runs · {totalDeaths} deaths · experiment {output.experimentId}
        </span>
      </figcaption>
      <LevelCanvas
        room={output.room}
        cellColors={cellColors}
        onCellClick={onDrillDown ? openCell : undefined}
        trails={replay?.trails}
        tooltipFor={(gx, gy) => {
          const c = byKey.get(`${gx},${gy}`);
          if (!c) return null;
          const base = `(${gx},${gy}) deaths ${c.deaths} · visits ${c.visits} · damage ${c.damage}`;
          return c.deaths > 0 ? `${base} — click to replay the runs that died here` : base;
        }}
      />
      {replay ? (
        <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-zinc-300">
              {replay.runs.length} run{replay.runs.length === 1 ? "" : "s"} died at ({replay.gx},
              {replay.gy})
            </span>
            <button onClick={() => setReplay(null)} className="text-zinc-500 hover:text-zinc-300">
              back to heatmap
            </button>
          </div>
          <ul className="space-y-0.5 text-zinc-400">
            {replay.runs.map((r) => (
              <li key={r.runId}>
                <span style={{ color: TRAIL_LEGEND[r.archetype] }}>{r.archetype}</span> · seed{" "}
                {r.seed} · {r.coins} coins · survived {(r.simMs / 1000).toFixed(1)}s
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-zinc-600">
            trails read from bot_events by primary key in {replay.queryMs}ms
          </p>
        </div>
      ) : (
        pending && <p className="mt-2 text-xs text-zinc-500">loading runs…</p>
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

const TRAIL_LEGEND: Record<string, string> = {
  rusher: "#fb923c",
  explorer: "#22d3ee",
  cautious: "#a3e635",
};
