"use client";

import { useCallback, useRef, useState } from "react";
import { GameCanvas } from "../components/game-canvas";
import type { BrowserGameEvent } from "../game/browser-game";

// One human playthrough = one run_id, same shape the bots produce. Events
// buffer client-side and flush in batches so a 10Hz sampler never turns into
// 10 requests a second.
const FLUSH_EVERY = 40;

export function GamePage() {
  const runIdRef = useRef<string>(`human-${crypto.randomUUID()}`);
  const bufferRef = useRef<BrowserGameEvent[]>([]);
  const [sent, setSent] = useState(0);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");

  const flush = useCallback(async (force = false) => {
    const buf = bufferRef.current;
    if (buf.length === 0 || (!force && buf.length < FLUSH_EVERY)) return;
    const batch = buf.splice(0, buf.length);
    setStatus("sending");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: runIdRef.current, events: batch }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSent((n) => n + batch.length);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, []);

  const onEvent = useCallback(
    (e: BrowserGameEvent) => {
      bufferRef.current.push(e);
      void flush(e.type === "run_end" || e.type === "death");
    },
    [flush],
  );

  return (
    <div className="flex flex-col gap-4">
      <GameCanvas onEvent={onEvent} />
      <p className="text-center text-xs text-zinc-600">
        your run streams into the same ClickHouse table the bot swarm writes to —{" "}
        {sent.toLocaleString()} events sent
        {status === "error" ? " · ingest failed" : ""}
      </p>
    </div>
  );
}
