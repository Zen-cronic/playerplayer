"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { levelGeometry } from "./level-geometry";
import { useCanvasScale } from "../layout-context";

const OBJECT_COLORS: Record<string, string> = {
  slime: "#72e3a5",
  enemy: "#ff7961",
  demon: "#b9a3ff",
  coins: "#d8f24b",
  spawn: "#62d5ff",
};

export interface CanvasTrail {
  runId: string;
  archetype: string;
  points: Array<{ x: number; y: number }>;
  death: { x: number; y: number } | null;
}

// The archetype → trail color mapping, shared with the culprit-run legend in
// heatmap-card so the drawn trail and its label can never drift apart.
export const TRAIL_COLORS: Record<string, string> = {
  rusher: "#ff795a",
  explorer: "#62d5ff",
  cautious: "#d8f24b",
  // The player's own run has to read instantly against red deaths and blue traffic.
  human: "#ffffff",
};

interface LevelCanvasProps {
  room: string;
  /** cell key "gx,gy" → css fill color (painted over floor, under objects) */
  cellColors: Map<string, string>;
  tooltipFor?: (gx: number, gy: number) => string | null;
  onCellClick?: (gx: number, gy: number) => void;
  /** ghost trails drawn over the map, revealed progressively */
  trails?: CanvasTrail[];
  /** keep the aggregate wash visible under the trails (human-vs-swarm overlay) */
  keepCellColors?: boolean;
  scale?: number;
}

export function LevelCanvas({
  room,
  cellColors,
  tooltipFor,
  onCellClick,
  trails,
  keepCellColors = false,
  scale: scaleProp,
}: LevelCanvasProps) {
  const contextScale = useCanvasScale();
  const maxScale = scaleProp ?? contextScale;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The card lives in anything from a 380px popover to a full page, so the
  // map sizes itself to the space available rather than overflowing it.
  const [fitScale, setFitScale] = useState(maxScale);
  const [hover, setHover] = useState<{ gx: number; gy: number; text: string } | null>(null);
  const geometry = useMemo(() => levelGeometry(room), [room]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const avail = el.clientWidth;
      if (avail > 0) setFitScale(Math.max(3, Math.min(maxScale, Math.floor(avail / geometry.widthTiles))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [geometry.widthTiles, maxScale]);

  const scale = fitScale;
  // 0..1 sweep used to reveal the trails; resets whenever the trails change.
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!trails || trails.length === 0) return;
    setProgress(0);
    let raf = 0;
    let done = false;
    // ~2.5s sweep regardless of run length, so long and short runs replay together.
    const stepPerFrame = 1 / (2.5 * 60);
    const tick = () => {
      if (done) return;
      setProgress((p) => {
        const next = p + stepPerFrame;
        if (next >= 1) {
          done = true;
          return 1;
        }
        raf = requestAnimationFrame(tick);
        return next;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      done = true;
      cancelAnimationFrame(raf);
    };
  }, [trails]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { widthTiles, heightTiles, walls } = geometry;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthTiles * scale * dpr;
    canvas.height = heightTiles * scale * dpr;
    canvas.style.width = `${widthTiles * scale}px`;
    canvas.style.height = `${heightTiles * scale}px`;
    ctx.scale(dpr, dpr);

    for (let y = 0; y < heightTiles; y++) {
      for (let x = 0; x < widthTiles; x++) {
        ctx.fillStyle = walls[y * widthTiles + x] ? "#37373e" : "#111115";
        ctx.fillRect(x * scale, y * scale, scale, scale);
        ctx.strokeStyle = "rgba(255,255,255,0.025)";
        ctx.strokeRect(x * scale + 0.5, y * scale + 0.5, scale - 1, scale - 1);
      }
    }

    // A hotspot replay replaces the aggregate wash (both at once is
    // unreadable); the human-vs-swarm overlay deliberately keeps it.
    const replaying = Boolean(trails && trails.length > 0);
    if (!replaying || keepCellColors) {
      for (const [key, color] of cellColors) {
        const [gx, gy] = key.split(",").map(Number);
        ctx.fillStyle = color;
        ctx.fillRect(gx * scale, gy * scale, scale, scale);
      }
    }

    for (const o of geometry.objects) {
      const color = OBJECT_COLORS[o.type];
      if (!color) continue;
      ctx.fillStyle = color;
      const s = Math.max(3, scale * 0.4);
      ctx.beginPath();
      ctx.arc(o.tileX * scale + scale / 2, o.tileY * scale + scale / 2, s / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (replaying) {
      const px = (v: number) => (v / 16) * scale;
      for (const trail of trails!) {
        const shown = Math.max(2, Math.floor(trail.points.length * progress));
        const pts = trail.points.slice(0, shown);
        if (pts.length < 2) continue;
        ctx.strokeStyle = TRAIL_COLORS[trail.archetype] ?? "#e4e4e7";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(px(pts[0].x), px(pts[0].y));
        for (const p of pts.slice(1)) ctx.lineTo(px(p.x), px(p.y));
        ctx.stroke();

        // Leading dot: where this bot is at the current sweep position.
        const head = pts[pts.length - 1];
        ctx.globalAlpha = 1;
        ctx.fillStyle = TRAIL_COLORS[trail.archetype] ?? "#e4e4e7";
        ctx.beginPath();
        ctx.arc(px(head.x), px(head.y), 2.5, 0, Math.PI * 2);
        ctx.fill();

        if (trail.death && progress >= 0.999) {
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2;
          const dx = px(trail.death.x);
          const dy = px(trail.death.y);
          ctx.beginPath();
          ctx.moveTo(dx - 4, dy - 4);
          ctx.lineTo(dx + 4, dy + 4);
          ctx.moveTo(dx + 4, dy - 4);
          ctx.lineTo(dx - 4, dy + 4);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }, [geometry, cellColors, scale, trails, progress, keepCellColors]);

  return (
    <div ref={wrapRef} className="ps-level-wrap">
      <canvas
        ref={canvasRef}
        className={`ps-level-canvas${onCellClick ? " is-clickable" : ""}`}
        onClick={(e) => {
          if (!onCellClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onCellClick(
            Math.floor((e.clientX - rect.left) / scale),
            Math.floor((e.clientY - rect.top) / scale),
          );
        }}
        onMouseMove={(e) => {
          if (!tooltipFor) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const gx = Math.floor((e.clientX - rect.left) / scale);
          const gy = Math.floor((e.clientY - rect.top) / scale);
          const text = tooltipFor(gx, gy);
          setHover(text ? { gx, gy, text } : null);
        }}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div
          className="ps-level-tooltip"
          style={{ left: (hover.gx + 1) * scale + 4, top: hover.gy * scale }}
        >
          {hover.text}
        </div>
      )}
      <div className="ps-level-legend">
        <span className="ps-legend-title">Map objects</span>
        {Object.entries(OBJECT_COLORS).map(([type, color]) => (
          <span key={type} className="ps-legend-item">
            <span className="ps-legend-dot" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
