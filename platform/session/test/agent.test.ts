import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, DEFAULT_MODEL, Session, agentAvailable, agentOptions, claudeAgent, sessionOperations, turnPrompt, type ServerMessage } from "../src/index";
import { USERS, startServer } from "./harness";

let env: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

async function makeSession(user = USERS[0]) {
  env = await startServer();
  const messages: ServerMessage[] = [];
  const session = new Session({ id: "s1", service: env.service, users: USERS, user: user as (typeof USERS)[number], send: (m) => messages.push(m) });
  return { session, messages, service: env.service };
}

describe("session agent configuration", () => {
  it("gives the agent only the kb-ops tools: no built-in tools, no local settings", async () => {
    const { session } = await makeSession();
    const options = agentOptions(session);
    expect(options.model).toBe(DEFAULT_MODEL);
    expect(options.tools).toEqual([]);
    expect(options.settingSources).toEqual([]);
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["jig-kb"]);
    expect(options.allowedTools).toEqual(AGENT_TOOL_NAMES);
    expect(AGENT_TOOL_NAMES.every((n) => n.startsWith("mcp__jig-kb__"))).toBe(true);

    // The MCP server behind those tools offers exactly the KB operations.
    const server = (options.mcpServers?.["jig-kb"] as { instance: McpServer }).instance;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => `mcp__jig-kb__${t.name}`).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("uses a configurable model", async () => {
    const { session } = await makeSession();
    expect(agentOptions(session, "claude-opus-5-5").model).toBe("claude-opus-5-5");
  });
});

describe("working set", () => {
  it("puts the views on screen and the selection into the agent's prompt", async () => {
    const { session } = await makeSession();
    const view = await session.visualize({ scope: { capability: "capability.returns" }, view: "process" });
    await session.handle({ type: "event", event: { action: "select", view_id: view.view_id, target: "rule.loyalty-clawback" } });
    const prompt = turnPrompt(session, "why does this exist?");
    expect(prompt).toContain(`View ${view.view_id} (process): "How Returns and refunds works"`);
    expect(prompt).toContain('The user has selected: rule.loyalty-clawback. "This" or "that" refers to it.');
    expect(prompt).toContain("[signed in] Casey (customer service agent) (actor.casey)");
    expect(prompt.endsWith("why does this exist?")).toBe(true);
  });
});

describe("the agent acts with the signed-in user's permissions, capped at requesting level 2", () => {
  it("an approver's approval from a view succeeds after switching from operator; the agent's own approve call is denied", async () => {
    const { session, messages, service } = await makeSession();
    const ops = sessionOperations(session);
    // As Casey (operator), the agent drafts and proposes a structural change; it waits for a person.
    const draft = await service.draftEdit(session.agentPrincipal, "component.legacy-erp", "mode", "connected");
    await ops.propose_delta(session.agentPrincipal, { delta_id: draft.delta_id, propose: true });

    // Switch to Alex, who may approve and apply it.
    await session.handle({ type: "switch-role", user: "actor.alex" });
    expect(session.user.user).toBe("actor.alex");
    expect(session.agentPrincipal).toEqual({ user: "actor.alex", viaAgent: true });

    // The agent, now acting for Alex, still cannot approve.
    await expect(ops.approve(session.agentPrincipal, { request_id: draft.delta_id, approve: true })).rejects.toThrow(/Agents cannot approve/);
    expect(service.deltaRecord(draft.delta_id)?.status).toBe("proposed");

    // Alex approves from the before/after view.
    const view = await session.visualize({ scope: { delta: draft.delta_id }, view: "before-after" });
    await session.handle({ type: "event", event: { action: "approve", view_id: view.view_id, target: draft.delta_id } });
    expect(service.deltaRecord(draft.delta_id)?.status).toBe("applied");
    expect(messages.some((m) => m.type === "notice" && m.text === `Approved ${draft.delta_id}: applied.`)).toBe(true);
    const approval = env?.audit.calls({ operation: "approve" }).at(-1);
    expect(approval).toMatchObject({ principal: "actor.alex", via_agent: false, outcome: "applied" });
  });
});

// These run the real model and need a configured provider (for example ANTHROPIC_API_KEY).
describe.skipIf(!agentAvailable())("session agent with the real model", () => {
  it("answers 'why does this exist?' about the selected rule", async () => {
    env = await startServer(claudeAgent);
    const messages: ServerMessage[] = [];
    const session = new Session({ id: "s1", service: env.service, users: USERS, user: USERS[0] as (typeof USERS)[number], send: (m) => messages.push(m), agent: claudeAgent });
    const view = await session.visualize({ scope: { capability: "capability.returns" }, view: "process" });
    await session.handle({ type: "event", event: { action: "select", view_id: view.view_id, target: "rule.loyalty-clawback" } });
    await session.handle({ type: "chat", text: "why does this exist?" });
    const reply = messages.flatMap((m) => (m.type === "assistant" ? [m.text] : [])).join("");
    expect(reply.toLowerCase()).toMatch(/clawback|loyalty points/);
    expect(reply).toContain("rule.loyalty-clawback");
  }, 180_000);
});
