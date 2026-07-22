"use client";

import { useEffect, useRef, useState } from "react";
import type { BrowserGameEvent } from "../game/browser-game";

export function GameCanvas({
  level = "Level1",
  onEvent,
}: {
  level?: string;
  /** Receives the run id too: each game instance is its own run. */
  onEvent?: (event: BrowserGameEvent, runId: string) => void;
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
    // One run id per game instance. Tying it to the component mount instead
    // would let a hot-reloaded or double-mounted game append its samples to a
    // previous run, producing a "trail" that is really several paths at once.
    const runId = `human-${crypto.randomUUID()}`;

    // Phaser touches window at import time, so it can only load client-side.
    import("../game/browser-game")
      .then(({ startBrowserGame }) =>
        startBrowserGame({
          parent: host,
          level,
          onEvent: (e) => onEventRef.current?.(e, runId),
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
    <div className="game-canvas-unit">
      <div
        ref={hostRef}
        className="game-canvas-host"
      />
      {error && (
        <p className="border-t border-red-500/30 bg-red-950 px-4 py-2 text-xs text-red-200">
          game failed to start: {error}
        </p>
      )}
      <div className="game-controls">
        <span className="key-guide">
          <span className="key-cap">←↑↓→</span>
          Move
        </span>
        <span className="key-guide">
          <span className="key-cap">Space</span>
          Attack
        </span>
        <span>Collect coins · avoid slimes</span>
      </div>
    </div>
  );
}
