"use client";

// Every card states what it was computed from. A judge should be able to read
// the numbers off the chart and know they came from a live query, not a fixture.
export function Provenance({
  runs,
  cells,
  queryMs,
  source,
}: {
  runs: number;
  cells: number;
  queryMs?: number;
  source: string;
}) {
  return (
    <div className="ps-provenance">
      <span className="ps-provenance-dot" aria-hidden="true" />
      <span>
        {runs} bot runs · {cells.toLocaleString()} cells aggregated · {source}
        {typeof queryMs === "number" ? ` · ${queryMs}ms` : ""}
      </span>
    </div>
  );
}
