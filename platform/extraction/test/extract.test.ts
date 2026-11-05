import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DirectoryKbSource, KbValidator, buildView, changeNode } from "@jig/kb-core";
import { afterAll, describe, expect, it } from "vitest";
import { extract, readSources, type ExtractionProgress } from "../src/index";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const SAMPLE_KB = join(REPO, "sample-org", "kb");
const validator = new KbValidator();
const returnsOnly = readSources(REPO, ["sample-org/services/returns"]);

describe("three-pass extraction", () => {
  it("drafts the refund window rule from the returns service with code line references", async () => {
    const result = await extract(returnsOnly, buildView("empty", []), validator);
    const window = result.candidates.find((c) => c.kind === "BusinessRule" && c.claims[0]?.source === "code:sample-org/services/returns/src/main.ts#L22-L23");
    expect(window).toMatchObject({ pass: "rules", title: 'windowDays: 45 when tier is "gold", otherwise 30' });
    expect(window?.claims).toEqual([{ says: 'windowDays: 45 when tier is "gold", otherwise 30', source: "code:sample-org/services/returns/src/main.ts#L22-L23", confidence: "inferred" }]);
    expect(window?.fields.implemented_by).toEqual(["component.returns-service"]);
    // Every claim cites an exact source, and nothing is marked verified.
    for (const c of result.candidates) for (const claim of c.claims) {
      expect(claim.source).toMatch(/^(code|doc):sample-org\//);
      expect(["inferred", "stated"]).toContain(claim.confidence);
    }
  });

  it("drafts components and fully typed data entities in the inventory pass", async () => {
    const result = await extract(returnsOnly, buildView("empty", []), validator);
    const entity = result.candidates.find((c) => c.id === "entity.refund");
    expect(entity?.fields).toMatchObject({ identity: ["refund_id"], part_of: ["component.returns-service"] });
    expect((entity?.fields.fields as Array<{ name: string; type: string }>).find((f) => f.name === "requested_at")?.type).toBe("timestamp");
    expect(result.candidates.some((c) => c.id === "component.returns-service" && c.kind === "Component")).toBe(true);
  });

  it("states rules from documents, cited by section, with confidence stated", async () => {
    const docs = readSources(REPO, ["sample-org/docs/policies"]);
    const result = await extract(docs, buildView("empty", []), validator);
    const eu = result.candidates.find((c) => c.claims[0]?.source === "doc:sample-org/docs/policies/refund-policy.md#4");
    expect(eu?.claims[0]?.confidence).toBe("stated");
    expect(String(eu?.fields.statement)).toContain("within 14 days");
  });

  it("reports progress as nodes are drafted", async () => {
    const progress: ExtractionProgress[] = [];
    await extract(returnsOnly, buildView("empty", []), validator, { onProgress: (p) => progress.push(p) });
    expect(progress.map((p) => p.pass)).toEqual(["inventory", "inventory", "rules", "rules", "documents", "documents"]);
    expect(progress.flatMap((p) => p.drafted).length).toBeGreaterThan(3);
  });

  it("produces a valid delta when the KB is empty", async () => {
    const files = readSources(REPO, ["sample-org/services", "sample-org/legacy-erp", "sample-org/docs"]);
    const result = await extract(files, buildView("empty", []), validator);
    expect(result.validation.errors).toEqual([]);
    expect(result.changes.every((c) => c.op === "add")).toBe(true);
  });
});

describe("extraction against an existing KB", () => {
  const dir = mkdtempSync(join(tmpdir(), "jig-extract-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("records the 45-day code claim as an open conflict with the 30-day policy claim, without overwriting it", async () => {
    cpSync(SAMPLE_KB, dir, { recursive: true });
    // Start from a KB that knows only the policy: drop the code claim and the conflict.
    const path = join(dir, "rules", "refund-window.md");
    const text = readFileSync(path, "utf8");
    const policyOnly = text
      .replace(/  - says: Gold members get 45 days, everyone else 30\n    source: [^\n]+\n    confidence: inferred\n/, "")
      .replace(/conflicts:\n  - about: refund window for Gold members\n    claims: \[0, 1\]\n    status: open\n/, "");
    writeFileSync(path, policyOnly);
    const source = new DirectoryKbSource(dir);
    const view = source.current();
    expect((view.index.get("rule.refund-window")?.data.claims as unknown[]).length).toBe(1);

    const result = await extract(returnsOnly, view, validator, { fileOf: (n) => readFileSync(join(dir, n.file), "utf8") });
    const change = result.changes.find((c) => c.id === "rule.refund-window");
    expect(change?.op).toBe("modify");
    const node = change ? changeNode(change) : undefined;
    if (!node || "message" in node) throw new Error("expected a parsed node");
    const claims = node.data.claims as Array<{ says: string; source: string; confidence: string }>;
    expect(claims[0]).toMatchObject({ source: "doc:sample-org/docs/policies/refund-policy.md#1", confidence: "stated" });
    expect(claims.some((c) => c.source === "code:sample-org/services/returns/src/main.ts#L22-L23" && c.confidence === "inferred")).toBe(true);
    const conflict = (node.data.conflicts as Array<{ claims: number[]; status: string }>)[0];
    expect(conflict?.status).toBe("open");
    expect(conflict?.claims[0]).toBe(0);
    expect(claims[conflict?.claims[1] ?? -1]?.says).toContain("45");
    // The statement from the policy is kept.
    expect(node.data.statement).toBe("Customers may request a refund within 30 days of delivery.");
    // The Cedar check in the body survives.
    expect(node.data.check).toContain("forbid");
    expect(result.validation.errors).toEqual([]);
  });
});
