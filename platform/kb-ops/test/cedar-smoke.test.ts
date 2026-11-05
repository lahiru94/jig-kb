import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { describe, expect, it } from "vitest";

// Smoke test for task 1.4: Cedar evaluates annotated permit/forbid policies,
// and the matched policies' annotations can be read back (design D7).
const policies: Record<string, string> = {
  "permit-small": `@rule("rule.example-limit")
@level("1")
@reason("Small operations are allowed.")
permit (principal, action == Action::"run", resource)
when { context.amount <= 500 };`,
  "forbid-large": `@rule("rule.example-limit")
@level("3")
@reason("Operations above 1000 are forbidden.")
forbid (principal, action == Action::"run", resource)
when { context.amount > 1000 };`,
};

function authorize(amount: number) {
  const answer = cedar.isAuthorized({
    principal: { type: "User", id: "u1" },
    action: { type: "Action", id: "run" },
    resource: { type: "Thing", id: "t1" },
    context: { amount },
    policies: { staticPolicies: policies },
    entities: [],
  });
  if (answer.type !== "success") throw new Error(JSON.stringify(answer.errors));
  return answer.response;
}

function annotationsOf(policyId: string): Record<string, string> {
  const text = policies[policyId];
  if (text === undefined) throw new Error(`unknown policy ${policyId}`);
  const parsed = cedar.policyToJson(text);
  if (parsed.type !== "success") throw new Error(JSON.stringify(parsed.errors));
  const annotations: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.json.annotations ?? {})) {
    if (typeof value === "string") annotations[key] = value;
  }
  return annotations;
}

describe("Cedar WASM smoke test", () => {
  it("permits via an annotated permit policy and reports it", () => {
    const response = authorize(200);
    expect(response.decision).toBe("allow");
    expect(response.diagnostics.reason).toEqual(["permit-small"]);
    expect(annotationsOf("permit-small")).toEqual({
      rule: "rule.example-limit",
      level: "1",
      reason: "Small operations are allowed.",
    });
  });

  it("denies via an annotated forbid policy and reports it", () => {
    const response = authorize(2000);
    expect(response.decision).toBe("deny");
    expect(response.diagnostics.reason).toEqual(["forbid-large"]);
    expect(annotationsOf("forbid-large").level).toBe("3");
  });

  it("denies by default when no policy matches", () => {
    const response = authorize(700);
    expect(response.decision).toBe("deny");
    expect(response.diagnostics.reason).toEqual([]);
  });
});
