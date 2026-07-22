import { test, expect } from "@playwright/test";

// Locks in the guarantees on /api/ingest — the one browser-reachable write path.
// Only the rejection cases are asserted: a valid POST would insert a human run,
// and the ghost overlay reads the LATEST human run, so a test insert would
// pollute the demo. The happy path is covered by the game itself (the "N events
// sent" counter), verified during development.

const VALID_EVENT = {
  t: 0,
  type: "pos",
  x: 0,
  y: 0,
  room: "Level1",
  health: 4,
  coins: 0,
  detail: "",
};
const VALID_BODY = { runId: "human-e2e-00000000", events: [VALID_EVENT] };

test.describe("api: /api/ingest is a strict, fail-closed write surface", () => {
  test("rejects a missing Origin (non-browser client) with 403", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/ingest`, { data: VALID_BODY });
    expect(res.status()).toBe(403);
  });

  test("rejects a cross-origin request with 403", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/ingest`, {
      headers: { origin: "http://evil.example.com" },
      data: VALID_BODY,
    });
    expect(res.status()).toBe(403);
  });

  test("same-origin but invalid payload is 400 (passes origin, fails zod)", async ({
    request,
    baseURL,
  }) => {
    const res = await request.post(`${baseURL}/api/ingest`, {
      headers: { origin: baseURL! },
      data: { bogus: true },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects a runId that doesn't carry the human- prefix", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/ingest`, {
      headers: { origin: baseURL! },
      data: { runId: "swarm-injected-0", events: [VALID_EVENT] },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects an oversized event batch (size cap)", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/ingest`, {
      headers: { origin: baseURL! },
      data: { runId: "human-e2e-00000000", events: Array(501).fill(VALID_EVENT) },
    });
    expect(res.status()).toBe(400);
  });
});
