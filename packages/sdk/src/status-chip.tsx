"use client";

export function StatusChip({ live, label }: { live: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-zinc-400">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-zinc-600"}`}
      />
      {label}
    </span>
  );
}
