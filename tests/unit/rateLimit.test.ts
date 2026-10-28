import { describe, expect, it } from "vitest";
import { rateLimit, refundRateLimit } from "@/lib/server/rateLimit";

// No Redis in unit tests: this exercises the in-memory fallback.
describe("rateLimit (memory)", () => {
  it("allows the limit, then refuses until the window resets", async () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);
    const refused = await rateLimit(key, 3, 60_000);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterS).toBeGreaterThan(0);
  });

  it("gives back a use that failed", async () => {
    const key = `test:${Math.random()}`;
    expect((await rateLimit(key, 1, 60_000)).ok).toBe(true);
    await refundRateLimit(key, 60_000);
    expect((await rateLimit(key, 1, 60_000)).ok).toBe(true);
    expect((await rateLimit(key, 1, 60_000)).ok).toBe(false);
  });

  it("counts keys separately", async () => {
    expect((await rateLimit(`a:${Math.random()}`, 1, 60_000)).ok).toBe(true);
    expect((await rateLimit(`b:${Math.random()}`, 1, 60_000)).ok).toBe(true);
  });
});
