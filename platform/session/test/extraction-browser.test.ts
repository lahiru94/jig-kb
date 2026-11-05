import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT, ensureWebBuilt, startServer } from "./harness";

let browser: Browser;
let env: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  ensureWebBuilt();
  env = await startServer(undefined, [], {
    base: REPO_ROOT,
    roots: ["sample-org/services/returns", "sample-org/services/loyalty", "sample-org/docs/policies"],
    paceMs: 700,
  });
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await env?.close();
});

describe("live extraction (browser)", () => {
  it("nodes appear in the explorer view while extraction runs", async () => {
    const page = await browser.newPage();
    await page.goto(env.url);
    await expect.poll(() => page.locator("[data-status]").getAttribute("data-status")).toBe("connected");
    await page.getByRole("button", { name: "Run extraction" }).click();

    const elements = page.locator(".view-explorer .element[data-kb-id]");
    await expect.poll(() => elements.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    const first = await elements.count();
    await expect.poll(() => page.locator(".progress").textContent(), { timeout: 15_000 }).toMatch(/Extraction finished: draft change delta-/);
    const last = await elements.count();
    expect(last).toBeGreaterThan(first);
    // The main KB did not change: the result is a draft delta.
    const drafts = env.store.list();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.status).toBe("draft");
    await page.close();
  }, 40_000);
});
