import Link from "next/link";
import { notFound } from "next/navigation";
import { agentTimeline } from "../../../../lib/agent-queries";
import { AppShell } from "../../../../components/app-shell";

export const dynamic = "force-dynamic";

const KIND_CLASS: Record<string, string> = {
  prompt: "verdict-stable",
  response: "verdict-easier",
  tool_call: "verdict-shifted",
  tool_result: "verdict-shifted",
  approval: "verdict-first-night",
  error: "verdict-harder",
};

// The dashboard is public, so user-authored content (prompts, model responses)
// is hidden unless the operator explicitly flips AGENT_LOG_PUBLIC=1 — e.g. for
// a demo recording of their own session. System-generated rows (tool calls,
// results, approvals, errors) always render: their content is digest-sized and
// URL-stripped at write time. The full content stays in ClickHouse either way;
// only the public rendering is gated.
const CONTENT_PUBLIC = () => process.env.AGENT_LOG_PUBLIC === "1";

export default async function AgentSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const rows = await agentTimeline(decodeURIComponent(sessionId));
  if (rows.length === 0) notFound();
  const showUserContent = CONTENT_PUBLIC();

  return (
    <AppShell active="analytics">
      <main className="demo-page page-pad">
        <header className="experiment-intro">
          <div>
            <p className="eyebrow">Agent session</p>
            <h1 className="table-mono">{decodeURIComponent(sessionId).slice(0, 16)}</h1>
            <div className="experiment-meta">
              <span className="meta-chip">{rows.length} events</span>
              <span className="meta-chip">{Math.max(...rows.map((r) => r.turn)) + 1} turns</span>
              {!showUserContent && <span className="meta-chip">prompts hidden · AGENT_LOG_PUBLIC=0</span>}
            </div>
          </div>
          <Link href="/dashboard/agent" className="secondary-link">
            ← Agent log
          </Link>
        </header>

        <section className="section-block" aria-labelledby="timeline-heading">
          <header className="section-heading">
            <span className="section-index">01</span>
            <h2 id="timeline-heading">Turn timeline</h2>
            <p>Primary-key range scan over agent_events (session_id, turn, seq).</p>
          </header>
          <ul className="watch-list">
            {rows.map((row) => {
              const userAuthored = row.kind === "prompt" || row.kind === "response";
              const content = userAuthored && !showUserContent ? "content hidden" : row.content;
              return (
                <li key={`${row.turn}-${row.seq}-${row.ts}`} className="watch-row">
                  <span className="watch-date">
                    t{row.turn} · {row.ts.slice(11, 19)}
                  </span>
                  <span className={`verdict ${KIND_CLASS[row.kind] ?? "verdict-stable"}`}>
                    {row.kind}
                  </span>
                  <span className="watch-summary">
                    {row.tool && <span className="table-mono">{row.tool} · </span>}
                    {row.durationMs > 0 && `${row.durationMs}ms · `}
                    {row.experimentId || ""}
                  </span>
                  <span className={`watch-detail${userAuthored && !showUserContent ? " muted-copy" : ""}`}>
                    {content || "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </AppShell>
  );
}
