import { getClickHouse } from "./clickhouse";

// Fire-and-forget observability writes into agent_events: the agent's own
// prompts, tool calls, approvals and errors, queryable in ClickHouse like any
// other telemetry. Logging must never block or fail a turn — inserts are
// unawaited, failures are swallowed, and (unlike game telemetry) losing a row
// on a crash is acceptable BY DESIGN.

export type AgentEventKind = "prompt" | "response" | "tool_call" | "tool_result" | "approval" | "error";

export interface AgentLogEntry {
  kind: AgentEventKind;
  tool?: string;
  experimentId?: string;
  content?: string;
  durationMs?: number;
  props?: Record<string, unknown>;
}

// content renders on a public dashboard page and ClickHouse errors can carry
// the host URL — strip anything URL-shaped before it leaves the process.
export function sanitize(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "[url]").slice(0, 500);
}

// Digest-sized serialization: long arrays (cell grids, trail points) collapse
// to their length so a tool_result row is a summary, not a data dump.
export function compact(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_key, v) => (Array.isArray(v) && v.length > 8 ? `[${v.length} items]` : v)) ?? ""
    );
  } catch {
    return "[unserializable]";
  }
}

function expOf(...values: unknown[]): string {
  for (const v of values) {
    if (v && typeof v === "object" && "experimentId" in v) {
      const id = (v as { experimentId?: unknown }).experimentId;
      if (typeof id === "string" && id) return id;
    }
  }
  return "";
}

export function logAgentEvent(
  row: AgentLogEntry & { sessionId?: string; runId?: string; turn?: number; seq?: number },
): void {
  void (async () => {
    await getClickHouse().insert({
      table: "agent_events",
      values: [
        {
          session_id: row.sessionId ?? "",
          trigger_run_id: row.runId ?? "",
          turn: row.turn ?? 0,
          seq: row.seq ?? 0,
          kind: row.kind,
          tool: row.tool ?? "",
          experiment_id: row.experimentId ?? "",
          content: sanitize(row.content ?? ""),
          duration_ms: Math.round(row.durationMs ?? 0),
          props: row.props ?? {},
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
    });
  })().catch(() => {});
}

// Minimal structural view of an AI SDK tool — enough to wrap execute while the
// spread preserves inputSchema/toModelOutput/needsApproval untouched.
interface WrappableTool {
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
  needsApproval?: unknown;
}

export interface TurnLogger {
  log(entry: AgentLogEntry): void;
  wrapTools<T extends Record<string, unknown>>(tools: T): T;
}

// One logger per turn, held in closures — chat sessions run concurrently in a
// worker, so there is deliberately NO module-global turn context to race on.
// seqBase spaces the row ranges (prompt 0, tools 100+, hook events 900+) so the
// timeline sorts stably without cross-closure coordination.
export function makeTurnLogger(ctx: {
  chatId: string;
  runId?: string;
  turn: number;
  seqBase?: number;
}): TurnLogger {
  let seq = ctx.seqBase ?? 0;
  const log = (entry: AgentLogEntry): void => {
    logAgentEvent({ ...entry, sessionId: ctx.chatId, runId: ctx.runId, turn: ctx.turn, seq: seq++ });
  };

  const wrapTools = <T extends Record<string, unknown>>(tools: T): T => {
    const wrapped = Object.fromEntries(
      Object.entries(tools).map(([name, t]) => {
        const original = t as WrappableTool;
        if (typeof original.execute !== "function") return [name, t];
        const execute = async (input: unknown, options: unknown) => {
          // An approval-gated tool's execute only runs after the user approves,
          // so reaching this point IS the approval signal.
          if (original.needsApproval === true) log({ kind: "approval", tool: name, content: "approved" });
          log({ kind: "tool_call", tool: name, experimentId: expOf(input), content: compact(input) });
          const started = Date.now();
          try {
            const output = await original.execute!(input, options);
            log({
              kind: "tool_result",
              tool: name,
              experimentId: expOf(output, input),
              content: compact(output),
              durationMs: Date.now() - started,
            });
            return output;
          } catch (e) {
            log({
              kind: "tool_result",
              tool: name,
              experimentId: expOf(input),
              content: e instanceof Error ? e.message : String(e),
              durationMs: Date.now() - started,
              props: { error: true },
            });
            throw e;
          }
        };
        return [name, { ...(t as object), execute }];
      }),
    );
    return wrapped as T;
  };

  return { log, wrapTools };
}
