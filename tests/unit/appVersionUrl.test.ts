import { describe, expect, it } from "vitest";
import { AppVersionConfigSchema, isReleaseUrl } from "@/lib/server/appVersionStore";

describe("APK download link", () => {
  it("accepts the project's releases and an empty link", () => {
    expect(isReleaseUrl("")).toBe(true);
    expect(isReleaseUrl("https://github.com/Mahery-Rakotonindrina/Assisteo-Agny/releases/latest/download/AssisteoAgny.apk")).toBe(true);
  });

  it("refuses any other address", () => {
    expect(isReleaseUrl("https://evil.example/Mahery-Rakotonindrina/Assisteo-Agny/releases/x.apk")).toBe(false);
    expect(isReleaseUrl("https://github.com/Someone/Assisteo-Agny/releases/latest/download/a.apk")).toBe(false);
    expect(isReleaseUrl("http://github.com/Mahery-Rakotonindrina/Assisteo-Agny/releases/x")).toBe(false);
    expect(isReleaseUrl("https://github.com/Mahery-Rakotonindrina/Assisteo-Agny/releases/../../../evil")).toBe(false);
    expect(AppVersionConfigSchema.safeParse({ minimum: "", latest: "", downloadUrl: "https://example.com/a.apk" }).success).toBe(false);
  });
});
