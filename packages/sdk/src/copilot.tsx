"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { HeatmapCard, type HeatmapOutput, type DrillDown } from "./cards/heatmap-card";
import { DeltaCard, type DeltaOutput } from "./cards/delta-card";
import { FunnelCard, type FunnelOutput } from "./cards/funnel-card";
import { CanvasScaleProvider } from "./layout-context";

// The copilot widget. Everything host-specific — the Trigger server actions,
// the ClickHouse-backed drill-down, the status chips — arrives as props, so
// this file can ship in the SDK unchanged.

export interface CopilotProps {
  /** Trigger.dev chat.agent task id. */
  task?: string;
  /** Mint a session-scoped public token (host server action). */
  accessToken: (args: { chatId: string }) => Promise<string>;
  /** Create the Session + first run (host server action). */
  startSession: (args: {
    chatId: string;
    clientData?: unknown;
  }) => Promise<{ publicAccessToken: string }>;
  /** Optional hotspot → culprit-run replay. Omit and heatmaps stay static. */
  onDrillDown?: DrillDown;
  suggestions?: string[];
  /** "full" fills its parent; "panel" is sized for a popover. */
  layout?: "full" | "panel";
  /** Rendered above the transcript (status chips, titles). */
  header?: React.ReactNode;
  placeholder?: string;
  /** Pixels per 16px map tile in rendered cards. Defaults by layout. */
  canvasScale?: number;
}

const DEFAULT_SUGGESTIONS = [
  "Where do runs die on Level1?",
  "What if I move the slime guarding the corridor away from the door?",
  "Show me the progression funnel for the last experiment",
];

type SwarmMutation =
  | { op: "move_object"; objectType: string; index: number; toX: number; toY: number }
  | { op: "copy_tile"; from: { x: number; y: number }; to: { x: number; y: number } };

interface SwarmInput {
  hypothesis?: string;
  runsPerVariant?: number;
  room?: string;
  mutations?: SwarmMutation[];
}

// The approval card is the moment a designer decides to spend compute — it
// should read as a change to their level, not as a JSON payload.
function describeMutation(m: SwarmMutation): string {
  if (m.op === "move_object") {
    return `move ${m.objectType} #${m.index} to tile (${Math.floor(m.toX / 16)}, ${Math.floor(m.toY / 16)})`;
  }
  return `copy tile (${m.from.x}, ${m.from.y}) to (${m.to.x}, ${m.to.y})`;
}

export function SuggestionButton({
  text,
  onPick,
  disabled,
}: {
  text: string;
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onPick(text)}
      disabled={disabled}
      className="ps-suggestion"
    >
      {text}
    </button>
  );
}

