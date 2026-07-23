"use client";

import { LevelCanvas, type CanvasTrail } from "@playerplayer/sdk";

// Client wrapper by necessity, not preference: LevelCanvas takes cellColors as
// a Map, which is not RSC-serializable — the (empty) Map must be constructed on
// the client. The 2.5s progressive trail sweep comes with LevelCanvas for free.
export function RunTrailCanvas({ room, trails }: { room: string; trails: CanvasTrail[] }) {
  return <LevelCanvas room={room} cellColors={new Map()} trails={trails} />;
}
