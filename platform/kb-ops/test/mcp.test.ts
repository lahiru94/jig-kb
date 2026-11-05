import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { OperationError, TOOLS, createKbMcpServer, type KbOperations } from "../src/index";

const notCalled = async (): Promise<never> => {
  throw new Error("not called in this test");
};

const stub: KbOperations = {
  query: async () => ({ nodes: [], links: [] }),
  visualize: notCalled,
  propose_delta: notCalled,
  analyze_impact: notCalled,
  simulate: notCalled,
  act: async () => {
    throw new OperationError("unknown_node", "no such action 'action.nope'", { id: "action.nope" });
  },
  approve: notCalled,
};

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createKbMcpServer(stub, { user: "actor.casey", viaAgent: true }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

describe("kb-ops MCP server", () => {
  it("lists every operation with its description and input and output schemas", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["act", "analyze_impact", "approve", "propose_delta", "query", "simulate", "visualize"]);
    for (const tool of tools) {
      expect(tool.description, tool.name).toBe(TOOLS[tool.name as keyof typeof TOOLS].description);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema?.type, tool.name).toBe("object");
    }
    const act = tools.find((t) => t.name === "act");
    expect(Object.keys(act?.inputSchema.properties ?? {})).toEqual(["action", "inputs"]);
    expect(act?.inputSchema.required).toEqual(["action", "inputs"]);
  });

  it("returns structured results", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "query", arguments: { text: "refund" } });
    expect(result.structuredContent).toEqual({ nodes: [], links: [] });
  });

  it("returns operation errors as structured tool errors", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "act", arguments: { action: "action.nope", inputs: {} } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text: string }>;
    expect(JSON.parse(content[0]?.text ?? "{}")).toEqual({ error: { code: "unknown_node", message: "no such action 'action.nope'", id: "action.nope" } });
  });

  it("rejects calls whose input does not match the schema", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "act", arguments: { action: 42 } });
    expect(result.isError).toBe(true);
  });
});
