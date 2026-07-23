"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import "./arena.css";

// The ClickHouse Arena client. Renders the CH-authoritative grid world and posts
// intents; ClickHouse resolves every tick. The provenance chip shows engine / table
// / latency — never a connection detail (the CH host stays server-side).

type CellKind = "floor" | "wall" | "hazard" | "spawn" | "coin";
interface Cell { x: number; y: number; kind: CellKind; }
interface Player { playerId: number; x: number; y: number; score: number; alive: boolean; }
interface View { tick: number; over: boolean; alive: number; total: number; players: Player[]; coins: { x: number; y: number }[]; }

const PLAYER_COLORS = ["#d8f24b", "#72d7ff", "#ffb45e", "#c9a9ff", "#ff7898", "#83e8c2", "#f9e46d", "#ff9c74"];

const INTENT_BY_KEY: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  " ": "stay",
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<T>;
}

function ArenaMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 5h4v22H4zM10 5h4v8h-4zM10 16h4v11h-4zM16 5h4v22h-4zM22 5h4v6h-4zM22 14h4v13h-4z" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5 3 7 5-7 5V3Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
    </svg>
  );
}

function StepIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 3 6.5 5-6.5 5V3ZM11 3h1.8v10H11V3Z" fill="currentColor" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M12.9 6A5.25 5.25 0 1 0 13 9.45M13 2.75V6H9.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <ellipse cx="8" cy="3.5" rx="5" ry="2" stroke="currentColor" strokeWidth="1.25" />
      <path d="M3 3.5v4c0 1.1 2.24 2 5 2s5-.9 5-2v-4M3 7.5v4c0 1.1 2.24 2 5 2s5-.9 5-2v-4" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function HeatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8.35 1.8c.5 2.3-.25 3.45-1.22 4.53C6.2 7.38 5.25 8.45 5.25 10a2.75 2.75 0 1 0 5.5 0c0-1.25-.52-2.38-1.37-3.42.08 1.17-.34 1.9-1.03 2.42.16-1.92-.8-3.02-1.73-4.08.82-.82 1.45-1.8 1.73-3.12Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DirectionIcon({ direction }: { direction: "up" | "down" | "left" | "right" }) {
  const rotation = { up: 0, right: 90, down: 180, left: 270 }[direction];
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="m8 3 5 6H9.5v4h-3V9H3l5-6Z" fill="currentColor" />
    </svg>
  );
}

