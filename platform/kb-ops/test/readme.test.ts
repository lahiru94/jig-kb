import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KbOperations, ToolName } from "../src/index";
import { governedService } from "./governed";
import { SAMPLE_KB } from "./helpers";

interface Example {
  tool: ToolName;
  input: Record<string, unknown>;
  principal: { user: string; viaAgent: boolean };
}

/** Reads the examples in the README: a `<!-- example: <actor> via agent|in person -->` line before a JSON block. */
function examples(): Example[] {
  const text = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
  return [...text.matchAll(/<!-- example: (\S+) (via agent|in person) -->\n```json\n([\s\S]*?)\n```/g)].map((m) => {
    const parsed = JSON.parse(m[3] ?? "{}") as { tool: ToolName; input: Record<string, unknown> };
    return { ...parsed, principal: { user: m[1] ?? "", viaAgent: m[2] === "via agent" } };
  });
}

let env: Awaited<ReturnType<typeof governedService>>;
beforeAll(async () => {
  env = await governedService();
  env.systems.addOrder({ order_id: "ord-1", total_cents: 80000 });
});
afterAll(() => env?.cleanup());

/** Fills the README's placeholders: `$file(path, from, to)`, `$delta` and `$request`. */
function fill(value: unknown, refs: { delta?: string; request?: string }): unknown {
  if (typeof value === "string") {
    const file = /^\$file\(([^,]+), ([^,]+), ([^)]+)\)$/.exec(value);
    if (file) return readFileSync(`${SAMPLE_KB}/${file[1]}`, "utf8").replace(file[2] ?? "", file[3] ?? "");
    if (value === "$delta") return refs.delta;
    if (value === "$request") return refs.request;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, refs));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, refs)]));
  return value;
}

describe("README examples", () => {
  it("documents every tool", () => {
    expect(examples().map((e) => e.tool).sort()).toEqual(["act", "analyze_impact", "approve", "propose_delta", "query", "simulate", "visualize"]);
  });

  it("runs each documented example call", async () => {
    const refs: { delta?: string; request?: string } = {};
    const ops = env.service as unknown as KbOperations;
    for (const example of examples()) {
      const call = ops[example.tool] as (p: Example["principal"], i: unknown) => Promise<Record<string, unknown>>;
      const result = await call(example.principal, fill(example.input, refs));
      if (example.tool === "propose_delta") refs.delta = String(result.delta_id);
      if (example.tool === "act") {
        expect(result.status).toBe("queued");
        refs.request = String(result.request_id);
      }
      if (example.tool === "approve") expect(result.status).toBe("executed");
      expect(result, example.tool).toBeTruthy();
    }
  });
});
