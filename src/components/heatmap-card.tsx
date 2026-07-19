"use client";

import { useMemo } from "react";
import { LevelCanvas } from "./level-canvas";

export interface HeatmapOutput {
  experimentId: string;
  variant: string;
  room: string;
  runs: number;
  cells: Array<{
    gx: number;
    gy: number;
    visits: number;
    deaths: number;
    damage: number;
    coin_pickups: number;
  }>;
}

export function HeatmapCard({ output }: { output: HeatmapOutput }) {
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
        tooltipFor={(gx, gy) => {
          const c = byKey.get(`${gx},${gy}`);
          if (!c) return null;
          return `(${gx},${gy}) deaths ${c.deaths} · visits ${c.visits} · damage ${c.damage}`;
        }}
      />
      <span className="sr-only">{summary}</span>
    </figure>
  );
}
