import { test, expect } from "@playwright/test";
import { assertNoHost, collectErrors, meaningfulConsoleErrors, attachErrorReport } from "./helpers";

// P0 smoke: the two judge-facing entry surfaces mount without crashing —
// `/` (playable game + copilot popover through the SDK) and `/dashboard`
// (the experiment registry). Deeper per-flow specs live alongside this one.

test.describe("smoke: game + popover mount at /", () => {
  test("renders the game canvas and the copilot launcher", async ({ page }, info) => {
    const errors = collectErrors(page);

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Playtest Swarm", level: 1 })).toBeVisible();

    // Phaser injects a <canvas> into the host once the scene boots.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

    // The SDK popover mounts as a launcher button before it is opened.
    const launcher = page.getByRole("button", { name: "Ask the playtest agent" });
    await expect(launcher).toBeVisible();

    // Opening it reveals the panel chrome (header + expand/close controls).
    await launcher.click();
    await expect(page.getByText("Playtest Swarm", { exact: true }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "expand" })).toBeVisible();
    await expect(page.getByRole("button", { name: "close" })).toBeVisible();

    await attachErrorReport(info, errors);
    expect(errors.pageErrors, `uncaught page errors:\n${errors.pageErrors.join("\n")}`).toEqual([]);
    expect(
      meaningfulConsoleErrors(errors.consoleErrors),
      `unexpected console errors:\n${meaningfulConsoleErrors(errors.consoleErrors).join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("smoke: dashboard registry", () => {
  test("renders the registry header, stack chips and experiments table", async ({ page }, info) => {
    const errors = collectErrors(page);

    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Experiment registry", level: 1 })).toBeVisible();

    // The provenance chip proves ClickHouse is live — but must never leak a host.
    const chip = page.getByText(/ClickHouse Cloud ·/);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/events from/);
    await expect(chip).toContainText(/\d+ms/);

    await expect(page.getByRole("heading", { name: "Nightly regression watch" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Experiments" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "experiment" })).toBeVisible();

    await attachErrorReport(info, errors);
    expect(errors.pageErrors, `uncaught page errors:\n${errors.pageErrors.join("\n")}`).toEqual([]);
  });

  test("drill-in reuses the chat's cards with truthful provenance", async ({ page }, info) => {
    const errors = collectErrors(page);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Experiment registry", level: 1 })).toBeVisible();

    // Skip rather than fail on a cold ClickHouse with no swarm data — this asserts
    // the drill-in flow, not that seed data exists.
    const experimentLinks = page.getByRole("cell").getByRole("link");
    test.skip((await experimentLinks.count()) === 0, "no experiments in ClickHouse yet");

    // Click the first experiment link into the drill-in. These are server-
    // rendered CH cards — no LLM — so the flow is deterministic.
    const firstExperiment = experimentLinks.first();
    const name = (await firstExperiment.textContent())?.trim() ?? "";
    await firstExperiment.click();

    await expect(page).toHaveURL(/\/dashboard\/.+/);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    // The same heatmap card the chat renders, with its live provenance.
    await expect(
      page.getByText(/game_heatmap \(AggregatingMergeTree MV\)/).first(),
    ).toBeVisible();

    await attachErrorReport(info, errors);
    expect(errors.pageErrors, `uncaught page errors:\n${errors.pageErrors.join("\n")}`).toEqual([]);
  });

  test("a two-variant experiment renders the before/after delta card", async ({ page }, info) => {
    const errors = collectErrors(page);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Experiment registry", level: 1 })).toBeVisible();

    // A registry row that lists two variants (comma in the variants cell) has a
    // baseline vs mutated comparison, so its drill-in renders the delta card.
    const twoVariantRow = page.getByRole("row").filter({ hasText: /, / });
    test.skip((await twoVariantRow.count()) === 0, "no two-variant experiment in ClickHouse yet");
    const link = twoVariantRow.first().getByRole("link").first();
    await link.click();

    await expect(page).toHaveURL(/\/dashboard\/.+/);
    // The delta card names the exact single-pass query it came from.
    await expect(page.getByText(/single-pass sumIf delta, no join/).first()).toBeVisible();
    await expect(page.getByText(/red = more deaths after change/)).toBeVisible();

    await attachErrorReport(info, errors);
    expect(errors.pageErrors, `uncaught page errors:\n${errors.pageErrors.join("\n")}`).toEqual([]);
  });

  test("never renders a ClickHouse host or credentials", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Experiment registry" })).toBeVisible();
    await assertNoHost(page);
  });
});
