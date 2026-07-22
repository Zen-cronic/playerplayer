import Link from "next/link";
import { experimentRows, watchReportRows } from "../../lib/queries";
import { getClickHouse, READ_SETTINGS } from "../../lib/clickhouse";

// Mission control, not the pitch: the chat is where questions get answered.
// This is the registry — what has run, and what the nightly canary saw.
export const dynamic = "force-dynamic";

async function stackTotals() {
  const started = Date.now();
  try {
    const rs = await getClickHouse().query({
      query: "SELECT count() AS events, uniqExact(run_id) AS runs FROM bot_events",
      format: "JSONEachRow",
      clickhouse_settings: READ_SETTINGS,
    });
    const [row] = await rs.json<{ events: string; runs: string }>();
    return {
      ok: true,
      events: Number(row?.events ?? 0),
      runs: Number(row?.runs ?? 0),
      ms: Date.now() - started,
    };
  } catch {
    return { ok: false, events: 0, runs: 0, ms: Date.now() - started };
  }
}

const VERDICT_STYLES: Record<string, string> = {
  stable: "border-zinc-700 text-zinc-400",
  shifted: "border-amber-700 text-amber-400",
  easier: "border-emerald-700 text-emerald-400",
  harder: "border-red-700 text-red-400",
  "first-night": "border-zinc-700 text-zinc-500",
};

export default async function DashboardPage() {
  const [experiments, reports, totals] = await Promise.all([
    experimentRows(),
    watchReportRows(),
    stackTotals(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Experiment registry</h1>
          <p className="text-sm text-zinc-500">
            every swarm this agent has run, and what the nightly canary saw
          </p>
        </div>
        <nav className="flex gap-3 text-sm text-zinc-400">
          <Link href="/" className="hover:text-zinc-200">
            game
          </Link>
          <Link href="/chat" className="hover:text-zinc-200">
            full chat
          </Link>
        </nav>
      </header>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-zinc-400">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${totals.ok ? "bg-emerald-400" : "bg-red-500"}`}
          />
          ClickHouse Cloud · {totals.events.toLocaleString()} events from{" "}
          {totals.runs.toLocaleString()} runs · {totals.ms}ms
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-zinc-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {experiments.length} experiments · server-rendered from bot_runs
        </span>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Nightly regression watch</h2>
        {reports.length === 0 ? (
          <p className="text-xs text-zinc-600">
            no canary runs yet — the schedule fires at 03:00 UTC
          </p>
        ) : (
          <ul className="space-y-1">
            {reports.map((r) => (
              <li
                key={`${r.room}-${r.date}`}
                className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs"
              >
                <span className="font-mono text-zinc-400">{r.date}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 ${VERDICT_STYLES[r.verdict] ?? "border-zinc-700 text-zinc-400"}`}
                >
                  {r.verdict}
                </span>
                <span className="text-zinc-500">
                  {(r.deathRate * 100).toFixed(0)}% deaths over {r.runs} fixed-seed runs
                </span>
                <span className="text-zinc-600">{r.cellsChanged} cells changed vs {r.prevDate}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Experiments</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900/60 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">experiment</th>
                <th className="px-3 py-2 font-medium">variants</th>
                <th className="px-3 py-2 font-medium">runs</th>
                <th className="px-3 py-2 font-medium">deaths</th>
                <th className="px-3 py-2 font-medium">last run</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((e) => (
                <tr key={e.experimentId} className="border-t border-zinc-800/70">
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/${encodeURIComponent(e.experimentId)}`}
                      className="text-indigo-400 hover:text-indigo-300"
                    >
                      {e.experimentId}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{e.variants.join(", ")}</td>
                  <td className="px-3 py-2 text-zinc-400">{e.runs}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    {e.deaths}
                    <span className="ml-1 text-zinc-600">
                      ({e.runs ? Math.round((e.deaths / e.runs) * 100) : 0}%)
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-600">{e.lastRun}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
