"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // A fixed element still participates in every ancestor stacking context. The
  // game card intentionally creates one below the sticky app header, which
  // otherwise covers the expanded popover controls. Portalling the floating UI
  // to <body> makes its z-index viewport-relative in any host application.
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  if (!portalTarget) return null;

  const content = !open ? (
    <button
      aria-label={launcherLabel}
      onClick={() => setOpen(true)}
      className="ps-copilot-launcher"
    >
      <span className="ps-launcher-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="ps-launcher-label" aria-hidden="true">{launcherLabel}</span>
      <span className="ps-launcher-live" aria-hidden="true">Live</span>
    </button>
  ) : (
    <div
      className={
        expanded
          ? "ps-copilot-popover is-expanded"
          : "ps-copilot-popover"
      }
    >
      <div className="ps-popover-header">
        <span className="ps-popover-title">
          <span className="ps-popover-symbol" aria-hidden="true">✦</span>
          <span>
            <strong>PlayerPlayer</strong>
            <small>Level analyst · connected</small>
          </span>
        </span>
        <div className="ps-popover-actions">
          <button onClick={() => setExpanded((v) => !v)} className="ps-popover-action">
            {expanded ? "shrink" : "expand"}
          </button>
          <button onClick={() => setOpen(false)} className="ps-popover-action">
            close
          </button>
        </div>
      </div>
      <div className="ps-popover-body">
        <Copilot {...copilot} layout="panel" canvasScale={expanded ? 13 : 7} />
      </div>
    </div>
  );

  return createPortal(content, portalTarget);
}
