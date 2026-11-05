import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@jig/executor", () => {
  it("is wired into the workspace", () => {
    expect(packageName).toBe("@jig/executor");
  });
});
