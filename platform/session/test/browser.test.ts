import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureWebBuilt, scriptedAgent, startServer } from "./harness";

let browser: Browser;
let env: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  ensureWebBuilt();
  env = await startServer(scriptedAgent(async (input) => `You said: ${input}`));
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await env?.close();
});

describe("web app shell (browser)", () => {
  it("loads, connects over the WebSocket and shows the chat and view panes", async () => {
    const page = await browser.newPage();
    await page.goto(env.url);
    await expect.poll(() => page.locator("[data-status]").getAttribute("data-status")).toBe("connected");
    expect(await page.getByRole("region", { name: "Conversation" }).isVisible()).toBe(true);
    expect(await page.getByRole("region", { name: "Views" }).isVisible()).toBe(true);
    expect(await page.getByLabel("Signed in as").inputValue()).toBe("actor.casey");

    await page.getByLabel("Message").fill("hello");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => page.locator(".line.assistant").first().textContent()).toBe("You said: hello");
    expect(env.server.sessions.size).toBe(1);
    await page.close();
  }, 30_000);
});
