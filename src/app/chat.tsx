"use client";

import { useEffect, useState } from "react";
import { Copilot, StatusChip } from "playtest-copilot";
import {
  fetchCulpritRuns,
  fetchStackHealth,
  mintChatAccessToken,
  startChatSession,
} from "./actions";
import { SparkIcon, SwarmMark } from "../components/app-shell";

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
    <div className="chat-layout">
      <aside className="chat-brief">
        <p className="eyebrow">Durable AI analyst</p>
        <h1>Ask the swarm.</h1>
        <p className="chat-brief-copy">
          Move from a design hunch to a reproducible experiment in one conversation.
          Every answer can show the query, the run count, and the map cells behind it.
        </p>

        <div className="brief-features" aria-label="Agent capabilities">
          <div className="brief-feature">
            <span className="brief-feature-index">01</span>
            <div>
              <strong>Find the failure pattern</strong>
              <span>Turn hundreds of routes into one readable hotspot.</span>
            </div>
          </div>
          <div className="brief-feature">
            <span className="brief-feature-index">02</span>
            <div>
              <strong>Test a counterfactual</strong>
              <span>Pause for approval, mutate the level, fan out matched runs.</span>
            </div>
          </div>
          <div className="brief-feature">
            <span className="brief-feature-index">03</span>
            <div>
              <strong>Prove the change</strong>
              <span>Compare death rate, spatial delta, and progression.</span>
            </div>
          </div>
        </div>

        <div className="chat-brief-footer">
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
      </aside>

      <section className="chat-console-shell" aria-label="Playtest agent conversation">
        <header className="chat-console-header">
          <div className="chat-console-title">
            <span className="chat-console-avatar">
              <SwarmMark />
            </span>
            <span>
              <strong>Playtest analyst</strong>
              <span>Context · Level 01 · Live telemetry</span>
            </span>
          </div>
          <div className="chat-health">
            <span className="status-pill px-3 py-1.5">
              <SparkIcon className="size-3 text-violet" />
              Tools ready
            </span>
            <span className="status-pill px-3 py-1.5">
              <span className="live-dot !size-1.5" />
              Streaming
            </span>
          </div>
        </header>

        <div className="chat-copilot-wrap">
          <Copilot
            accessToken={({ chatId }) => mintChatAccessToken(chatId)}
            startSession={({ chatId, clientData }) => startChatSession({ chatId, clientData })}
            onDrillDown={fetchCulpritRuns}
          />
        </div>
      </section>
    </div>
  );
}
