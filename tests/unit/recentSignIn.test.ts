import { describe, expect, it } from "vitest";
import { codeIsRecent, codeSignInAt, RECENT_CODE_MS } from "@/lib/server/recentSignIn";

const NOW = 1_800_000_000_000;
const seconds = (ms: number) => Math.floor(ms / 1000);

describe("the code typed before deleting an account", () => {
  it("is the last time the session was opened by an e-mail code", () => {
    expect(codeSignInAt({ amr: [{ method: "otp", timestamp: 100 }, { method: "magiclink", timestamp: 300 }, { method: "otp", timestamp: 200 }] })).toBe(300_000);
  });

  it("is not read from a password, a refresh or anything unknown", () => {
    expect(codeSignInAt({ amr: [{ method: "password", timestamp: 100 }, { method: "token_refresh", timestamp: 200 }, { method: "oauth", timestamp: 300 }] })).toBeNull();
    expect(codeSignInAt({ amr: [{ method: "otp" }, { timestamp: 5 }, null, "otp", { method: "otp", timestamp: "5" }, { method: "otp", timestamp: Number.NaN }] })).toBeNull();
    expect(codeSignInAt({})).toBeNull();
    expect(codeSignInAt({ amr: "otp" })).toBeNull();
    expect(codeSignInAt(null)).toBeNull();
  });

  it("counts for five minutes", () => {
    const at = (ago: number) => ({ amr: [{ method: "otp", timestamp: seconds(NOW - ago) }] });
    expect(codeIsRecent(at(10_000), NOW)).toBe(true);
    expect(codeIsRecent(at(RECENT_CODE_MS - 1000), NOW)).toBe(true);
    expect(codeIsRecent(at(RECENT_CODE_MS + 5000), NOW)).toBe(false);
    expect(codeIsRecent(at(60 * 60_000), NOW)).toBe(false);
  });

  it("forgives a little clock skew, not a time far in the future", () => {
    expect(codeIsRecent({ amr: [{ method: "otp", timestamp: seconds(NOW + 20_000) }] }, NOW)).toBe(true);
    expect(codeIsRecent({ amr: [{ method: "otp", timestamp: seconds(NOW + 3_600_000) }] }, NOW)).toBe(false);
  });

  it("is refused for a session opened by another way, even a fresh one", () => {
    expect(codeIsRecent({ amr: [{ method: "password", timestamp: seconds(NOW) }] }, NOW)).toBe(false);
    expect(codeIsRecent({}, NOW)).toBe(false);
  });
});
