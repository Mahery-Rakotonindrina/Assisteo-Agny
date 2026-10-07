import { describe, expect, it } from "vitest";
import { getRecentFeedback, getStats, recordFeedback, track } from "@/lib/server/stats";

// No Redis in unit tests: the in-memory store.
describe("usage stats", () => {
  it("aggregates today's events and estimates devices without keeping ids", async () => {
    await track({ type: "scan", mode: "food", category: "food", ownKey: false, durationMs: 4000 }, "device-a");
    await track({ type: "scan", mode: "auto", category: "document", ownKey: true, durationMs: 6000 }, "device-b");
    await track({ type: "scan", mode: "food", category: "food", ownKey: false, durationMs: 2000 }, "device-a");
    await track({ type: "question", ownKey: false }, "device-a");
    await track({ type: "error", route: "analyze", code: "rate_limited" }, "device-c");
    await track({ type: "feedback", vote: "down", category: "food" });

    const [today] = await getStats(1);
    expect(today.devices).toBe(3);
    expect(today.counters).toMatchObject({
      scans: 3,
      "scans:mode:food": 2,
      "scans:category:document": 1,
      "scans:own": 1,
      "scans:server": 2,
      "scans:ms": 12000,
      questions: 1,
      "errors:analyze:rate_limited": 1,
      "feedback:down": 1,
    });
    expect(JSON.stringify(today)).not.toContain("device-a");
  });

  it("keeps the latest feedback first", async () => {
    const base = { category: "food", mode: "food", model: "demo", confidence: 0.9, title: "Salade" };
    await recordFeedback({ ...base, at: 1, vote: "up" });
    await recordFeedback({ ...base, at: 2, vote: "down", reason: "wrong_subject" });
    const [latest] = await getRecentFeedback(5);
    expect(latest).toMatchObject({ at: 2, vote: "down", reason: "wrong_subject" });
  });
});
