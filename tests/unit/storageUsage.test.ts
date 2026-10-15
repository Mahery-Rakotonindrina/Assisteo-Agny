import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { formatBytes } from "@/lib/format";
import type { QueuedScan } from "@/services/scanQueue";
import { summarizeStorage } from "@/services/storageUsage";
import type { HistoryEntry } from "@/types/history";

const photo = (length: number) => `data:image/jpeg;base64,${"A".repeat(length)}`;

const scan = (id: string, patch: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  createdAt: 1000,
  mode: "food",
  thumbnail: photo(20_000),
  preview: photo(150_000),
  analysis: mockAnalysis("food", "fr"),
  meta: { model: "demo", demo: true, durationMs: 1 },
  ...patch,
});

const image = { dataUrl: photo(1000), base64: "A".repeat(1000), mediaType: "image/jpeg" as const, width: 10, height: 10 };
const queued: QueuedScan = { id: "q", createdAt: 1, status: "waiting", mode: "auto", locale: "fr", first: { upload: image, preview: image, thumbnail: image }, pages: [], codes: [] };

describe("storage used", () => {
  it("counts photos apart from analyses, reduced photos once, deleted scans not at all", () => {
    const reduced = scan("b");
    reduced.preview = reduced.thumbnail;
    const usage = summarizeStorage({
      history: [scan("a", { pages: [photo(50_000)] }), reduced, scan("gone", { deletedAt: 5 })],
      parcels: [],
      lists: [{ id: "l", title: "Courses" }],
      queue: [queued],
      estimate: null,
    });
    // a: preview + thumbnail + page; b: the thumbnail alone (plus the data URL prefixes).
    expect(usage.photosBytes).toBe(photo(150_000).length + photo(20_000).length + photo(50_000).length + photo(20_000).length);
    expect(usage.scans).toBe(2);
    expect(usage.analysesBytes).toBeGreaterThan(1000);
    expect(usage.analysesBytes).toBeLessThan(usage.photosBytes);
    expect(usage.parcelsBytes).toBe(2);
    expect(usage.queued).toBe(1);
    expect(usage.queueBytes).toBeGreaterThan(6000);
    expect(usage.totalBytes).toBeNull();
  });

  it("takes the device's total, never below what it counted", () => {
    const base = { history: [scan("a")], parcels: [], lists: [], queue: [] };
    expect(summarizeStorage({ ...base, estimate: 50_000_000 }).totalBytes).toBe(50_000_000);
    expect(summarizeStorage({ ...base, estimate: 10 }).totalBytes).toBeGreaterThan(170_000);
  });

  it("writes sizes the French and English way", () => {
    expect(formatBytes(512 * 1024, "fr")).toBe("512 Ko");
    expect(formatBytes(24.34 * 1024 * 1024, "fr")).toMatch(/^24,3\sMo$/);
    expect(formatBytes(24.34 * 1024 * 1024, "en")).toBe("24.3 MB");
  });
});
