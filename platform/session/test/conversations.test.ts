import { afterEach, describe, expect, it } from "vitest";
import { AGENT_INSTRUCTIONS, Session, agentAvailable, claudeAgent, type ServerMessage } from "../src/index";
import { USERS, startServer } from "./harness";

describe("agent instructions", () => {
  it("cover show-or-tell, citing the KB, missing facts and explaining decisions", () => {
    for (const phrase of [
      "Show a view with visualize when the answer involves relationships, more than five items, a comparison, or anything to approve",
      "Answer in text for a single fact",
      "cite the node it came from",
      "The KB has no record of that.",
      "explain which rule held it and why, in plain language",
      "You cannot approve anything.",
    ]) {
      expect(AGENT_INSTRUCTIONS).toContain(phrase);
    }
  });
});

// Scripted conversations against the real model. They need a configured provider (for example ANTHROPIC_API_KEY).
describe.skipIf(!agentAvailable())("scripted conversations (real model)", () => {
  let env: Awaited<ReturnType<typeof startServer>> | undefined;
  afterEach(async () => {
    await env?.close();
    env = undefined;
  });

  async function converse(text: string) {
    env = await startServer(claudeAgent);
    const messages: ServerMessage[] = [];
    const session = new Session({ id: "s1", service: env.service, users: USERS, user: USERS[0] as (typeof USERS)[number], send: (m) => messages.push(m), agent: claudeAgent });
    await session.handle({ type: "chat", text });
    const reply = messages.flatMap((m) => (m.type === "assistant" ? [m.text] : [])).join("");
    const views = messages.flatMap((m) => (m.type === "view" ? [m.spec] : []));
    return { reply, views, messages };
  }

  it("a relationship question shows a view", async () => {
    const { views, reply } = await converse("What depends on the refunds process?");
    expect(views.length).toBeGreaterThan(0);
    expect(reply.length).toBeGreaterThan(0);
  }, 180_000);

  it("a simple fact is answered in text with its source", async () => {
    const { reply, views } = await converse("Who owns the refund window rule?");
    expect(views).toHaveLength(0);
    expect(reply).toMatch(/head.of.(customer service|cs)/i);
    expect(reply).toContain("rule.refund-window");
  }, 180_000);

  it("a missing policy is reported as missing, with an offer to record a gap", async () => {
    const { reply } = await converse("What is our policy on refunds for pets?");
    expect(reply.toLowerCase()).toMatch(/no record|not in the kb|doesn't have|does not have/);
    expect(reply.toLowerCase()).toMatch(/gap|record it|add it/);
  }, 180_000);

  it("a blocked refund is explained: the rule, why, and the options", async () => {
    const { reply } = await converse("Refund $200 of order ord-00002 for the customer; one item was damaged.");
    expect(reply.toLowerCase()).toMatch(/rule|approval|loyalty|window|not been delivered|could not/);
  }, 180_000);
});
