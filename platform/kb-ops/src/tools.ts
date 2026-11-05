import { z } from "zod";

/**
 * Typed inputs and outputs of the KB operations exposed to agents over MCP (design D12, kb-operations spec).
 * Descriptions are written for the agent: they explain when to use each tool.
 */
const nodeId = z.string().describe("A KB node id in the form `<prefix>.<slug>`, for example `rule.order-limit`.");

const decision = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("1: allowed, 2: needs a human's approval, 3: forbidden."),
  reasons: z.array(
    z.object({
      source: z.string(),
      kind: z.enum(["rule", "policy", "permission", "floor", "default"]),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      reason: z.string(),
      statement: z.string().optional(),
    }),
  ),
});

const claim = z.object({ says: z.string(), source: z.string(), confidence: z.enum(["inferred", "stated", "verified"]) }).passthrough();

const queryNode = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  file: z.string(),
  data: z.record(z.string(), z.unknown()),
  claims: z.array(claim),
  conflicts: z.array(z.record(z.string(), z.unknown())),
  confidence: z.enum(["inferred", "stated", "verified", "none"]).describe("Lowest confidence among the node's claims."),
});

const link = z.object({ from: z.string(), to: z.string(), type: z.string(), path: z.string() });

const viewType = z.enum(["explorer", "process", "rule-card", "impact", "before-after"]);
const overlay = z.enum(["confidence", "conflicts", "ownership", "enforcement", "pending-delta"]);

const change = z.object({
  op: z.enum(["add", "modify", "remove"]),
  id: nodeId,
  content: z
    .string()
    .optional()
    .describe("Full Markdown file content (frontmatter and body) for add and modify. Omit for remove."),
});

export const TOOLS = {
  query: {
    title: "Query the knowledge base",
    description:
      "Find KB nodes: filter by kind and attributes, walk links from a focus node, or search text. " +
      "Every result includes its claims with sources and confidence. Use this before stating any fact about the organization.",
    input: {
      kind: z.union([z.string(), z.array(z.string())]).optional().describe("Node kind(s), for example BusinessRule."),
      attrs: z.record(z.string(), z.unknown()).optional().describe("Exact-match filters on frontmatter fields (snake_case)."),
      focus: nodeId.optional().describe("Start from this node and return its neighbourhood."),
      depth: z.number().int().min(0).max(5).optional().describe("How many links away from the focus to go (default 1)."),
      direction: z.enum(["out", "in", "both"]).optional(),
      link_types: z.array(z.string()).optional(),
      text: z.string().optional().describe("Free-text search over titles, statements, claims and bodies."),
      as_of: z.string().optional().describe("A KB version (commit) or delta id to read instead of the current KB."),
    },
    output: { nodes: z.array(queryNode), links: z.array(link) },
  },
  visualize: {
    title: "Show part of the knowledge base",
    description:
      "Render a view of a KB subset for the user. Use it when the answer involves relationships, more than five items, " +
      "a comparison, or anything the user must approve. Returns a view spec the user's screen renders.",
    input: {
      scope: z
        .object({
          focus: nodeId.optional(),
          depth: z.number().int().min(0).max(5).optional(),
          capability: nodeId.optional(),
          query: z.string().optional(),
          delta: z.string().optional(),
        })
        .describe("What to show: a focus node with depth, a capability, a text query, or a delta."),
      view: viewType,
      overlays: z.array(overlay).optional(),
      expand: z.array(z.string()).optional().describe("Ids of collapsed groups to show in full, for example after the user selects one."),
      as_of: z.string().optional(),
    },
    output: {
      view_id: z.string(),
      view: viewType,
      title: z.string(),
      elements: z.array(z.record(z.string(), z.unknown())),
      links: z.array(z.record(z.string(), z.unknown())),
      overlays: z.array(overlay),
      as_of: z.string(),
    },
  },
  propose_delta: {
    title: "Propose a change to the knowledge base",
    description:
      "Create or update a draft delta (a set of node additions, changes and removals). The main KB does not change. " +
      "Set `propose` to submit it for approval; it is validated first.",
    input: {
      delta_id: z.string().optional().describe("Update this existing draft instead of creating a new one."),
      title: z.string().optional(),
      rationale: z.string().optional(),
      changes: z.array(change).optional(),
      propose: z.boolean().optional().describe("Submit the draft for approval."),
    },
    output: {
      delta_id: z.string(),
      status: z.enum(["draft", "proposed", "approved", "rejected", "applied"]),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      errors: z.array(z.record(z.string(), z.unknown())),
      changed: z.array(z.string()),
    },
  },
  analyze_impact: {
    title: "Analyze the impact of a change",
    description: "List every node a delta could affect, with the link path from the change and a risk rank.",
    input: { delta_id: z.string() },
    output: {
      delta_id: z.string(),
      changed: z.array(z.string()),
      impacted: z.array(
        z.object({ id: z.string(), kind: z.string(), title: z.string(), path: z.array(z.string()), risk: z.number(), mode: z.string().optional() }),
      ),
    },
  },
  simulate: {
    title: "Replay past operations against a change",
    description: "Re-evaluate recorded past action requests against the KB as the delta would make it, and report how decisions would differ.",
    input: {
      delta_id: z.string(),
      window_days: z.number().int().min(1).max(365).optional().describe("How far back to replay (default 30)."),
    },
    output: {
      delta_id: z.string(),
      window: z.object({ from: z.string(), to: z.string() }),
      replayed: z.number(),
      changed: z.number(),
      insufficient_facts: z.number(),
      by_outcome: z.record(z.string(), z.number()),
      examples: z.array(z.record(z.string(), z.unknown())),
    },
  },
  act: {
    title: "Run a business action",
    description:
      "Request a business action defined in the KB. The KB checks every rule and permission first. " +
      "Level 1 runs now, level 2 is queued for a human, level 3 is refused. Explain the decision to the user.",
    input: { action: nodeId, inputs: z.record(z.string(), z.unknown()) },
    output: {
      request_id: z.string(),
      status: z.enum(["executed", "queued", "denied", "failed"]),
      decision,
      facts: z.record(z.string(), z.unknown()),
      steps: z.array(z.record(z.string(), z.unknown())),
    },
  },
  approve: {
    title: "Approve or reject a pending request",
    description: "Humans approve from a view. Agents cannot approve: calling this as an agent is always refused.",
    input: {
      request_id: z.string().describe("A queued action request id or a proposed delta id."),
      approve: z.boolean(),
      comment: z.string().optional(),
    },
    output: { request_id: z.string(), status: z.string(), decision: decision.optional() },
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolInput<N extends ToolName> = z.infer<z.ZodObject<(typeof TOOLS)[N]["input"]>>;
export type ToolOutput<N extends ToolName> = z.infer<z.ZodObject<(typeof TOOLS)[N]["output"]>>;
