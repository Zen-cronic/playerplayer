"use client";

import { createContext, useContext } from "react";

// A 50-tile level at scale 13 is 650px wide — fine full-page, far too wide for
// a collapsed popover. The scale travels by context so card components don't
// need to thread a layout prop they otherwise don't care about.
const CanvasScaleContext = createContext(13);

export const CanvasScaleProvider = CanvasScaleContext.Provider;

export function useCanvasScale(): number {
  return useContext(CanvasScaleContext);
}
