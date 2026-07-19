"use client";

import { useEffect, useState } from "react";
import { Copilot, StatusChip } from "../copilot";
import {
  fetchCulpritRuns,
  fetchStackHealth,
  mintChatAccessToken,
  startChatSession,
} from "./actions";

// The reference integration: the host owns the Trigger server actions and the
// ClickHouse-backed drill-down, and hands them to the widget as props.
export function Chat() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof fetchStackHealth>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchStackHealth().then((h) => {
        if (!cancelled) setHealth(h);
      });
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col p-4">
      <header className="mb-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold tracking-tight">Playtest Swarm</h1>
          <p className="text-sm text-zinc-500">the agent that re-runs your level to prove the fix</p>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
          <StatusChip live label="Trigger.dev agent · chat.agent() + task fan-out" />
          <StatusChip
            live={health?.ok ?? false}
            label={
              health
                ? `ClickHouse Cloud · ${health.events.toLocaleString()} events from ${health.runs.toLocaleString()} runs · ${health.pingMs}ms`
                : "ClickHouse Cloud · connecting…"
            }
          />
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <Copilot
          accessToken={({ chatId }) => mintChatAccessToken(chatId)}
          startSession={({ chatId, clientData }) => startChatSession({ chatId, clientData })}
          onDrillDown={fetchCulpritRuns}
        />
      </div>
    </div>
  );
}
