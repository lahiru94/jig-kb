import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS, type ToolInput, type ToolName, type ToolOutput } from "./tools";
import { OperationError, type Principal } from "./types";

/** The operations behind the MCP tools. `KbService` implements this. */
export type KbOperations = {
  [N in ToolName]: (principal: Principal, input: ToolInput<N>) => Promise<ToolOutput<N>>;
};

/**
 * Creates an MCP server exposing the KB operations to one principal: the logged-in user,
 * with an agent acting for them. Every call goes through `ops`, which applies guardrails.
 */
export function createKbMcpServer(ops: KbOperations, principal: Principal): McpServer {
  const server = new McpServer({ name: "jig-kb", version: "0.1.0" });
  for (const name of Object.keys(TOOLS) as ToolName[]) {
    const tool = TOOLS[name];
    server.registerTool(
      name,
      { title: tool.title, description: tool.description, inputSchema: tool.input, outputSchema: tool.output },
      (async (input: unknown) => {
        try {
          const handler = ops[name] as (p: Principal, i: unknown) => Promise<Record<string, unknown>>;
          const result = await handler(principal, input);
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          if (error instanceof OperationError) {
            const payload = { error: { code: error.code, message: error.message, ...error.details } };
            return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
          }
          throw error;
        }
      }) as never,
    );
  }
  return server;
}
