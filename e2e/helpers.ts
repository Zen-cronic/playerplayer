import type { Page, TestInfo } from "@playwright/test";

// Uncaught exceptions (pageerror) mean the page actually crashed — those always
// fail a flow. console.error is noisier (transport retries, dev warnings), so we
// collect it separately and let each spec decide what, if anything, is fatal.
export interface PageErrors {
  pageErrors: string[];
  consoleErrors: string[];
}

export function collectErrors(page: Page): PageErrors {
  const store: PageErrors = { pageErrors: [], consoleErrors: [] };
  page.on("pageerror", (err) => store.pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") store.consoleErrors.push(msg.text());
  });
  return store;
}

// Console noise we tolerate: it comes from live services or the dev bundler, not
// from our UI logic. Anything else counts as a real console error.
const IGNORED_CONSOLE = [
  /favicon/i,
  /Failed to load resource/i,
  /ERR_/,
  /net::/,
  /websocket/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /Trigger\.dev/i,
];

export function meaningfulConsoleErrors(errors: string[]): string[] {
  return errors.filter((e) => !IGNORED_CONSOLE.some((re) => re.test(e)));
}

export async function attachErrorReport(info: TestInfo, errors: PageErrors) {
  if (errors.pageErrors.length || errors.consoleErrors.length) {
    await info.attach("browser-errors", {
      body: JSON.stringify(errors, null, 2),
      contentType: "application/json",
    });
  }
}
