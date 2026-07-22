import { getClickHouse, READ_SETTINGS } from "./clickhouse";

// Reads over agent_events for /dashboard/agent — ClickHouse as the
// observability store for the agent itself. Session list is a small-table
// aggregate; the per-session timeline is a primary-key range scan on
// (session_id, turn, seq).

export interface AgentSessionRow {
  sessionId: string;
  started: string;
  ended: string;
  turns: number;
  toolCalls: number;
  tools: string[];
  experimentId: string;
  errors: number;
}

export async function agentSessions(limit = 20): Promise<AgentSessionRow[]> {
  const rs = await getClickHouse().query({
    query: `
      SELECT
        session_id,
        toString(min(ts)) AS started,
        toString(max(ts)) AS ended,
        toUInt32(max(turn) + 1) AS turns,
        countIf(kind = 'tool_call') AS tool_calls,
        groupUniqArrayIf(tool, kind = 'tool_call' AND tool != '') AS tools,
        anyIf(experiment_id, experiment_id != '') AS experiment_id,
        countIf(kind = 'error') AS errors
      FROM agent_events
      WHERE session_id != ''
      GROUP BY session_id
      ORDER BY max(ts) DESC
      LIMIT {limit: UInt8}
    `,
    query_params: { limit },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const rows = await rs.json<{
    session_id: string;
    started: string;
    ended: string;
    turns: number;
    tool_calls: string;
    tools: string[];
    experiment_id: string;
    errors: string;
  }>();
  return rows.map((r) => ({
    sessionId: r.session_id,
    started: r.started,
    ended: r.ended,
    turns: Number(r.turns),
    toolCalls: Number(r.tool_calls),
    tools: [...r.tools].sort(),
    experimentId: r.experiment_id,
    errors: Number(r.errors),
  }));
}

export interface AgentTimelineRow {
  turn: number;
  seq: number;
  kind: string;
  tool: string;
  experimentId: string;
  content: string;
  durationMs: number;
  ts: string;
}

export async function agentTimeline(sessionId: string): Promise<AgentTimelineRow[]> {
  const rs = await getClickHouse().query({
    query: `
      SELECT turn, seq, kind, tool, experiment_id, content, duration_ms, toString(ts) AS ts
      FROM agent_events
      WHERE session_id = {sessionId: String}
      ORDER BY turn, seq, ts
      LIMIT 500
    `,
    query_params: { sessionId },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const rows = await rs.json<{
    turn: number;
    seq: number;
    kind: string;
    tool: string;
    experiment_id: string;
    content: string;
    duration_ms: string;
    ts: string;
  }>();
  return rows.map((r) => ({
    turn: Number(r.turn),
    seq: Number(r.seq),
    kind: r.kind,
    tool: r.tool,
    experimentId: r.experiment_id,
    content: r.content,
    durationMs: Number(r.duration_ms),
    ts: r.ts,
  }));
}

// Lineage: the agent-side trail for one experiment — who asked for it, when it
// was approved, and what the tools reported. Joined on the experiment_id the
// tool wrapper extracts from tool outputs.
export interface LineageStep {
  sessionId: string;
  turn: number;
  kind: string;
  tool: string;
  content: string;
  ts: string;
}

export async function experimentAgentTrail(experimentId: string): Promise<LineageStep[]> {
  const rs = await getClickHouse().query({
    query: `
      SELECT session_id, turn, kind, tool, content, toString(ts) AS ts
      FROM agent_events
      WHERE experiment_id = {experimentId: String}
        AND kind IN ('approval', 'tool_call', 'tool_result', 'error')
      ORDER BY ts
      LIMIT 50
    `,
    query_params: { experimentId },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const rows = await rs.json<{
    session_id: string;
    turn: number;
    kind: string;
    tool: string;
    content: string;
    ts: string;
  }>();
  return rows.map((r) => ({
    sessionId: r.session_id,
    turn: Number(r.turn),
    kind: r.kind,
    tool: r.tool,
    content: r.content,
    ts: r.ts,
  }));
}

export async function promptForTurn(
  sessionId: string,
  turn: number,
): Promise<{ content: string; ts: string } | null> {
  const rs = await getClickHouse().query({
    query: `
      SELECT content, toString(ts) AS ts
      FROM agent_events
      WHERE session_id = {sessionId: String} AND turn = {turn: UInt16} AND kind = 'prompt'
      LIMIT 1
    `,
    query_params: { sessionId, turn },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const [row] = await rs.json<{ content: string; ts: string }>();
  return row ?? null;
}

// Recent bot-run failures land with an empty session id — surfaced separately
// so worker errors are visible without polluting the session list.
export interface AgentErrorRow {
  tool: string;
  experimentId: string;
  content: string;
  ts: string;
}

export async function recentAgentErrors(limit = 10): Promise<AgentErrorRow[]> {
  const rs = await getClickHouse().query({
    query: `
      SELECT tool, experiment_id, content, toString(ts) AS ts
      FROM agent_events
      WHERE kind = 'error' AND session_id = ''
      ORDER BY ts DESC
      LIMIT {limit: UInt8}
    `,
    query_params: { limit },
    format: "JSONEachRow",
    clickhouse_settings: READ_SETTINGS,
  });
  const rows = await rs.json<{ tool: string; experiment_id: string; content: string; ts: string }>();
  return rows.map((r) => ({ tool: r.tool, experimentId: r.experiment_id, content: r.content, ts: r.ts }));
}
