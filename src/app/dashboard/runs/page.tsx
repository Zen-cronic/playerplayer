import Link from "next/link";
import { runsPage, RUNS_PAGE_SIZE, type RunsFilter } from "../../../lib/ops-queries";
import { listExperimentRefs } from "../../../lib/queries";
import { AppShell, ArrowUpRight } from "../../../components/app-shell";
import { DashboardTabs } from "../../../components/dashboard-tabs";

export const dynamic = "force-dynamic";

const ARCHETYPE_OPTIONS = ["explorer", "rusher", "cautious", "human"];
const VERDICT_OPTIONS = ["win", "lose", "timeout"];
const VARIANT_OPTIONS = ["baseline", "mutated"];

const VERDICT_CLASS: Record<string, string> = {
  win: "verdict-easier",
  lose: "verdict-harder",
  timeout: "verdict-shifted",
};

type Search = { experiment?: string; variant?: string; archetype?: string; verdict?: string; page?: string };

// Filters are plain links that rewrite the query string — the whole explorer is
// server-rendered with zero client JS. Changing any filter resets paging.
function buildHref(current: Search, patch: Partial<Search>): string {
  const next: Record<string, string | undefined> = { ...current, page: undefined, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/dashboard/runs?${s}` : "/dashboard/runs";
}

function FilterRow({
  label,
  param,
  options,
  current,
}: {
  label: string;
  param: keyof Search;
  options: string[];
  current: Search;
}) {
  const active = current[param];
  return (
    <div className="runs-filter-row">
      <span className="runs-filter-label">{label}</span>
      <Link
        href={buildHref(current, { [param]: undefined })}
        className="dash-tab"
        aria-current={!active ? "page" : undefined}
      >
        all
      </Link>
      {options.map((option) => (
        <Link
          key={option}
          href={buildHref(current, { [param]: option })}
          className="dash-tab"
          aria-current={active === option ? "page" : undefined}
        >
          {option}
        </Link>
      ))}
    </div>
  );
}

export default async function RunsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const filter: RunsFilter = {
    experimentId: search.experiment,
    variant: search.variant,
    archetype: search.archetype,
    verdict: search.verdict,
    page: Number(search.page ?? 0) || 0,
  };

  const [{ rows, hasMore, page }, refs] = await Promise.all([
    runsPage(filter),
    listExperimentRefs(12),
  ]);

  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Telemetry command center</p>
            <h1 className="page-title-compact">Runs</h1>
          </div>
          <p className="page-dek">
            Every playthrough the swarm and humans have recorded — filter, then open a run
            to replay its trail and event stream.
          </p>
        </header>

        <DashboardTabs active="runs" />

        <section className="section-block" aria-label="Run filters">
          <FilterRow label="experiment" param="experiment" options={refs.map((r) => r.experimentId)} current={search} />
          <FilterRow label="variant" param="variant" options={VARIANT_OPTIONS} current={search} />
          <FilterRow label="archetype" param="archetype" options={ARCHETYPE_OPTIONS} current={search} />
          <FilterRow label="verdict" param="verdict" options={VERDICT_OPTIONS} current={search} />
        </section>

        <section className="section-block" aria-labelledby="runs-heading">
          <header className="section-heading">
            <span className="section-index">01</span>
            <h2 id="runs-heading">Run registry</h2>
            <p>
              Page {page + 1} · newest first · straight off game_runs with conditional
              query parameters.
            </p>
          </header>
          {rows.length === 0 ? (
            <p className="empty-state">No runs match this filter.</p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>run</th>
                    <th>experiment</th>
                    <th>variant</th>
                    <th>archetype</th>
                    <th>verdict</th>
                    <th>coins</th>
                    <th>survived</th>
                    <th>recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((run) => (
                    <tr key={run.runId}>
                      <td>
                        <Link href={`/dashboard/runs/${encodeURIComponent(run.runId)}`} className="experiment-link">
                          {run.runId.slice(0, 8)}
                          <ArrowUpRight />
                        </Link>
                      </td>
                      <td className="variant-list">{run.experimentId}</td>
                      <td>{run.variant}</td>
                      <td>{run.archetype}</td>
                      <td>
                        <span className={`verdict ${VERDICT_CLASS[run.verdict] ?? "verdict-stable"}`}>
                          {run.verdict}
                        </span>
                      </td>
                      <td>{run.coins}</td>
                      <td className="table-mono">{(run.simMs / 1000).toFixed(1)}s</td>
                      <td className="table-mono muted-copy">{run.insertedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="runs-pager">
            {page > 0 && (
              <Link href={buildHref(search, { page: String(page - 1) })} className="dash-tab">
                ← newer
              </Link>
            )}
            {hasMore && (
              <Link href={buildHref(search, { page: String(page + 1) })} className="dash-tab">
                older {RUNS_PAGE_SIZE} →
              </Link>
            )}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
