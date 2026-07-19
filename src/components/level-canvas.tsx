"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { levelGeometry } from "./level-geometry";

const OBJECT_COLORS: Record<string, string> = {
  slime: "#4ade80",
  enemy: "#f87171",
  demon: "#c084fc",
  coins: "#facc15",
  spawn: "#38bdf8",
};

interface LevelCanvasProps {
  room: string;
  /** cell key "gx,gy" → css fill color (painted over floor, under objects) */
  cellColors: Map<string, string>;
  tooltipFor?: (gx: number, gy: number) => string | null;
  scale?: number;
}

export function LevelCanvas({ room, cellColors, tooltipFor, scale = 13 }: LevelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ gx: number; gy: number; text: string } | null>(null);
  const geometry = useMemo(() => levelGeometry(room), [room]);

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

    for (const [key, color] of cellColors) {
      const [gx, gy] = key.split(",").map(Number);
      ctx.fillStyle = color;
      ctx.fillRect(gx * scale, gy * scale, scale, scale);
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
    void objects;
  }, [geometry, cellColors, scale]);

  return (
    <div className="relative inline-block">
      <canvas
        ref={canvasRef}
        className="rounded-md border border-zinc-800"
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
