import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/server/rateLimit";

// No Redis in unit tests: this exercises the in-memory fallback.
describe("rateLimit (memory)", () => {
  it("allows the limit, then refuses until the window resets", async () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);
    const refused = await rateLimit(key, 3, 60_000);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterS).toBeGreaterThan(0);
  });

  it("counts keys separately", async () => {
    expect((await rateLimit(`a:${Math.random()}`, 1, 60_000)).ok).toBe(true);
    expect((await rateLimit(`b:${Math.random()}`, 1, 60_000)).ok).toBe(true);
  });
});