export default function ArenaPage() {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [cells, setCells] = useState<Cell[]>([]);
  const [humanId, setHumanId] = useState<number | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [blob, setBlob] = useState<{ text: string; source: string } | null>(null);
  const [heat, setHeat] = useState<Map<string, number> | null>(null);
  const matchIdRef = useRef<string | null>(null);

  // Boot either starts a new match or, with ?match=<id>&as=<playerId>, joins an
  // existing one and controls that player — that's what makes two browsers a real
  // shared multiplayer match.
  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    setAuto(false);
    setBlob(null);
    try {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const joinId = params.get("match");
      let m: { matchId: string; width: number; height: number; cells: Cell[]; humanIds: number[] };
      if (joinId) {
        m = await postJson("/api/arena/match", { matchId: joinId });
        const as = Number(params.get("as") ?? m.humanIds[0] ?? 1);
        setHumanId(m.humanIds.includes(as) ? as : (m.humanIds[0] ?? null));
      } else {
        const humans = Math.max(0, Math.min(4, Number(params.get("humans") ?? 1)));
        const bots = Math.max(0, Math.min(8, Number(params.get("bots") ?? 3)));
        m = await postJson("/api/arena/start", { humans, bots, maxTicks: 120 });
        setHumanId(m.humanIds[0] ?? null);
      }
      setMatchId(m.matchId);
      matchIdRef.current = m.matchId;
      setDims({ width: m.width, height: m.height });
      setCells(m.cells);
      setView(await postJson<View>("/api/arena/state", { matchId: m.matchId }));
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const step = useCallback(async () => {
    const id = matchIdRef.current;
    if (!id) return;
    const t0 = performance.now();
    try {
      const next = await postJson<View>("/api/arena/step", { matchId: id });
      setLatency(Math.round(performance.now() - t0));
      setView(next);
      if (next.over) setAuto(false);
    } catch (e) {
      setError(String(e));
      setAuto(false);
    }
  }, []);

  const sendIntent = useCallback(
    async (intent: string) => {
      const id = matchIdRef.current;
      if (!id || humanId == null) return;
      try {
        await postJson("/api/arena/input", { matchId: id, playerId: humanId, intent });
      } catch (e) {
        setError(String(e));
      }
    },
    [humanId],
  );

  // Toggle the activity heatmap read from the existing game_heatmap MV over this
  // match — the analytics reuse win, made visible.
  const toggleHeat = useCallback(async () => {
    if (heat) {
      setHeat(null);
      return;
    }
    const id = matchIdRef.current;
    if (!id) return;
    try {
      const res = await postJson<{ cells: { x: number; y: number; n: number }[] }>("/api/arena/heatmap", { matchId: id });
      setHeat(new Map(res.cells.map((c) => [`${c.x},${c.y}`, c.n])));
    } catch (e) {
      setError(String(e));
    }
  }, [heat]);

  const loadBlob = useCallback(async () => {
    const id = matchIdRef.current;
    if (!id) return;
    try {
      const res = await fetch("/api/arena/state-blob", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId: id }),
      });
      if (!res.ok) throw new Error(`state-blob ${res.status}`);
      setBlob({ text: await res.text(), source: res.headers.get("x-arena-source") ?? "unknown" });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    const h = setInterval(() => void step(), 500);
    return () => clearInterval(h);
  }, [auto, step]);

  // Sync poll: every client re-reads the shared frontier, so a second browser sees
  // whoever advanced the world (a stepping client here, or the Trigger loop in prod).
  useEffect(() => {
    if (!matchId) return;
    const h = setInterval(async () => {
      try {
        setView(await postJson<View>("/api/arena/state", { matchId }));
      } catch {
        // transient; the next tick retries
      }
    }, 700);
    return () => clearInterval(h);
  }, [matchId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const intent = INTENT_BY_KEY[e.key];
      if (!intent) return;
      e.preventDefault();
      void sendIntent(intent);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendIntent]);

  const playerAt = new Map<string, Player>();
  for (const p of view?.players ?? []) if (p.alive) playerAt.set(`${p.x},${p.y}`, p);
  const coinAt = new Set((view?.coins ?? []).map((c) => `${c.x},${c.y}`));
  const heatMax = heat && heat.size > 0 ? Math.max(...Array.from(heat.values())) : 1;
  const sortedPlayers = (view?.players ?? []).slice().sort((a, b) => a.playerId - b.playerId);
  const sortedCells = cells.slice().sort((a, b) => a.y * 100000 + a.x - (b.y * 100000 + b.x));
  const statusText = view
    ? `tick ${view.tick} • alive ${view.alive}/${view.total}${view.over ? " • OVER" : ""}`
    : "Preparing match…";

  return (
    <main className="arena-page">
      <div className="arena-ambient arena-ambient-one" aria-hidden="true" />
      <div className="arena-ambient arena-ambient-two" aria-hidden="true" />

      <div className="arena-shell">
        <header className="arena-topbar">
          <Link href="/" className="arena-brand" aria-label="Back to PlayerPlayer">
            <span className="arena-brand-mark">
              <ArenaMark />
            </span>
            <span className="arena-brand-copy">
              <strong>PLAYERPLAYER</strong>
              <span>/ ARENA</span>
            </span>
          </Link>

          <div className="arena-connection">
            <span className="arena-connection-dot" aria-hidden="true" />
            <span>ClickHouse connected</span>
          </div>
        </header>

        <section className="arena-hero">
          <div className="arena-hero-copy">
            <p className="arena-kicker"><span aria-hidden="true">◆</span> SQL-authoritative multiplayer</p>
            <h1>ClickHouse <em>Arena</em></h1>
            <p>
              Every player submits an intent. ClickHouse resolves the world.
              One shared state, one tick at a time.
            </p>
          </div>

          <div className="arena-metrics" aria-label="Live match metrics">
            <div className="arena-metric">
              <span>Tick</span>
              <strong>{view?.tick ?? "—"}</strong>
              <small>of 120</small>
            </div>
            <div className="arena-metric">
              <span>Active</span>
              <strong>{view ? `${view.alive}/${view.total}` : "—"}</strong>
              <small>players</small>
            </div>
            <div className="arena-metric">
              <span>Round trip</span>
              <strong>{latency == null ? "—" : latency}</strong>
              <small>{latency == null ? "awaiting step" : "milliseconds"}</small>
            </div>
          </div>
        </section>

        {error && (
          <div className="arena-alert" data-testid="arena-error" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>Match connection interrupted</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <section className="arena-command-deck" aria-label="Match controls">
          <div className="arena-command-primary">
            <button
              type="button"
              className={`arena-button arena-button-primary${auto ? " is-active" : ""}`}
              onClick={() => setAuto((a) => !a)}
              data-testid="arena-auto"
              aria-pressed={auto}
              disabled={!matchId || view?.over}
            >
              {auto ? <PauseIcon /> : <PlayIcon />}
              {auto ? "Pause run" : "Auto-play"}
            </button>
            <button
              type="button"
              className="arena-button"
              onClick={() => void step()}
              data-testid="arena-step"
              disabled={!matchId || view?.over}
            >
              <StepIcon />
              Step tick
            </button>
            <button
              type="button"
              className="arena-button arena-button-quiet"
              onClick={() => void start()}
              data-testid="arena-new"
              disabled={starting}
            >
              <RefreshIcon />
              {starting ? "Starting…" : "New match"}
            </button>
          </div>

          <div className="arena-command-secondary">
            <button
              type="button"
              className="arena-icon-button"
              onClick={() => void loadBlob()}
              data-testid="arena-blob-btn"
              disabled={!matchId}
              title="Load RawBLOB snapshot"
            >
              <DatabaseIcon />
              <span>Raw snapshot</span>
            </button>
            <button
              type="button"
              className={`arena-icon-button${heat ? " is-active" : ""}`}
              onClick={() => void toggleHeat()}
              data-testid="arena-heat-btn"
              disabled={!matchId}
              aria-pressed={Boolean(heat)}
              title={heat ? "Hide activity heatmap" : "Show activity heatmap"}
            >
              <HeatIcon />
              <span>{heat ? "Hide heat" : "Heatmap"}</span>
            </button>
          </div>

          <div className="arena-tick-status" data-testid="arena-status" aria-live="polite">
            <span className={`arena-tick-dot${auto ? " is-running" : ""}`} aria-hidden="true" />
            <span>{statusText}</span>
          </div>
        </section>

        <div className="arena-workspace">
          <section className="arena-stage-panel">
            <div className="arena-panel-heading">
              <div>
                <span className="arena-panel-index">01 / Live field</span>
                <h2>Match floor</h2>
              </div>
              <span className="arena-round-badge">
                <span aria-hidden="true" />
                {view?.over ? "match complete" : "round live"}
              </span>
            </div>

            <div className="arena-stage">
              <span className="arena-frame-corner arena-frame-corner-tl" aria-hidden="true" />
              <span className="arena-frame-corner arena-frame-corner-tr" aria-hidden="true" />
              <span className="arena-frame-corner arena-frame-corner-bl" aria-hidden="true" />
              <span className="arena-frame-corner arena-frame-corner-br" aria-hidden="true" />

              {dims.width > 0 ? (
                <div
                  className="arena-grid"
                  data-testid="arena-grid"
                  aria-label={`${dims.width} by ${dims.height} multiplayer arena`}
                  style={{
                    gridTemplateColumns: `repeat(${dims.width}, minmax(0, 1fr))`,
                    aspectRatio: `${dims.width} / ${dims.height}`,
                  }}
                >
                  {sortedCells.map((c) => {
                    const key = `${c.x},${c.y}`;
                    const player = playerAt.get(key);
                    const hasCoin = coinAt.has(key);
                    const heatValue = heat?.get(key);
                    const isHeated = heatValue != null;
                    const heatStyle = isHeated
                      ? { "--arena-heat-alpha": (0.2 + 0.72 * (heatValue / heatMax)).toFixed(3) } as CSSProperties
                      : undefined;

                    return (
                      <div
                        key={key}
                        className={`arena-cell arena-cell-${c.kind}${isHeated ? " is-heated" : ""}`}
                        data-testid={heat && heat.has(key) ? "arena-heat-cell" : undefined}
                        style={heatStyle}
                        title={`${c.kind} · ${c.x},${c.y}`}
                      >
                        {player ? (
                          <span
                            className={`arena-player-token${player.playerId === humanId ? " is-human" : ""}`}
                            style={{ "--arena-player-color": PLAYER_COLORS[(player.playerId - 1) % PLAYER_COLORS.length] } as CSSProperties}
                            title={`Player ${player.playerId}${player.playerId === humanId ? " — you" : ""}`}
                          >
                            {player.playerId}
                          </span>
                        ) : hasCoin ? (
                          <span className="arena-coin" title="Coin" />
                        ) : c.kind === "hazard" ? (
                          <span className="arena-hazard-mark" aria-hidden="true">×</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="arena-stage-loading">
                  <span />
                  <p>Building match state</p>
                </div>
              )}
            </div>

            <div className="arena-legend" aria-label="Arena legend">
              <span><i className="arena-legend-player" /> Player</span>
              <span><i className="arena-legend-coin" /> Coin</span>
              <span><i className="arena-legend-hazard" /> Hazard</span>
              <span><i className="arena-legend-spawn" /> Spawn</span>
              <span className="arena-legend-hint">Bright outline = you</span>
            </div>
          </section>

          <aside className="arena-sidebar">
            <section className="arena-side-panel arena-score-panel">
              <div className="arena-panel-heading arena-panel-heading-small">
                <div>
                  <span className="arena-panel-index">02 / Roster</span>
                  <h2>Scoreboard</h2>
                </div>
                <span className="arena-player-count">{view?.total ?? 0}P</span>
              </div>

              <div className="arena-table-wrap">
                <table className="arena-scoreboard">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Cell</th>
                      <th>Score</th>
                      <th>Live</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((p) => {
                      const playerColor = PLAYER_COLORS[(p.playerId - 1) % PLAYER_COLORS.length];
                      return (
                        <tr
                          key={p.playerId}
                          data-testid={`arena-player-${p.playerId}`}
                          className={p.alive ? "" : "is-out"}
                          style={{ "--arena-player-color": playerColor } as CSSProperties}
                        >
                          <td>
                            <span className="arena-roster-dot" />
                            <strong>P{p.playerId}</strong>
                            {p.playerId === humanId && <span className="arena-you-badge">you</span>}
                          </td>
                          <td data-testid={`arena-player-${p.playerId}-cell`}>{p.x},{p.y}</td>
                          <td data-testid={`arena-player-${p.playerId}-score`}>{p.score}</td>
                          <td data-testid={`arena-player-${p.playerId}-alive`}>
                            <span className={`arena-alive-state${p.alive ? "" : " is-out"}`}>{p.alive ? "yes" : "no"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="arena-side-panel arena-input-panel">
              <div className="arena-panel-heading arena-panel-heading-small">
                <div>
                  <span className="arena-panel-index">03 / Input</span>
                  <h2>Your controls</h2>
                </div>
                <span className="arena-control-mode">P{humanId ?? "—"}</span>
              </div>

              <div className="arena-input-body">
                <div className="arena-dpad" aria-label="Directional controls">
                  <button type="button" className="arena-dpad-up" onClick={() => void sendIntent("up")} aria-label="Move up">
                    <DirectionIcon direction="up" />
                  </button>
                  <button type="button" className="arena-dpad-left" onClick={() => void sendIntent("left")} aria-label="Move left">
                    <DirectionIcon direction="left" />
                  </button>
                  <button type="button" className="arena-dpad-stay" onClick={() => void sendIntent("stay")} aria-label="Hold position">
                    <span />
                  </button>
                  <button type="button" className="arena-dpad-right" onClick={() => void sendIntent("right")} aria-label="Move right">
                    <DirectionIcon direction="right" />
                  </button>
                  <button type="button" className="arena-dpad-down" onClick={() => void sendIntent("down")} aria-label="Move down">
                    <DirectionIcon direction="down" />
                  </button>
                </div>
                <div className="arena-keyboard-copy">
                  <p><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> move</p>
                  <p><kbd>space</kbd> hold position</p>
                  <small>Submit an intent, then advance the tick.</small>
                </div>
              </div>
            </section>

            <section className="arena-side-panel arena-engine-panel">
              <div className="arena-engine-icon">
                <DatabaseIcon />
              </div>
              <div
                className="arena-provenance"
                data-testid="arena-provenance"
              >
                <span>Authoritative engine</span>
                <strong>ClickHouse</strong>
                <p>table: <code>match_state</code> · resolved in SQL{latency != null ? ` · ${latency}ms round-trip` : ""}</p>
              </div>
              <p className="arena-match-id" data-testid="arena-match-id">match: {matchId ?? "…"}</p>
            </section>
          </aside>
        </div>

        {(heat || blob) && (
          <section className="arena-inspector-grid" aria-label="Match data inspector">
            {heat && (
              <article className="arena-inspector arena-heat-inspector" data-testid="arena-heat-note">
                <div className="arena-inspector-icon"><HeatIcon /></div>
                <div>
                  <span className="arena-panel-index">Activity layer</span>
                  <h2>{heat.size} active cells</h2>
                  <p>
                    Read from the existing <code>game_heatmap</code> materialized view — the same rollup
                    that serves the single-player dashboard, now over this live multiplayer match.
                  </p>
                </div>
              </article>
            )}

            {blob && (
              <article className="arena-inspector arena-blob-inspector" data-testid="arena-blob">
                <div className="arena-blob-heading">
                  <div>
                    <span className="arena-panel-index">Raw state payload</span>
                    <h2>ClickHouse snapshot</h2>
                  </div>
                  <span className="arena-source-badge">
                    source: <strong data-testid="arena-blob-source">{blob.source}</strong>
                  </span>
                </div>
                <p className="arena-blob-proxy">FORMAT RawBLOB · proxied same-origin</p>
                <pre>{blob.text}</pre>
              </article>
            )}
          </section>
        )}

        <footer className="arena-footer">
          <span>Intent → ClickHouse → resolved state</span>
          <span>Live multiplayer simulation / PlayerPlayer 2026</span>
        </footer>
      </div>
    </main>
  );
}
