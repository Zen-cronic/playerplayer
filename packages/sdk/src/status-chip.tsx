"use client";

export function StatusChip({ live, label }: { live: boolean; label: string }) {
  return (
    <span className={`ps-status-chip ${live ? "is-live" : "is-offline"}`}>
      <span className="ps-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
