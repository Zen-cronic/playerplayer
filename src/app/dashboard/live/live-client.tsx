"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LevelCanvas } from "playtest-copilot";
import { fetchLiveOps, launchLiveSwarm } from "../../actions";
import type { LiveOpsSnapshot } from "../../../lib/ops-queries";

// Client poller for the live panel: a 1.5s server-action loop (same pattern as
// the chat page's health chip — ZERO Realtime connections) with an in-flight
// guard so a slow network can never pile up requests.
export function LiveOpsClient() {
  const [snap, setSnap] = useState<LiveOpsSnapshot | null>(null);
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const idRef = useRef<string | undefined>(undefined);

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setSnap(await fetchLiveOps(idRef.current));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void tick();
    const handle = setInterval(() => void tick(), 1500);
    return () => clearInterval(handle);
  }, [tick]);

  const launch = async () => {
    setLaunching(true);
    setNotice(null);
    const res = await launchLiveSwarm();
    if (res.ok && res.experimentId) {
      idRef.current = res.experimentId;
      setNotice(`wave launched — ${res.experimentId}`);
    } else {
      setNotice(
        res.reason === "cooldown"
          ? "a live swarm ran in the last 5 minutes — cooling down"
          : "launch unavailable right now",
      );
    }
    setLaunching(false);
  };

  const active = (snap?.activeRuns ?? 0) > 0;

  // Events/sec reads the last FULL second — the current second is mid-fill.
  const perSecTail = snap?.perSec ?? [];
  const eventsPerSec = perSecTail.length > 1 ? perSecTail[perSecTail.length - 2].n : (perSecTail[0]?.n ?? 0);

  // 60 fixed one-second slots, keyed by absolute second so gaps render as gaps.
  const sparkBars = useMemo(() => {
    const bySecond = new Map(perSecTail.map((p) => [p.s.slice(0, 19), p.n]));
    const max = Math.max(1, ...perSecTail.map((p) => p.n));
    const bars: number[] = [];
    const now = Date.now();
    for (let i = 59; i >= 0; i--) {
      const d = new Date(now - i * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
      bars.push((bySecond.get(key) ?? 0) / max);
    }
    return bars;
  }, [perSecTail]);

  const hotCellColors = useMemo(() => {
    const colors = new Map<string, string>();
    const max = Math.max(1, ...(snap?.hotCells ?? []).map((c) => c.n));
    for (const c of snap?.hotCells ?? []) {
      colors.set(`${c.gx},${c.gy}`, `rgba(91, 77, 245, ${0.25 + 0.6 * (c.n / max)})`);
    }
    return colors;
  }, [snap?.hotCells]);

  return (
    <>
      <section className="metric-grid" aria-label="Live swarm metrics">
        <div className="metric-cell">
          <span className="metric-label">Events / sec</span>
          <strong className="metric-value">{eventsPerSec.toLocaleString()}</strong>
          <span className="metric-note">Last full second of ingest</span>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Active runs</span>
          <strong className="metric-value">{snap?.activeRuns ?? 0}</strong>
          <span className="metric-note">Streamed events in the last 5s</span>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Wave events</span>
          <strong className="metric-value">{(snap?.totalEvents ?? 0).toLocaleString()}</strong>
          <span className="metric-note">{snap?.experimentId ?? "no live wave yet"}</span>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Wave runs</span>
          <strong className="metric-value">{snap?.totalRuns ?? 0}</strong>
          <span className="metric-note">Distinct streaming bots</span>
        </div>
      </section>

      <section className="section-block" aria-labelledby="spark-heading">
        <header className="section-heading">
          <span className="section-index">01</span>
          <h2 id="spark-heading">Ingest, second by second</h2>
          <p>Events landing in game_events over the last 60 seconds — polled every 1.5s.</p>
        </header>
        <div className="live-spark" role="img" aria-label="Events per second over the last minute">
          {sparkBars.map((h, i) => (
            <span key={i} style={{ height: `${Math.max(3, Math.round(h * 100))}%` }} data-active={h > 0 || undefined} />
          ))}
        </div>
        <div className="live-actions">
          <button type="button" className="dash-tab" onClick={launch} disabled={launching || active}>
            {launching ? "launching…" : active ? "wave in flight" : "launch live swarm (18 bots)"}
          </button>
          {active && (
            <span className="global-live">
              <span className="live-dot" aria-hidden="true" />
              <span>Streaming</span>
            </span>
          )}
          {notice && <span className="muted-copy live-notice">{notice}</span>}
        </div>
      </section>

      <section className="section-block" aria-labelledby="hot-heading">
        <header className="section-heading">
          <span className="section-index">02</span>
          <h2 id="hot-heading">Where the swarm is right now</h2>
          <p>Traffic density over the last minute, drawn on the level — violet deepens with visits.</p>
        </header>
        {snap && snap.hotCells.length > 0 ? (
          <div className="visualization-card-slot">
            <LevelCanvas room="Level1" cellColors={hotCellColors} />
          </div>
        ) : (
          <p className="empty-state">No live traffic in the last minute — launch a wave.</p>
        )}
      </section>
    </>
  );
}
