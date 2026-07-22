import { test, expect } from "@playwright/test";
import { assertNoHost, collectErrors, attachErrorReport } from "./helpers";

// The consolidated dashboard modules: runs explorer, agent log, live ops.
// Smoke-level by design (deep flows are covered by chat-flows/smoke): each page
// mounts, shows its key elements, and never leaks a ClickHouse host.
// Data-dependent drill-ins skip on empty tables rather than fail.

test.describe("dashboard modules: runs explorer", () => {
  test("runs list renders with filters and rows", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.goto("/dashboard/runs");
    await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "run", exact: true })).toBeVisible();
    // Filter chip rows exist (archetype row's "rusher" chip stands in for all).
    await expect(page.getByRole("link", { name: "rusher", exact: true })).toBeVisible();
    await assertNoHost(page);
    await attachErrorReport(info, errors);
    expect(errors.pageErrors).toEqual([]);
  });

  test("run drill-in replays the trail and timeline", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.goto("/dashboard/runs");
    const firstRun = page.locator('a[href^="/dashboard/runs/"]').first();
    test.skip((await firstRun.count()) === 0, "no runs recorded yet");
    await firstRun.click();
    await expect(page).toHaveURL(/\/dashboard\/runs\/.+/);
    await expect(page.getByRole("heading", { name: "Ghost trail" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Event timeline" })).toBeVisible();
    // The LevelCanvas mounted (trail replay) — canvas presence is the signal.
    await expect(page.locator("canvas").first()).toBeVisible();
    await assertNoHost(page);
    await attachErrorReport(info, errors);
    expect(errors.pageErrors).toEqual([]);
  });
});

test.describe("dashboard modules: agent log", () => {
  test("session list renders", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.goto("/dashboard/agent");
    await expect(page.getByRole("heading", { name: "Agent log" })).toBeVisible();
    // Either sessions exist (table) or the empty state shows — both are valid.
    const table = page.getByRole("columnheader", { name: "session" });
    const empty = page.getByText(/No agent sessions logged yet/);
    await expect(table.or(empty).first()).toBeVisible();
    await assertNoHost(page);
    await attachErrorReport(info, errors);
    expect(errors.pageErrors).toEqual([]);
  });

  test("session drill-in shows the kind-badged timeline", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.goto("/dashboard/agent");
    const firstSession = page.locator('a[href^="/dashboard/agent/"]').first();
    test.skip((await firstSession.count()) === 0, "no agent sessions logged yet");
    await firstSession.click();
    await expect(page).toHaveURL(/\/dashboard\/agent\/.+/);
    await expect(page.getByRole("heading", { name: "Turn timeline" })).toBeVisible();
    await expect(page.getByText("tool_call").first()).toBeVisible();
    await assertNoHost(page);
    await attachErrorReport(info, errors);
    expect(errors.pageErrors).toEqual([]);
  });
});

test.describe("dashboard modules: live ops", () => {
  test("live panel renders its metrics and launch control", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.goto("/dashboard/live");
    // Assert LABELS, never values — the poller fills values asynchronously.
    for (const label of ["Events / sec", "Active runs", "Wave events", "Wave runs"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // The launch button exists; NEVER click it here — every e2e pass would
    // spend an 18-run wave of free-plan compute.
    await expect(page.getByRole("button", { name: /launch live swarm|wave in flight/ })).toBeVisible();
    await assertNoHost(page);
    await attachErrorReport(info, errors);
    expect(errors.pageErrors).toEqual([]);
  });
});

test.describe("dashboard modules: no-host sweep", () => {
  test("no dashboard route ever renders a ClickHouse host", async ({ page }) => {
    for (const route of ["/dashboard", "/dashboard/runs", "/dashboard/agent", "/dashboard/live"]) {
      await page.goto(route);
      await expect(page.getByText("Telemetry command center").first()).toBeVisible();
      await assertNoHost(page);
    }
  });
});
