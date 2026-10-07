import { describe, expect, it } from "vitest";
import { formatReminder } from "@/lib/format";

describe("formatReminder", () => {
  const now = new Date(2026, 9, 7, 16, 0).getTime();

  it("shows only the time today", () => {
    expect(formatReminder(new Date(2026, 9, 7, 18, 30).getTime(), now, "fr")).toBe("18:30");
  });

  it("says tomorrow in the user's language", () => {
    const at = new Date(2026, 9, 8, 9, 0).getTime();
    expect(formatReminder(at, now, "fr")).toBe("demain 09:00");
    expect(formatReminder(at, now, "en")).toBe("tomorrow 09:00");
  });

  it("falls back to the full date further away", () => {
    expect(formatReminder(new Date(2026, 9, 14, 9, 0).getTime(), now, "fr")).toMatch(/14 oct\..*09:00/);
  });
});
