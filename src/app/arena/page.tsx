"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The ClickHouse Arena client. Renders the CH-authoritative grid world and posts
// intents; ClickHouse resolves every tick. The provenance chip shows engine / table
// / latency — never a connection detail (the CH host stays server-side).

type CellKind = "floor" | "wall" | "hazard" | "spawn" | "coin";
interface Cell { x: number; y: number; kind: CellKind; }
interface Player { playerId: number; x: number; y: number; score: number; alive: boolean; }
interface View { tick: number; over: boolean; alive: number; total: number; players: Player[]; coins: { x: number; y: number }[]; }

const CELL = 26;
const KIND_BG: Record<CellKind, string> = {
  floor: "#0f1729",
  wall: "#334155",
  hazard: "#7f1d1d",
  spawn: "#0e3a2f",
  coin: "#0f1729",
};
const PLAYER_COLORS = ["#22c55e", "#38bdf8", "#f59e0b", "#e879f9", "#f43f5e", "#a3e635", "#2dd4bf", "#fb923c"];

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

  return (
    <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui", color: "#e2e8f0", background: "#020617", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>ClickHouse Arena</h1>
      <p style={{ color: "#94a3b8", marginTop: 0, maxWidth: 640 }}>
        A live multiplayer grid game whose authoritative state is resolved by ClickHouse SQL,
        one tick at a time. You control the bright token — arrow keys to move, space to hold.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0", flexWrap: "wrap" }}>
        <button onClick={() => void step()} data-testid="arena-step" style={btn}>Step</button>
        <button onClick={() => setAuto((a) => !a)} data-testid="arena-auto" style={btn}>{auto ? "Pause" : "Auto"}</button>
        <button onClick={() => void start()} data-testid="arena-new" style={btn} disabled={starting}>New match</button>
        <button onClick={() => void loadBlob()} data-testid="arena-blob-btn" style={btn}>RawBLOB snapshot</button>
        <button onClick={() => void toggleHeat()} data-testid="arena-heat-btn" style={btn}>{heat ? "Hide heatmap" : "Heatmap"}</button>
        <span data-testid="arena-status" style={{ marginLeft: 8, color: "#cbd5e1" }}>
          {view ? `tick ${view.tick} • alive ${view.alive}/${view.total}${view.over ? " • OVER" : ""}` : "…"}
        </span>
      </div>

      <div
        data-testid="arena-provenance"
        style={{ fontSize: 12, color: "#7dd3fc", marginBottom: 12 }}
      >
        engine: ClickHouse · table: match_state · resolved in SQL{latency != null ? ` · ${latency}ms round-trip` : ""}
      </div>

      {error && <div data-testid="arena-error" style={{ color: "#fca5a5", marginBottom: 12 }}>{error}</div>}

      {heat && (
        <div data-testid="arena-heat-note" style={{ fontSize: 12, color: "#fca5a5", marginBottom: 12 }}>
          activity heatmap · {heat.size} active cells · from the existing game_heatmap materialized view — the same
          rollup that serves the single-player dashboard, now over a live multiplayer match with no new analytics code
        </div>
      )}

      {blob && (
        <div data-testid="arena-blob" style={{ marginBottom: 12, fontSize: 12 }}>
          <div style={{ color: "#7dd3fc" }}>
            served by ClickHouse (FORMAT RawBLOB) · source: <span data-testid="arena-blob-source">{blob.source}</span> · proxied same-origin
          </div>
          <pre style={{ background: "#0b1220", padding: 8, borderRadius: 6, overflowX: "auto", maxWidth: 640, color: "#cbd5e1" }}>{blob.text}</pre>
        </div>
      )}

      {dims.width > 0 && (
        <div
          data-testid="arena-grid"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${dims.width}, ${CELL}px)`,
            gridTemplateRows: `repeat(${dims.height}, ${CELL}px)`,
            gap: 1,
            width: "fit-content",
            background: "#1e293b",
            padding: 1,
            borderRadius: 6,
          }}
        >
          {cells
            .slice()
            .sort((a, b) => a.y * 100000 + a.x - (b.y * 100000 + b.x))
            .map((c) => {
              const key = `${c.x},${c.y}`;
              const player = playerAt.get(key);
              const hasCoin = coinAt.has(key);
              return (
                <div
                  key={key}
                  data-testid={heat && heat.has(key) ? "arena-heat-cell" : undefined}
                  style={{
                    width: CELL,
                    height: CELL,
                    background:
                      heat && heat.get(key)
                        ? `rgba(239,68,68,${(0.2 + 0.7 * (heat.get(key)! / heatMax)).toFixed(3)})`
                        : KIND_BG[c.kind],
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {player ? (
                    <span
                      style={{
                        width: CELL - 8,
                        height: CELL - 8,
                        borderRadius: "50%",
                        background: PLAYER_COLORS[(player.playerId - 1) % PLAYER_COLORS.length],
                        color: "#020617",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        outline: player.playerId === humanId ? "2px solid #fff" : "none",
                      }}
                    >
                      {player.playerId}
                    </span>
                  ) : hasCoin ? (
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fbbf24" }} />
                  ) : c.kind === "hazard" ? (
                    <span style={{ color: "#fca5a5" }}>×</span>
                  ) : null}
                </div>
              );
            })}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ color: "#94a3b8", marginBottom: 4 }} data-testid="arena-match-id">match: {matchId ?? "…"}</div>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#64748b", textAlign: "left" }}>
              <th style={th}>player</th><th style={th}>cell</th><th style={th}>score</th><th style={th}>alive</th>
            </tr>
          </thead>
          <tbody>
            {(view?.players ?? [])
              .slice()
              .sort((a, b) => a.playerId - b.playerId)
              .map((p) => (
                <tr key={p.playerId} data-testid={`arena-player-${p.playerId}`}>
                  <td style={td}>
                    <span style={{ color: PLAYER_COLORS[(p.playerId - 1) % PLAYER_COLORS.length] }}>
                      P{p.playerId}{p.playerId === humanId ? " (you)" : ""}
                    </span>
                  </td>
                  <td style={td} data-testid={`arena-player-${p.playerId}-cell`}>{p.x},{p.y}</td>
                  <td style={td} data-testid={`arena-player-${p.playerId}-score`}>{p.score}</td>
                  <td style={td} data-testid={`arena-player-${p.playerId}-alive`}>{p.alive ? "yes" : "no"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const btn: React.CSSProperties = {
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 13,
};
const th: React.CSSProperties = { padding: "4px 12px 4px 0", fontWeight: 600 };
const td: React.CSSProperties = { padding: "3px 12px 3px 0" };
