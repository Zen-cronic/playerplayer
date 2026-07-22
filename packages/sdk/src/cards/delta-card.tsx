"use client";

import { useMemo } from "react";
import { LevelCanvas } from "../level/level-canvas";
import { Provenance } from "./provenance";

export interface DeltaOutput {
  experimentId: string;
  variantA: string;
  variantB: string;
  room: string;
  runsA: number;
  runsB: number;
  queryMs?: number;
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
        d > 0 ? `rgba(237,87,54,${alpha})` : `rgba(20,118,84,${alpha})`,
      );
    });
    return { cellColors: colors, byKey };
  }, [output]);

  const rateA = output.totals.deathRateA * 100;
  const rateB = output.totals.deathRateB * 100;
  const diff = rateB - rateA;
  const verdict =
    Math.abs(diff) < 4
      ? { label: "no clear change", tone: "neutral" }
      : diff < 0
        ? { label: `deaths down ${Math.abs(diff).toFixed(0)}pp`, tone: "positive" }
        : { label: `deaths up ${diff.toFixed(0)}pp`, tone: "negative" };

  const summary = `${output.variantB} vs ${output.variantA}: death rate ${rateA.toFixed(0)}% → ${rateB.toFixed(0)}% over ${output.runsA}+${output.runsB} matched runs — ${verdict.label}`;

  return (
    <figure className="ps-data-card ps-delta-card">
      <figcaption className="ps-card-header">
        <span>
          <span className="ps-card-eyebrow">Matched-seed comparison</span>
          <strong>Mutation impact</strong>
        </span>
        <span className="ps-card-context">
          {output.room} · {output.experimentId}
        </span>
      </figcaption>
      <div className="ps-delta-summary">
        <span>
          <small>{output.variantA}</small>
          <strong>{rateA.toFixed(0)}%</strong>
          <em>{output.runsA} runs</em>
        </span>
        <span className="ps-delta-arrow" aria-hidden="true">→</span>
        <span>
          <small>{output.variantB}</small>
          <strong>{rateB.toFixed(0)}%</strong>
          <em>{output.runsB} runs</em>
        </span>
        <span className={`ps-verdict is-${verdict.tone}`}>{verdict.label}</span>
      </div>
      <div className="ps-map-frame">
      <LevelCanvas
        room={output.room}
        cellColors={cellColors}
        tooltipFor={(gx, gy) => {
          const c = byKey.get(`${gx},${gy}`);
          if (!c) return null;
          return `(${gx},${gy}) deaths ${c.deathsA}→${c.deathsB} · visits ${c.visitsA}→${c.visitsB}`;
        }}
      />
      </div>
      <div className="ps-delta-legend">
        <span className="is-worse">red</span> = more deaths after change ·{" "}
        <span className="is-better">green</span> = fewer deaths
      </div>
      <Provenance
        runs={output.runsA + output.runsB}
        cells={output.cells.length}
        queryMs={output.queryMs}
        source="single-pass sumIf delta, no join"
      />
      <span className="sr-only">{summary}</span>
    </figure>
  );
}
