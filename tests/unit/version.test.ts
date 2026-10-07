import { describe, expect, it } from "vitest";
import { compareVersions, updateState } from "@/lib/version";

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("1.0.9", "1.0.10")).toBe(-1);
  });
  it("treats missing parts as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("2", "1.9.9")).toBe(1);
  });
});

describe("updateState", () => {
  it("blocks below the minimum", () => {
    expect(updateState("1.0.4", { minimum: "1.0.5", latest: "1.0.9" })).toBe("required");
  });
  it("suggests an update below the latest", () => {
    expect(updateState("1.0.5", { minimum: "1.0.5", latest: "1.0.9" })).toBe("available");
  });
  it("does nothing when up to date or unset", () => {
    expect(updateState("1.0.9", { minimum: "1.0.5", latest: "1.0.9" })).toBe("ok");
    expect(updateState("0.1.0", { minimum: "", latest: "" })).toBe("ok");
  });
});
