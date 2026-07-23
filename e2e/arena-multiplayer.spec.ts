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

    // ClickHouse-as-web-server: the snapshot is served by CH via FORMAT RawBLOB and
    // proxied same-origin. The host never appears; the proxy reports its source.
    const blobResp = page.waitForResponse((r) => r.url().includes("/api/arena/state-blob"));
    await page.getByTestId("arena-blob-btn").click();
    const resp = await blobResp;
    expect(resp.headers()["x-arena-source"]).toMatch(/^clickhouse-rawblob/);
    await expect(page.getByTestId("arena-blob")).toContainText("playerId");
    await expect(page.getByTestId("arena-blob-source")).toContainText("clickhouse-rawblob");

    await assertNoHost(page);
    expect(errors.pageErrors, "page crashed").toEqual([]);
    await attachErrorReport(info, errors);
  });

  test("two browsers share one match — real human-vs-human multiplayer", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    // p1 starts a 2-human, 0-bot match (deterministic) and controls player 1.
    await p1.goto("/arena?humans=2&bots=0");
    await expect(p1.getByTestId("arena-player-1-cell")).toHaveText("1,1");
    await expect(p1.getByTestId("arena-player-2")).toBeVisible();
    const matchId = (await p1.getByTestId("arena-match-id").innerText()).replace(/^match:\s*/, "").trim();

    // p2 joins the SAME match as player 2.
    await p2.goto(`/arena?match=${encodeURIComponent(matchId)}&as=2`);
    await expect(p2.getByTestId("arena-player-2-cell")).toHaveText("14,1");

    // Each browser submits its own player's intent, then p1 advances the shared world.
    const inputOn = (pg: Page) =>
      pg.waitForResponse((r) => r.url().includes("/api/arena/input") && r.request().method() === "POST");
    const i2 = inputOn(p2);
    await p2.keyboard.press("ArrowLeft"); // player 2 moves left
    await i2;
    const i1 = inputOn(p1);
    await p1.keyboard.press("ArrowDown"); // player 1 moves down
    await i1;
    const stepped = p1.waitForResponse((r) => r.url().includes("/api/arena/step"));
    await p1.getByTestId("arena-step").click();
    await stepped;

    // p1 sees both players resolved by ClickHouse; p2 sees it too via its sync poll.
    await expect(p1.getByTestId("arena-player-1-cell")).toHaveText("1,2");
    await expect(p1.getByTestId("arena-player-2-cell")).toHaveText("13,1");
    await expect(p2.getByTestId("arena-player-2-cell")).toHaveText("13,1");
    await expect(p2.getByTestId("arena-player-1-cell")).toHaveText("1,2");

    await assertNoHost(p1);
    await assertNoHost(p2);
    await ctx1.close();
    await ctx2.close();
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

  test("state-blob proxy rejects a missing Origin with 403", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/arena/state-blob`, { data: MATCH });
    expect(res.status()).toBe(403);
  });
});
