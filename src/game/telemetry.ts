export type TelemetryEventType =
  | "run_start"
  | "pos"
  | "damage"
  | "heal"
  | "death"
  | "pickup_coin"
  | "room_enter"
  | "run_end";

export interface TelemetryEvent {
  t: number;
  type: TelemetryEventType;
  x: number;
  y: number;
  room: string;
  health: number;
  coins: number;
  detail: string;
}

export class TelemetryBuffer {
  readonly events: TelemetryEvent[] = [];

  add(event: TelemetryEvent): void {
    this.events.push(event);
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.events) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  }
}
