"use client";

import { useMemo } from "react";
import { LevelCanvas } from "./level-canvas";

export interface DeltaOutput {
  experimentId: string;
  variantA: string;
  variantB: string;
  room: string;
  runsA: number;
  runsB: number;
  totals: { deathsA: number; deathsB: number; deathRateA: number; deathRateB: number };
  cells: Array<{
    gx: number;
    gy: number;
    deathsA: number;
    deathsB: number;
    visitsA: number;
    visitsB: number;
  }>;
}

export function DeltaCard({ output }: { output: DeltaOutput }) {
  const { cellColors, byKey } = useMemo(() => {
    const byKey = new Map(output.cells.map((c) => [`${c.gx},${c.gy}`, c]));
    const runsA = Math.max(1, output.runsA);
    const runsB = Math.max(1, output.runsB);
    const deltas = output.cells.map((c) => c.deathsB / runsB - c.deathsA / runsA);
    const maxAbs = Math.max(0.001, ...deltas.map(Math.abs));
    const colors = new Map<string, string>();
    output.cells.forEach((c, i) => {
      const d = deltas[i];
      if (d === 0) return;
      const alpha = 0.3 + 0.65 * (Math.abs(d) / maxAbs);
      colors.set(
        `${c.gx},${c.gy}`,
        d > 0 ? `rgba(239,68,68,${alpha})` : `rgba(34,197,94,${alpha})`,
      );
    });
    return { cellColors: colors, byKey };
  }, [output]);

  const rateA = output.totals.deathRateA * 100;
  const rateB = output.totals.deathRateB * 100;
  const diff = rateB - rateA;
  const verdict =
    Math.abs(diff) < 4
      ? { label: "no clear change", cls: "bg-zinc-700 text-zinc-200" }
      : diff < 0
        ? { label: `deaths down ${Math.abs(diff).toFixed(0)}pp`, cls: "bg-emerald-800 text-emerald-100" }
        : { label: `deaths up ${diff.toFixed(0)}pp`, cls: "bg-red-800 text-red-100" };

  const summary = `${output.variantB} vs ${output.variantA}: death rate ${rateA.toFixed(0)}% → ${rateB.toFixed(0)}% over ${output.runsA}+${output.runsB} matched runs — ${verdict.label}`;

  return (
    <figure className="my-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <figcaption className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${verdict.cls}`}>{verdict.label}</span>
        <span className="text-zinc-300">
          death rate {rateA.toFixed(0)}% → {rateB.toFixed(0)}%
        </span>
        <span className="text-zinc-500">
          {output.runsA}+{output.runsB} matched runs · {output.room} · {output.experimentId}
        </span>
      </figcaption>
      <LevelCanvas
        room={output.room}
        cellColors={cellColors}
        tooltipFor={(gx, gy) => {
          const c = byKey.get(`${gx},${gy}`);
          if (!c) return null;
          return `(${gx},${gy}) deaths ${c.deathsA}→${c.deathsB} · visits ${c.visitsA}→${c.visitsB}`;
        }}
      />
      <div className="mt-1 text-[10px] text-zinc-500">
        <span className="text-red-400">red</span> = more deaths after change ·{" "}
        <span className="text-emerald-400">green</span> = fewer deaths
      </div>
      <span className="sr-only">{summary}</span>
    </figure>
  );
}
