import { test, expect, type Page } from "@playwright/test";
import { collectErrors, meaningfulConsoleErrors, attachErrorReport, assertNoHost } from "./helpers";

// ClickHouse Arena: the CH-authoritative multiplayer grid game. These specs step
// the world explicitly (the /step route calls the same resolveTick the durable
// match-loop uses), so every assertion is deterministic with no sleeps. The solo
// flow (bots=0) fully controls player 1; the multiplayer flow shows several players
// in one match. The API-guard block locks the same-origin write surface.

// Send one intent for player 1 and advance one tick, synchronizing on the network so
// the input is durably registered before the tick resolves (no races, no sleeps).
async function moveAndStep(page: Page, key: string) {
  const inputDone = page.waitForResponse(
    (r) => r.url().includes("/api/arena/input") && r.request().method() === "POST",
  );
  await page.keyboard.press(key);
  await inputDone;
  const stepDone = page.waitForResponse((r) => r.url().includes("/api/arena/step"));
  await page.getByTestId("arena-step").click();
  await stepDone;
}

test.describe("arena: CH-authoritative multiplayer", () => {
  test("solo flow — move, coin pickup, wall clamp are resolved by ClickHouse", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.goto("/arena?humans=1&bots=0");

    // Player 1 starts at the top-left spawn of the demo arena.
    await expect(page.getByTestId("arena-player-1-cell")).toHaveText("1,1");
    await expect(page.getByTestId("arena-player-1-score")).toHaveText("0");

    // Three steps right reaches the coin at (4,1): normal moves, then a pickup.
    await moveAndStep(page, "ArrowRight");
    await expect(page.getByTestId("arena-player-1-cell")).toHaveText("2,1");
    await moveAndStep(page, "ArrowRight");
    await expect(page.getByTestId("arena-player-1-cell")).toHaveText("3,1");
    await moveAndStep(page, "ArrowRight");
    await expect(page.getByTestId("arena-player-1-cell")).toHaveText("4,1");
    await expect(page.getByTestId("arena-player-1-score")).toHaveText("1");

    // (4,0) is the border wall: ClickHouse clamps the move, the player holds.
    await moveAndStep(page, "ArrowUp");
    await expect(page.getByTestId("arena-player-1-cell")).toHaveText("4,1");

    // Provenance shows the engine, never the host.
    await expect(page.getByTestId("arena-provenance")).toContainText("ClickHouse");
    await expect(page.getByTestId("arena-provenance")).toContainText("match_state");
    await assertNoHost(page);

    expect(errors.pageErrors, "page crashed").toEqual([]);
    expect(meaningfulConsoleErrors(errors.consoleErrors)).toEqual([]);
    await attachErrorReport(info, errors);
  });

  test("multiplayer — several players share one CH-authoritative match", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.goto("/arena?humans=1&bots=3");

    // One human + three bots render as four players in a single match.
    for (const id of [1, 2, 3, 4]) {
      await expect(page.getByTestId(`arena-player-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("arena-status")).toContainText("tick 0");

    // Stepping advances the shared world (the Trigger loop does this on a timer in
    // production; here we step explicitly). The clock moves for everyone at once.
    const stepDone = page.waitForResponse((r) => r.url().includes("/api/arena/step"));
    await page.getByTestId("arena-step").click();
    await stepDone;
    await expect(page.getByTestId("arena-status")).toContainText("tick 1");

    await assertNoHost(page);
    expect(errors.pageErrors, "page crashed").toEqual([]);
    await attachErrorReport(info, errors);
  });
});

test.describe("api: /api/arena/* is a strict, same-origin write surface", () => {
  const MATCH = { matchId: "arena-does-not-exist" };

  test("step rejects a missing Origin (non-browser) with 403", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/arena/step`, { data: MATCH });
    expect(res.status()).toBe(403);
  });

  test("input rejects a cross-origin request with 403", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/arena/input`, {
      headers: { origin: "http://evil.example.com" },
      data: { matchId: "arena-x", playerId: 1, intent: "up" },
    });
    expect(res.status()).toBe(403);
  });

  test("start with an invalid payload is 400 (passes origin, fails zod)", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/arena/start`, {
      headers: { origin: baseURL! },
      data: { humans: 99 },
    });
    expect(res.status()).toBe(400);
  });

  test("input rejects an out-of-enum intent (400)", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/arena/input`, {
      headers: { origin: baseURL! },
      data: { matchId: "arena-x", playerId: 1, intent: "teleport" },
    });
    expect(res.status()).toBe(400);
  });
});
