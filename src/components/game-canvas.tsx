"use client";

import { useEffect, useRef, useState } from "react";
import type { BrowserGameEvent } from "../game/browser-game";

export function GameCanvas({
  level = "Level1",
  onEvent,
}: {
  level?: string;
  onEvent?: (event: BrowserGameEvent) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept in a ref so a changing callback identity never restarts the game.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let handle: { destroy(): void } | null = null;

    // Phaser touches window at import time, so it can only load client-side.
    import("../game/browser-game")
      .then(({ startBrowserGame }) =>
        startBrowserGame({
          parent: host,
          level,
          onEvent: (e) => onEventRef.current?.(e),
        }),
      )
      .then((h) => {
        if (disposed) h.destroy();
        else handle = h;
      })
      .catch((e) => setError(String(e)));

    return () => {
      disposed = true;
      handle?.destroy();
    };
  }, [level]);

  return (
    <div className="flex flex-col items-center">
      <div
        ref={hostRef}
        className="overflow-hidden rounded-lg border border-zinc-800 bg-black"
        style={{ width: 640, height: 360 }}
      />
      {error && <p className="mt-2 text-xs text-red-400">game failed to start: {error}</p>}
      <p className="mt-2 text-xs text-zinc-500">
        arrow keys to move · space to attack · collect coins, avoid the slimes
      </p>
    </div>
  );
}
