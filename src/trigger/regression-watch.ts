import { metadata, schedules, tags } from "@trigger.dev/sdk";
import { botRun } from "./bot-run";
import { ARCHETYPES } from "../game/bot";
import { getClickHouse } from "../lib/clickhouse";
import { ensureMigrations } from "../lib/migrations";
import { heatmapDelta, runCounts } from "../lib/queries";

const NIGHTLY_EXPERIMENT = "nightly";
const RUNS_PER_NIGHT = 18;
const ROOM = "Level1";

// Deterministic canary: the SAME seeds play the level every night, so with an
// unchanged level the sweep reproduces itself and the delta is zero. Any
// night-over-night shift is a real balance change (a level edit), not noise.
export const regressionWatch = schedules.task({
  id: "regression-watch",
  cron: "0 3 * * *",
  run: async (payload) => {
    const date = payload.timestamp.toISOString().slice(0, 10);

    await ensureMigrations(getClickHouse());

    await tags.add(`exp_${NIGHTLY_EXPERIMENT}`);
    metadata.set("runsTotal", RUNS_PER_NIGHT).set("runsCompleted", 0);

    await botRun.batchTriggerAndWait(
      Array.from({ length: RUNS_PER_NIGHT }, (_, i) => ({
        payload: {
          experimentId: NIGHTLY_EXPERIMENT,
          variant: date,
          seed: `nightly-${i}`,
          archetype: ARCHETYPES[i % ARCHETYPES.length],
          level: ROOM,
        },
        // Idempotent per night: a retry of the schedule re-uses the same canary
        // runs instead of double-writing the date's telemetry, so the
        // night-over-night delta stays a true zero on an unchanged level.
        options: { idempotencyKey: `${NIGHTLY_EXPERIMENT}:${date}:nightly-${i}` },
      })),
    );

    const counts = await runCounts(NIGHTLY_EXPERIMENT);
    const prevDate = Object.keys(counts)
      .filter((d) => d < date)
      .sort()
      .pop();

    if (!prevDate) {
      return { date, verdict: "first-night", runs: counts[date] ?? 0 };
    }

    const cells = await heatmapDelta(NIGHTLY_EXPERIMENT, prevDate, date, ROOM);
    const runsPrev = Math.max(1, counts[prevDate] ?? 0);
    const runsNow = Math.max(1, counts[date] ?? 0);
    const deathsPrev = cells.reduce((s, c) => s + c.deathsA, 0);
    const deathsNow = cells.reduce((s, c) => s + c.deathsB, 0);
    const prevRate = deathsPrev / runsPrev;
    const nowRate = deathsNow / runsNow;
    const diffPp = (nowRate - prevRate) * 100;
    // Fixed seeds mean an unchanged level reproduces the same deaths per cell, so
    // "did this cell change" is an integer compare — no fragile float `!== 0` that
    // a differing run count (a failed run) could trip on identical death patterns.
    const cellsChanged = cells.filter((c) => c.deathsB !== c.deathsA).length;

    const verdict =
      Math.abs(diffPp) < 4 && cellsChanged === 0
        ? "stable"
        : Math.abs(diffPp) < 4
          ? "shifted"
          : diffPp < 0
            ? "easier"
            : "harder";

    await getClickHouse().insert({
      table: "watch_reports",
      values: [
        {
          date,
          prev_date: prevDate,
          room: ROOM,
          runs: runsNow,
          death_rate: nowRate,
          prev_death_rate: prevRate,
          verdict,
          cells_changed: cellsChanged,
        },
      ],
      format: "JSONEachRow",
      // Same insert settings as every other write path — this was the one bare
      // insert in the codebase.
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });

    return {
      date,
      prevDate,
      verdict,
      deathRate: nowRate,
      prevDeathRate: prevRate,
      cellsChanged,
      visualDiff: `queryDelta(experimentId: "${NIGHTLY_EXPERIMENT}", variantA: "${prevDate}", variantB: "${date}")`,
    };
  },
});
