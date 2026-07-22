"use client";

// Segment error boundary for /dashboard and /dashboard/[experiment]. A momentary
// ClickHouse hiccup should degrade to a retryable card, never a raw 500 on a
// recorded, shared surface. The message is fixed — a connection error can carry
// the host, so we never render error.detail here.
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-6">
        <h1 className="text-sm font-medium text-zinc-200">Couldn&apos;t reach the data layer</h1>
        <p className="mt-1 max-w-md text-xs text-zinc-500">
          The dashboard reads live from ClickHouse and the query didn&apos;t come back. This is
          usually transient — try again in a moment.
        </p>
        <div className="mt-4 flex justify-center gap-3 text-xs">
          <button
            onClick={reset}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500"
          >
            Try again
          </button>
          <a href="/" className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800">
            Back to the game
          </a>
        </div>
      </div>
    </main>
  );
}
