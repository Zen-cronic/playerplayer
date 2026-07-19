"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { InferChatUIMessage } from "@trigger.dev/sdk/chat/react";
import type { playtestChat } from "../trigger/playtest-chat";
import { mintChatAccessToken, startChatSession } from "./actions";

type PlaytestMessage = InferChatUIMessage<typeof playtestChat>;

const SUGGESTIONS = [
  "Where do runs die on Level1?",
  "What if I move the slime guarding the corridor away from the door?",
  "Show me the progression funnel for the last experiment",
];

export function Chat() {
  const transport = useTriggerChatTransport<typeof playtestChat>({
    task: "playtest-chat",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) => startChatSession({ chatId, clientData }),
  });

  const { messages, sendMessage, addToolApprovalResponse, stop, status } = useChat<PlaytestMessage>({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState("");

  const busy = status === "streaming" || status === "submitted";

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight">Playtest Swarm</h1>
        <p className="text-sm text-zinc-500">the agent that re-runs your level to prove the fix</p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        {messages.length === 0 && (
          <div className="space-y-2 pt-8 text-center">
            <p className="text-zinc-400">Ask about your level, or try:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage({ text: s })}
                className="block w-full rounded-md border border-zinc-700 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "text-right" : ""}>
            {msg.parts.map((part, i) => {
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
                  return (
                    <div key={i} className="my-2 rounded-lg border border-amber-600/50 bg-amber-950/30 p-3">
                      <p className="mb-2 text-sm font-medium text-amber-300">
                        Approve swarm run? This dispatches bot runs against your level.
                      </p>
                      <pre className="mb-2 max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-400">
                        {JSON.stringify(toolPart.input, null, 2)}
                      </pre>
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
          placeholder="Ask about your level…"
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
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
  );
}
