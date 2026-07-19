import { task } from "@trigger.dev/sdk";
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

    const items: Array<{ payload: BotRunPayload }> = [];
    for (const [variant, variantMutations] of [
      ["baseline", undefined],
      ["mutated", mutations],
    ] as const) {
      for (let i = 0; i < runsPerVariant; i++) {
        items.push({
          payload: {
            experimentId,
            variant,
            seed: `${seedBase}-${i}`,
            archetype: ARCHETYPES[i % ARCHETYPES.length],
            level,
            mutations: variantMutations,
          },
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
