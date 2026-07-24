import { test, expect } from "@playwright/test";
import { assertNoHost, collectErrors, meaningfulConsoleErrors, attachErrorReport } from "./helpers";

// P0 smoke: the two judge-facing entry surfaces mount without crashing —
// `/` (playable game + copilot popover through the SDK) and `/dashboard`
// (the experiment registry). Deeper per-flow specs live alongside this one.

test.describe("smoke: game + popover mount at /", () => {
  test("renders the game canvas and the copilot launcher", async ({ page }, info) => {
    const errors = collectErrors(page);

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "PlayerPlayer", level: 1 })).toBeVisible();

    // Judges can reach the live ClickHouse game directly from the landing-page
    // navigation without knowing its URL in advance.
    const arenaLink = page.getByRole("link", { name: "04 Arena" });
    await expect(arenaLink).toHaveAttribute("href", "/arena");
    await expect(arenaLink).toHaveClass(/is-featured/);
    await expect(arenaLink.getByText("Live")).toBeVisible();

    // Phaser injects a <canvas> into the host once the scene boots.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

    // The SDK popover mounts as a launcher button before it is opened.
    const launcher = page.getByRole("button", { name: "Ask the playtest agent" });
    await expect(launcher).toBeVisible();

    // Opening it reveals the panel chrome (header + expand/close controls).
    await launcher.click();
    await expect(page.getByText("PlayerPlayer", { exact: true }).last()).toBeVisible();
    const expand = page.getByRole("button", { name: "expand" });
    await expect(expand).toBeVisible();
    await expect(page.getByRole("button", { name: "close" })).toBeVisible();

    // Expanded controls must stay above the sticky app header. Clicking shrink
    // catches regressions where the button is technically visible but covered.
    await expand.click();
    const shrink = page.getByRole("button", { name: "shrink" });
    await expect(shrink).toBeVisible();
    await shrink.click();
    await expect(expand).toBeVisible();

    // Hold the session-start request so the submitted state stays visible long
    // enough to assert (and to capture clearly in the recorded regression flow)
    // without creating an external Trigger.dev run.
    await page.evaluate(() => {
      window.fetch = () => new Promise<Response>(() => undefined);
    });
    await page.getByRole("button", { name: "Where do runs die on Level1?" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Agent is thinking" }),
    ).toBeVisible();
    await expect(page.getByText("Starting a durable Trigger.dev turn")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await page.waitForTimeout(1_200);

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
