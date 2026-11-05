import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@jig/extraction", () => {
  it("is wired into the workspace", () => {
    expect(packageName).toBe("@jig/extraction");
  });
});
