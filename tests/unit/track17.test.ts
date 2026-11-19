import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Registering numbers with 17TRACK (each one is charged): what was registered
// is remembered batch by batch (in memory here, Redis on the server).

vi.mock("@/lib/server/redis", () => ({ redis: null }));
const { ensureRegistered, resetTrack17Memory, TRACK17_BATCH } = await import("@/lib/server/track17");

const numbers = Array.from({ length: TRACK17_BATCH + 1 }, (_, index) => `YT${String(index).padStart(8, "0")}`);
let batches: string[][];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  process.env.TRACK17_API_KEY = "test-key";
  resetTrack17Memory();
  batches = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.TRACK17_API_KEY;
});

/** 17TRACK accepting every number, except that the call number `failing` answers HTTP 500. */
function answer(failing: number | null) {
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const batch = (JSON.parse(init.body) as Array<{ number: string }>).map(({ number }) => number);
    batches.push(batch);
    if (batches.length === failing) return new Response("busy", { status: 500 });
    return new Response(JSON.stringify({ code: 0, data: { accepted: batch.map((number) => ({ number })), rejected: [] } }));
  });
}

const run = async (list: string[]) => {
  const result = ensureRegistered(list);
  // The pause between two batches (3 requests a second at most).
  await vi.runAllTimersAsync();
  return result;
};

describe("17TRACK registration", () => {
  it("keeps the batches that went through when a later one fails, and never registers them again", async () => {
    answer(2);
    const failed = ensureRegistered(numbers).catch((error: Error) => error);
    await vi.runAllTimersAsync();
    expect(String(await failed)).toMatch(/HTTP 500/);
    expect(batches.map((batch) => batch.length)).toEqual([TRACK17_BATCH, 1]);

    answer(null);
    batches = [];
    expect(await run(numbers)).toHaveLength(numbers.length);
    expect(batches).toEqual([[numbers[TRACK17_BATCH]]]);
  });

  it("counts a number already registered as tracked, and leaves a refused one alone", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            accepted: [],
            rejected: [
              { number: "OLD12345", error: { code: -18019901 } },
              { number: "BAD12345", error: { code: -18010012 } },
            ],
          },
        }),
      ),
    );
    expect(await run(["OLD12345", "BAD12345"])).toEqual(["OLD12345"]);
    answer(null);
    expect(await run(["OLD12345", "BAD12345"])).toEqual(["OLD12345"]);
    expect(batches).toEqual([]);
  });
});
