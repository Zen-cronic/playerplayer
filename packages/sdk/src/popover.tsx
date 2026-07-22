"use client";

import { useState } from "react";
import { Copilot, type CopilotProps } from "./copilot";

export interface CopilotPopoverProps extends Omit<CopilotProps, "layout" | "canvasScale"> {
  /** Text on the closed launcher button. */
  launcherLabel?: string;
  /** Open on first mount — useful for demos. */
  defaultOpen?: boolean;
}

// Mounted alongside a running game. Collapsed it's a launcher button; open it's
// a panel; expanded it takes most of the viewport, because a delta heatmap in a
// 380px column is unreadable and the visual IS the answer.
export function CopilotPopover({
  launcherLabel = "Ask the playtest agent",
  defaultOpen = false,
  ...copilot
}: CopilotPopoverProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-indigo-500"
      >
        {launcherLabel}
      </button>
    );
  }

  return (
    <div
      className={
        expanded
          ? "fixed inset-4 z-40 flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur"
          : "fixed bottom-5 right-5 z-40 flex h-[min(620px,80vh)] w-[min(420px,92vw)] flex-col rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur"
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">Playtest Swarm</span>
        <div className="flex gap-2 text-xs text-zinc-500">
          <button onClick={() => setExpanded((v) => !v)} className="hover:text-zinc-200">
            {expanded ? "shrink" : "expand"}
          </button>
          <button onClick={() => setOpen(false)} className="hover:text-zinc-200">
            close
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Copilot {...copilot} layout="panel" canvasScale={expanded ? 13 : 7} />
      </div>
    </div>
  );
}
