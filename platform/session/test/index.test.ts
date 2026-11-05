import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@jig/session", () => {
  it("is wired into the workspace", () => {
    expect(packageName).toBe("@jig/session");
  });
});
