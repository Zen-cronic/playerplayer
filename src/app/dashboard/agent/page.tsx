import Link from "next/link";
import { agentSessions, recentAgentErrors } from "../../../lib/agent-queries";
import { AppShell, ArrowUpRight } from "../../../components/app-shell";
import { DashboardTabs } from "../../../components/dashboard-tabs";

export const dynamic = "force-dynamic";

export default async function AgentLogPage() {
  const [sessions, errors] = await Promise.all([
    agentSessions().catch(() => []),
    recentAgentErrors().catch(() => []),
  ]);

  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Telemetry command center</p>
            <h1 className="page-title-compact">Agent log</h1>
          </div>
          <p className="page-dek">
            Every chat session, tool call, and approval the agent has made — ClickHouse as
            the observability store for the agent itself.
          </p>
        </header>

        <DashboardTabs active="agent" />

        <section className="section-block" aria-labelledby="sessions-heading">
          <header className="section-heading">
            <span className="section-index">01</span>
            <h2 id="sessions-heading">Sessions</h2>
            <p>One row per chat session, aggregated from agent_events at read time.</p>
          </header>
          {sessions.length === 0 ? (
            <p className="empty-state">No agent sessions logged yet — ask the chat something.</p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>session</th>
                    <th>turns</th>
                    <th>tool calls</th>
                    <th>tools</th>
                    <th>experiment</th>
                    <th>last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.sessionId}>
                      <td>
                        <Link
                          href={`/dashboard/agent/${encodeURIComponent(s.sessionId)}`}
                          className="experiment-link"
                        >
                          {s.sessionId.slice(0, 10)}
                          <ArrowUpRight />
                        </Link>
                      </td>
                      <td>{s.turns}</td>
                      <td>{s.toolCalls}</td>
                      <td className="variant-list">{s.tools.join(", ") || "—"}</td>
                      <td className="variant-list">{s.experimentId || "—"}</td>
                      <td className="table-mono muted-copy">{s.ended}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="section-block" aria-labelledby="errors-heading">
          <header className="section-heading">
            <span className="section-index">02</span>
            <h2 id="errors-heading">Worker errors</h2>
            <p>bot-run failures logged by the task&apos;s onFailure hook — none is the good state.</p>
          </header>
          {errors.length === 0 ? (
            <p className="empty-state">No worker errors recorded.</p>
          ) : (
            <ul className="watch-list">
              {errors.map((e, i) => (
                <li key={`${e.ts}-${i}`} className="watch-row">
                  <span className="watch-date">{e.ts}</span>
                  <span className="verdict verdict-harder">{e.tool}</span>
                  <span className="watch-summary">{e.experimentId || "—"}</span>
                  <span className="watch-detail">{e.content}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  );
}
