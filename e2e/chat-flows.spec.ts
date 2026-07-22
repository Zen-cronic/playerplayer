import { test, expect } from "@playwright/test";
import { collectErrors, attachErrorReport } from "./helpers";

// Live judged flows: these drive the real chat.agent() → tool → ClickHouse path
// against the running Trigger.dev worker, so they are slower than the smoke
// suite and need the dev worker + ClickHouse + Anthropic reachable. They are the
// flows a judge exercises, so the final gate set runs them.

test.describe("live: chat read renders a card from ClickHouse", () => {
  test("'where do runs die' renders a heatmap with truthful provenance and no host", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);

    await page.goto("/chat");
    await page.getByRole("button", { name: "Where do runs die on Level1?" }).click();

    // The heatmap card's provenance names the engine it read from — proof the
    // answer came from a live AggregatingMergeTree query, not a fixture.
    const provenance = page.getByText(/heatmap_cells \(AggregatingMergeTree MV\)/);
    await expect(provenance).toBeVisible({ timeout: 90_000 });
    await expect(provenance).toContainText(/\d+ bot runs/);
    await expect(provenance).toContainText(/\d+ms/);

    // The rendered card must never leak the connection.
    const card = page.locator("figure").filter({ hasText: "death heatmap" }).first();
    const cardText = (await card.innerText()).toLowerCase();
    expect(cardText).not.toContain("clickhouse.cloud");
    expect(cardText).not.toContain(":8443");

    await attachErrorReport(info, errors);
    expect(errors.pageErrors, `uncaught page errors:\n${errors.pageErrors.join("\n")}`).toEqual([]);
  });
});

test.describe("live: HITL approval gate pauses and resumes", () => {
  test("a what-if pauses on an approval card, and Deny resumes without spending compute", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);

    await page.goto("/chat");
    await page.getByRole("button", { name: /What if I move the slime/ }).click();

    // Pause: the durable run stops on the approval token before any compute.
    const approve = page.getByRole("button", { name: "Approve" });
    await expect(approve).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "Deny" })).toBeVisible();
    await expect(page.getByText(/Run \d+ bot playthroughs to test this\?/)).toBeVisible();

    // Resume via Deny — the swarm never runs, so this stays cheap and fast.
    await page.getByRole("button", { name: "Deny" }).click();
    await expect(approve).toBeHidden({ timeout: 45_000 });
    // The denial propagated through the durable run and it resumed a normal turn.
    await expect(page.getByText(/output-denied/).first()).toBeVisible({ timeout: 45_000 });

    await attachErrorReport(info, errors);
    expect(errors.pageErrors, `uncaught page errors:\n${errors.pageErrors.join("\n")}`).toEqual([]);
  });
});
