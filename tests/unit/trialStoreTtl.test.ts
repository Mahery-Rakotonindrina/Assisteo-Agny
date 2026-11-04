import { describe, expect, it, vi } from "vitest";

// The trial counters on Redis: every count gives its key an end (EXPIRE NX), so a
// key written before the TTL existed gets one, and a running window keeps its own.

const calls = vi.hoisted(() => [] as unknown[][]);
const values = vi.hoisted(() => new Map<string, number>());

vi.mock("@/lib/server/redis", () => {
  const pipeline = () => {
    const queued: (() => number)[] = [];
    const chain = {
      incr(key: string) {
        queued.push(() => {
          values.set(key, (values.get(key) ?? 0) + 1);
          return values.get(key)!;
        });
        return chain;
      },
      expire(key: string, seconds: number, option?: string) {
        queued.push(() => {
          calls.push(["expire", key, seconds, option]);
          return 1;
        });
        return chain;
      },
      exec: async () => queued.map((run) => run()),
    };
    return chain;
  };
  return {
    redis: {
      pipeline,
      get: async (key: string) => values.get(key) ?? null,
      incr: async (key: string) => {
        values.set(key, (values.get(key) ?? 0) + 1);
        return values.get(key)!;
      },
      incrby: async (key: string, by: number) => {
        values.set(key, (values.get(key) ?? 0) + by);
        return values.get(key)!;
      },
      decr: async (key: string) => values.set(key, (values.get(key) ?? 0) - 1),
      set: async () => "OK",
    },
  };
});

const { reserveTrialScan } = await import("@/lib/server/trialStore");

describe("trial counters on Redis", () => {
  it("gives an end to an old install key, not only to a new one", async () => {
    // Written before the TTL existed: already counted, no end.
    values.set("trial:install:old-install", 2);
    expect(await reserveTrialScan({ installId: "old-install" }, "10.0.0.1")).toMatchObject({ used: 3 });
    expect(calls).toContainEqual(["expire", "trial:install:old-install", 400 * 24 * 3600, "NX"]);
    expect(calls).toContainEqual(["expire", "trial:ip:10.0.0.1", 30 * 24 * 3600, "NX"]);
  });
});
