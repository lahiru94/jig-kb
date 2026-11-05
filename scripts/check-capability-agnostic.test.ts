import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findViolations } from "./check-capability-agnostic";

const terms = ["refund", "cancellation"];
let root: string;

function makeRoot(source: string): string {
  root = mkdtempSync(join(tmpdir(), "jig-lint-"));
  mkdirSync(join(root, "platform", "executor", "src"), { recursive: true });
  mkdirSync(join(root, "platform", "executor", "test"), { recursive: true });
  writeFileSync(join(root, "platform", "executor", "src", "index.ts"), source);
  writeFileSync(join(root, "platform", "executor", "test", "fixture.test.ts"), "const refundFixture = 1;\n");
  return root;
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("capability-agnostic check", () => {
  it("fails on a planted capability identifier in platform source", () => {
    const violations = findViolations(makeRoot("export function issueRefund() {}\n"), terms);
    expect(violations).toEqual([
      { file: join("platform", "executor", "src", "index.ts"), line: 1, term: "refund", text: "export function issueRefund() {}" },
    ]);
  });

  it("passes once the identifier is removed, and ignores tests", () => {
    expect(findViolations(makeRoot("export function executeAction() {}\n"), terms)).toEqual([]);
  });
});
