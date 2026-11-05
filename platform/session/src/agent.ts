import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { TOOLS, createKbMcpServer, type KbOperations, type ToolName } from "@jig/kb-ops";
import { AGENT_INSTRUCTIONS } from "./instructions";
import type { PendingApproval, ViewSpec } from "./protocol";
import type { AgentDriver, Session } from "./session";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const MCP_SERVER_NAME = "jig-kb";

/** The agent's tool names as the Agent SDK exposes them. */
export const AGENT_TOOL_NAMES = (Object.keys(TOOLS) as ToolName[]).map((n) => `mcp__${MCP_SERVER_NAME}__${n}`);

/**
 * KB operations as the session agent sees them: the same operations, called as the signed-in user
 * through an agent, with views and approval cards also shown on the person's screen.
 */
export function sessionOperations(session: Session): KbOperations {
  const service = session.service;
  return {
    query: (p, i) => service.query(p, i),
    visualize: async (p, i) => {
      const spec = await service.visualize(p, i);
      session.showView(spec as unknown as ViewSpec, i);
      return spec;
    },
    propose_delta: (p, i) => service.propose_delta(p, i),
    analyze_impact: (p, i) => service.analyze_impact(p, i),
    simulate: (p, i) => service.simulate(p, i),
    act: async (p, i) => {
      const result = await service.act(p, i);
      if (result.status === "queued") {
        const action = (await service.query(p, { focus: i.action, depth: 0 })).nodes[0];
        const card: PendingApproval = {
          view_id: `card-${result.request_id}`,
          request_id: result.request_id,
          action: i.action,
          title: action?.title ?? i.action,
          inputs: i.inputs,
          facts: result.facts,
          reasons: result.decision.reasons.map((r) => ({ source: r.source, kind: r.kind, level: r.level, reason: r.reason, ...(r.statement ? { statement: r.statement } : {}) })),
          requested_by: `${session.user.title} (through the agent)`,
        };
        session.showApproval(card);
      }
      return result;
    },
    approve: (p, i) => service.approve(p, i),
  };
}

/** Agent SDK options for a session: only the KB tools, no built-in tools, no local settings. */
export function agentOptions(session: Session, model = process.env.JIG_AGENT_MODEL ?? DEFAULT_MODEL): Options {
  const server = createKbMcpServer(sessionOperations(session), session.agentPrincipal);
  return {
    model,
    systemPrompt: AGENT_INSTRUCTIONS,
    tools: [],
    allowedTools: AGENT_TOOL_NAMES,
    mcpServers: { [MCP_SERVER_NAME]: { type: "sdk", name: MCP_SERVER_NAME, instance: server } },
    settingSources: [],
    cwd: mkdtempSync(join(tmpdir(), "jig-agent-")),
    maxTurns: 20,
  };
}

/** The prompt for one turn: what is on screen, then the person's message or event. */
export function turnPrompt(session: Session, input: string): string {
  return `[screen]\n${session.workingSet.describe()}\n[signed in] ${session.user.title} (${session.user.user})\n\n${input}`;
}

/** Runs the session agent on the Claude Agent SDK. Needs ANTHROPIC_API_KEY (or another configured provider). */
export class ClaudeAgentDriver implements AgentDriver {
  private sessionId: string | undefined;
  private principalUser: string;

  constructor(private readonly session: Session) {
    this.principalUser = session.user.user;
  }

  async *respond(input: string, session: Session): AsyncIterable<string> {
    // A role switch starts a fresh agent conversation under the new user's permissions.
    if (session.user.user !== this.principalUser) {
      this.principalUser = session.user.user;
      this.sessionId = undefined;
    }
    const options = agentOptions(session);
    if (this.sessionId) options.resume = this.sessionId;
    for await (const message of query({ prompt: turnPrompt(session, input), options })) {
      if (message.type === "system" && "session_id" in message && typeof message.session_id === "string") this.sessionId = message.session_id;
      if (message.type === "assistant") {
        for (const block of message.message.content) if (block.type === "text" && block.text) yield block.text;
      }
      if (message.type === "result" && message.subtype !== "success") yield `\n(The agent stopped: ${message.subtype}.)`;
    }
  }
}

/** Whether a model provider is configured for the Agent SDK. */
export function agentAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX || process.env.CLAUDE_CODE_USE_FOUNDRY);
}

export const claudeAgent = (session: Session): AgentDriver => new ClaudeAgentDriver(session);
