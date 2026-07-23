"use client";

import { useCallback, useRef, useState } from "react";
import { GameCanvas } from "../components/game-canvas";
import { CopilotPopover } from "@playerplayer/sdk";
import type { BrowserGameEvent } from "../game/browser-game";
import { fetchCulpritRuns, mintChatAccessToken, startChatSession } from "./actions";

// One human playthrough = one run_id, same shape the bots produce. Events
// buffer client-side and flush in batches so a 10Hz sampler never turns into
// 10 requests a second.
const FLUSH_EVERY = 40;

export function GamePage() {
  // Buffered per run id, so a stale game instance can never append its samples
  // to the live run.
  const buffersRef = useRef(new Map<string, BrowserGameEvent[]>());
  const [sent, setSent] = useState(0);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");

  const flush = useCallback(async (runId: string, force = false) => {
    const buf = buffersRef.current.get(runId);
    if (!buf || buf.length === 0 || (!force && buf.length < FLUSH_EVERY)) return;
    const batch = buf.splice(0, buf.length);
    setStatus("sending");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, events: batch }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSent((n) => n + batch.length);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, []);

  const onEvent = useCallback(
    (e: BrowserGameEvent, runId: string) => {
      const buffers = buffersRef.current;
      const buf = buffers.get(runId) ?? [];
      buf.push(e);
      buffers.set(runId, buf);
      void flush(runId, e.type === "run_end" || e.type === "death");
    },
    [flush],
  );

  return (
    <div className="game-workspace">
      <div className="game-workspace-bar">
        <div className="game-workspace-title">
          <span>Dungeon corridor</span>
          <span className="mono-label">Level 01</span>
        </div>
        <span className="game-run-badge">Human run live</span>
      </div>
      <GameCanvas onEvent={onEvent} />
      <div className="game-stream-bar" aria-live="polite">
        <span>
          <strong>ClickHouse telemetry</strong> · your trace streams into the bot swarm table
        </span>
        <span className="stream-count">
          {status === "sending" ? "syncing · " : ""}
          {sent.toLocaleString()} events
          {status === "error" ? " · ingest failed" : " · connected"}
        </span>
      </div>

      <CopilotPopover
        accessToken={({ chatId }) => mintChatAccessToken(chatId)}
        startSession={({ chatId, clientData }) => startChatSession({ chatId, clientData })}
        onDrillDown={fetchCulpritRuns}
        suggestions={[
          "Where do runs die on Level1?",
          "How does my run compare to the bot swarm?",
          "What if I move the slime guarding the corridor away from the door?",
        ]}
      />
    </div>
  );
}
