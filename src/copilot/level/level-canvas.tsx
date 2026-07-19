"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { levelGeometry } from "./level-geometry";
import { useCanvasScale } from "../layout-context";

const OBJECT_COLORS: Record<string, string> = {
  slime: "#4ade80",
  enemy: "#f87171",
  demon: "#c084fc",
  coins: "#facc15",
  spawn: "#38bdf8",
};

export interface CanvasTrail {
  runId: string;
  archetype: string;
  points: Array<{ x: number; y: number }>;
  death: { x: number; y: number } | null;
}

const TRAIL_COLORS: Record<string, string> = {
  rusher: "#fb923c",
  explorer: "#22d3ee",
  cautious: "#a3e635",
};

interface LevelCanvasProps {
  room: string;
  /** cell key "gx,gy" → css fill color (painted over floor, under objects) */
  cellColors: Map<string, string>;
  tooltipFor?: (gx: number, gy: number) => string | null;
  onCellClick?: (gx: number, gy: number) => void;
  /** ghost trails drawn over the map, revealed progressively */
  trails?: CanvasTrail[];
  scale?: number;
}

export function LevelCanvas({
  room,
  cellColors,
  tooltipFor,
  onCellClick,
  trails,
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

  const longest = useMemo(
    () => Math.max(1, ...(trails ?? []).map((t) => t.points.length)),
    [trails],
  );

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

    const { widthTiles, heightTiles, walls, objects } = geometry;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthTiles * scale * dpr;
    canvas.height = heightTiles * scale * dpr;
    canvas.style.width = `${widthTiles * scale}px`;
    canvas.style.height = `${heightTiles * scale}px`;
    ctx.scale(dpr, dpr);

    for (let y = 0; y < heightTiles; y++) {
      for (let x = 0; x < widthTiles; x++) {
        ctx.fillStyle = walls[y * widthTiles + x] ? "#3f3f46" : "#131316";
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    // Trails replace the aggregate wash — showing both at once is unreadable.
    const replaying = Boolean(trails && trails.length > 0);
    if (!replaying) {
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
    void objects;
    void longest;
  }, [geometry, cellColors, scale, trails, progress, longest]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        className={`rounded-md border border-zinc-800${onCellClick ? " cursor-pointer" : ""}`}
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
          className="pointer-events-none absolute z-10 rounded bg-zinc-950/95 px-2 py-1 text-xs text-zinc-200 shadow-lg"
          style={{ left: (hover.gx + 1) * scale + 4, top: hover.gy * scale }}
        >
          {hover.text}
        </div>
      )}
      <div className="mt-1 flex gap-3 text-[10px] text-zinc-500">
        {Object.entries(OBJECT_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
