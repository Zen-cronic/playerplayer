import { queue } from "@trigger.dev/sdk";

// Two dedicated lanes instead of one shared queue, budgeted against the free
// plan's 10 concurrent runs: 6 swarm + 3 live + 1 streaming chat turn = 10.
// Parents checkpoint during batchTriggerAndWait so they hold no slot while
// waiting. The split guarantees the judge-visible live demo keeps moving while
// a chat-approved swarm runs — and vice versa — instead of the two interleaving
// on one starved lane.

// Swarm lane: chat-approved experiments + the nightly canary.
export const swarmQueue = queue({ name: "swarm-bots", concurrencyLimit: 6 });

// Live lane: paced streaming bots for the live-ops demo.
export const liveQueue = queue({ name: "live-bots", concurrencyLimit: 3 });
