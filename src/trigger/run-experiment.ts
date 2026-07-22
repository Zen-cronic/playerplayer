import { metadata, tags, task } from "@trigger.dev/sdk";
import { botRun, type BotRunPayload } from "./bot-run";
import { ARCHETYPES } from "../game/bot";
import type { Mutation } from "../game/mutate";

export interface RunExperimentPayload {
  experimentId: string;
  runsPerVariant: number;
  level?: string;
  /** The what-if under test; baseline always runs unmutated alongside. */
  mutations: Mutation[];
  seedBase?: string;
}

export interface VariantSummary {
  runs: number;
  deaths: number;
  failedRuns: number;
  totalEventRows: number;
}

// The swarm: fans out matched-seed bot-run children across both variants in
// one batch. The parent checkpoints while waiting, so a big swarm costs
// nothing to supervise.
export const runExperiment = task({
  id: "run-experiment",
  run: async (payload: RunExperimentPayload) => {
    const { experimentId, runsPerVariant, level, mutations, seedBase = "exp" } = payload;

    // Ops navigability + live progress in the Trigger.dev dashboard: the run is
    // findable by experiment tag, and children increment runsCompleted as they
    // finish (see bot-run), so a chat-approved swarm is observable mid-flight.
    await tags.add(`exp_${experimentId}`);
    metadata.set("runsTotal", 2 * runsPerVariant).set("runsCompleted", 0);

    // A run-scoped idempotency key per (variant, seed) means a retry of THIS
    // fan-out re-uses the existing child runs instead of re-triggering the whole
    // swarm and double-writing its telemetry. A raw string is run-scoped in
    // v4.3.1+, so a fresh experiment run still gets fresh children.
    const items: Array<{ payload: BotRunPayload; options: { idempotencyKey: string } }> = [];
    for (const [variant, variantMutations] of [
      ["baseline", undefined],
      ["mutated", mutations],
    ] as const) {
      for (let i = 0; i < runsPerVariant; i++) {
        const seed = `${seedBase}-${i}`;
        items.push({
          payload: {
            experimentId,
            variant,
            seed,
            archetype: ARCHETYPES[i % ARCHETYPES.length],
            level,
            mutations: variantMutations,
          },
          options: { idempotencyKey: `${experimentId}:${variant}:${seed}` },
        });
      }
    }

    const batchResult = await botRun.batchTriggerAndWait(items);

    const summary: Record<string, VariantSummary> = {};
    for (let i = 0; i < batchResult.runs.length; i++) {
      const variant = items[i].payload.variant;
      const s = (summary[variant] ??= { runs: 0, deaths: 0, failedRuns: 0, totalEventRows: 0 });
      const r = batchResult.runs[i];
      if (r.ok) {
        s.runs++;
        if (r.output.verdict === "lose") s.deaths++;
        s.totalEventRows += r.output.eventRows;
      } else {
        s.failedRuns++;
      }
    }

    return { experimentId, mutations, summary };
  },
});
