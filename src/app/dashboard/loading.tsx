// Shown while the dashboard's server components run their ClickHouse queries.
// A skeleton keeps the layout stable instead of flashing a blank page on the
// drill-in's three-query fetch.
export default function DashboardLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <div className="h-8 w-56 animate-pulse rounded bg-zinc-900" />
      <div className="flex gap-1.5">
        <div className="h-5 w-64 animate-pulse rounded-full bg-zinc-900" />
        <div className="h-5 w-48 animate-pulse rounded-full bg-zinc-900" />
      </div>
      <div className="h-40 animate-pulse rounded-lg border border-zinc-800 bg-zinc-950/60" />
      <div className="h-64 animate-pulse rounded-lg border border-zinc-800 bg-zinc-950/60" />
    </main>
  );
}
