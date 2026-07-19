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
      className="block w-full rounded-md border border-zinc-700 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
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
    <div className="flex h-full min-h-0 flex-col">
      {header}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
      >
        {messages.length === 0 && (
          <div className={`space-y-2 text-center ${layout === "full" ? "pt-8" : "pt-2"}`}>
            <p className="text-sm text-zinc-400">Ask about your level, or try:</p>
            {suggestions.map((s) => (
              <SuggestionButton key={s} text={s} onPick={(t) => sendMessage({ text: t })} />
            ))}
          </div>
        )}

        {messages.map((msg, msgIndex) => (
          <div key={msg.id} className={msg.role === "user" ? "text-right" : ""}>
            {msg.parts.map((part, i) => {
              const isLatestMessage = msgIndex === messages.length - 1;
              if (part.type === "text") {
                return (
                  <p
                    key={i}
                    className={
                      msg.role === "user"
                        ? "inline-block rounded-lg bg-indigo-600/80 px-3 py-2 text-sm"
                        : "whitespace-pre-wrap text-sm text-zinc-200"
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
                    <div key={i} className="my-2 rounded-lg border border-amber-600/50 bg-amber-950/30 p-3">
                      <p className="text-sm font-medium text-amber-300">
                        Run {(spec?.runsPerVariant ?? 18) * 2} bot playthroughs to test this?
                      </p>
                      {spec?.hypothesis && (
                        <p className="mt-1 text-sm text-zinc-300">{spec.hypothesis}</p>
                      )}
                      <ul className="my-2 space-y-1 text-xs text-zinc-400">
                        {(spec?.mutations ?? []).map((m, mi) => (
                          <li key={mi}>· {describeMutation(m)}</li>
                        ))}
                        <li>
                          · {spec?.runsPerVariant ?? 18} matched-seed runs per variant on{" "}
                          {spec?.room ?? "Level1"}, baseline vs mutated
                        </li>
                      </ul>
                      <details className="mb-2 text-xs">
                        <summary className="cursor-pointer text-zinc-600">raw spec</summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-zinc-500">
                          {JSON.stringify(toolPart.input, null, 2)}
                        </pre>
                      </details>
                      <div className="flex gap-2">
                        <button
                          onClick={() => addToolApprovalResponse({ id: approvalId, approved: true })}
                          className="rounded-md bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() =>
                            addToolApprovalResponse({ id: approvalId, approved: false, reason: "Designer denied" })
                          }
                          className="rounded-md bg-zinc-700 px-3 py-1 text-sm hover:bg-zinc-600"
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
                    <div key={i} className="mt-3 space-y-2">
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
                      <p key={i} className="my-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
                        {out.error ?? "No telemetry for that experiment yet."}
                      </p>
                    );
                  }
                  if (part.type === "tool-queryHeatmap") {
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
                  <details key={i} className="my-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-xs">
                    <summary className="cursor-pointer text-zinc-400">
                      {toolName} · {toolPart.state}
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto text-zinc-500">
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
        className="mt-3 flex gap-2"
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
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        {busy ? (
          <button type="button" onClick={() => stop()} className="rounded-md bg-red-800 px-4 py-2 text-sm">
            Stop
          </button>
        ) : (
          <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm hover:bg-indigo-500">
            Send
          </button>
        )}
      </form>
    </div>
    </CanvasScaleProvider>
  );
}