export function Copilot({
  task = "playtest-chat",
  accessToken,
  startSession,
  onDrillDown,
  suggestions = DEFAULT_SUGGESTIONS,
  layout = "full",
  header,
  placeholder = "Ask about your level…",
  canvasScale,
}: CopilotProps) {
  const transport = useTriggerChatTransport({
    task,
    accessToken: ({ chatId }: { chatId: string }) => accessToken({ chatId }),
    startSession: ({ chatId, clientData }: { chatId: string; clientData?: unknown }) =>
      startSession({ chatId, clientData }),
  });

  const { messages, sendMessage, addToolApprovalResponse, stop, status } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState("");

  const busy = status === "streaming" || status === "submitted";

  // Stick to the newest card, but never yank the view away from someone who
  // scrolled up to inspect a heatmap mid-stream.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  return (
    <CanvasScaleProvider value={canvasScale ?? (layout === "panel" ? 7 : 13)}>
    <div className={`ps-copilot-root is-${layout}`}>
      {header}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="ps-transcript"
      >
        {messages.length === 0 && (
          <div className="ps-empty-chat">
            <span className="ps-empty-symbol" aria-hidden="true">✦</span>
            <p className="ps-empty-title">Start with the evidence</p>
            <p className="ps-empty-copy">Ask what broke, compare your run, or test a level change.</p>
            <div className="ps-suggestion-list">
              {suggestions.map((s) => (
                <SuggestionButton key={s} text={s} onPick={(t) => sendMessage({ text: t })} />
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, msgIndex) => (
          <div key={msg.id} className={`ps-message ${msg.role === "user" ? "is-user" : "is-assistant"}`}>
            {msg.parts.map((part, i) => {
              const isLatestMessage = msgIndex === messages.length - 1;
              if (part.type === "text") {
                return (
                  <p
                    key={i}
                    className={
                      msg.role === "user"
                        ? "ps-message-text ps-message-user"
                        : "ps-message-text ps-message-assistant"
                    }
                  >
                    {part.text}
                  </p>
                );
              }

              if (part.type.startsWith("tool-")) {
                const toolPart = part as {
                  type: string;
                  state: string;
                  input?: unknown;
                  output?: unknown;
                  approval?: { id: string };
                };
                const toolName = part.type.replace(/^tool-/, "");

                if (toolPart.state === "approval-requested" && toolPart.approval) {
                  const approvalId = toolPart.approval.id;
                  const spec = toolPart.input as SwarmInput | undefined;
                  return (
                    <div key={i} className="ps-approval-card">
                      <div className="ps-approval-label">
                        <span aria-hidden="true">!</span>
                        Compute approval
                      </div>
                      <p className="ps-approval-title">
                        Run {(spec?.runsPerVariant ?? 18) * 2} bot playthroughs to test this?
                      </p>
                      {spec?.hypothesis && (
                        <p className="ps-approval-hypothesis">{spec.hypothesis}</p>
                      )}
                      <ul className="ps-approval-list">
                        {(spec?.mutations ?? []).map((m, mi) => (
                          <li key={mi}>{describeMutation(m)}</li>
                        ))}
                        <li>
                          {spec?.runsPerVariant ?? 18} matched-seed runs per variant on{" "}
                          {spec?.room ?? "Level1"}, baseline vs mutated
                        </li>
                      </ul>
                      <details className="ps-raw-tool">
                        <summary>Raw experiment spec</summary>
                        <pre>
                          {JSON.stringify(toolPart.input, null, 2)}
                        </pre>
                      </details>
                      <div className="ps-approval-actions">
                        <button
                          onClick={() => addToolApprovalResponse({ id: approvalId, approved: true })}
                          className="ps-approve-button"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() =>
                            addToolApprovalResponse({ id: approvalId, approved: false, reason: "Designer denied" })
                          }
                          className="ps-deny-button"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  );
                }

                if (part.type === "tool-suggestFollowUps") {
                  const followUps = (toolPart.input as { suggestions?: string[] } | undefined)
                    ?.suggestions;
                  if (!isLatestMessage || !followUps?.length) return null;
                  return (
                    <div key={i} className="ps-follow-ups">
                      {followUps.map((s) => (
                        <SuggestionButton
                          key={s}
                          text={s}
                          disabled={busy}
                          onPick={(t) => sendMessage({ text: t })}
                        />
                      ))}
                    </div>
                  );
                }

                if (toolPart.state === "output-available" && toolPart.output != null) {
                  const out = toolPart.output as {
                    error?: string;
                    cells?: unknown[];
                    stages?: Array<{ runs: number }>;
                  };
                  // A chart of nothing reads as a broken chart. Degrade to one line.
                  const empty =
                    Boolean(out.error) ||
                    (Array.isArray(out.cells) && out.cells.length === 0) ||
                    (Array.isArray(out.stages) && out.stages.every((s) => s.runs === 0));
                  if (empty) {
                    return (
                      <p key={i} className="ps-empty-output">
                        {out.error ?? "No telemetry for that experiment yet."}
                      </p>
                    );
                  }
                  if (part.type === "tool-queryHeatmap" || part.type === "tool-compareMyRun") {
                    return (
                      <HeatmapCard
                        key={i}
                        output={toolPart.output as HeatmapOutput}
                        onDrillDown={onDrillDown}
                      />
                    );
                  }
                  if (part.type === "tool-queryDelta") {
                    return <DeltaCard key={i} output={toolPart.output as DeltaOutput} />;
                  }
                  if (part.type === "tool-queryFunnel") {
                    return <FunnelCard key={i} output={toolPart.output as FunnelOutput} />;
                  }
                }

                return (
                  <details key={i} className="ps-tool-state">
                    <summary>
                      {toolName} · {toolPart.state}
                    </summary>
                    <pre>
                      {JSON.stringify({ input: toolPart.input, output: toolPart.output }, null, 2)}
                    </pre>
                  </details>
                );
              }

              return null;
            })}
          </div>
        ))}
      </div>

      <form
        className="ps-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          className="ps-composer-input"
        />
        {busy ? (
          <button type="button" onClick={() => stop()} className="ps-stop-button">
            Stop
          </button>
        ) : (
          <button type="submit" className="ps-send-button">
            <span>Send</span>
            <span aria-hidden="true">↗</span>
          </button>
        )}
      </form>
    </div>
    </CanvasScaleProvider>
  );
}
