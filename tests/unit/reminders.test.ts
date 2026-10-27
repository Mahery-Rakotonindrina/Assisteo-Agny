import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import type { Analysis } from "@/lib/ai/schema";
import { makeRepeat, nextOccurrence, occurrence } from "@/lib/reminderRepeat";
import { arrivedAt, canSnooze, insuranceReminderAt } from "@/services/reminders";
import type { HistoryEntry } from "@/types/history";

const DAY = 86_400_000;

function insurance(expiresOn: string | null, isInsurance = true): Analysis {
  const base = mockAnalysis("document", "fr");
  return { ...base, document: { ...base.document!, expiresOn, isInsurance } };
}

describe("insuranceReminderAt", () => {
  const now = new Date(2026, 9, 7, 14, 0).getTime();

  it("fires at 9:00 five days before the expiry date", () => {
    const at = insuranceReminderAt(insurance("2026-10-19"), now);
    expect(at).toBe(new Date(2026, 9, 14, 9, 0).getTime());
  });

  it("fires right away when the notice day has passed but the policy is still valid", () => {
    const at = insuranceReminderAt(insurance("2026-10-09"), now);
    expect(at).toBe(now + 60_000);
  });

  it("does nothing for expired policies, other documents or missing dates", () => {
    expect(insuranceReminderAt(insurance("2026-10-01"), now)).toBeNull();
    expect(insuranceReminderAt(insurance("2026-12-01", false), now)).toBeNull();
    expect(insuranceReminderAt(insurance(null), now)).toBeNull();
    expect(insuranceReminderAt(insurance("19/10/2026"), now)).toBeNull();
  });

  it("still fires on the expiry day itself", () => {
    const at = insuranceReminderAt(insurance("2026-10-07"), now);
    expect(at).toBe(now + 60_000);
    expect(insuranceReminderAt(insurance("2026-10-06"), now + DAY)).toBeNull();
  });
});

describe("arrivedAt / canSnooze", () => {
  const now = new Date(2026, 9, 27, 14, 0).getTime();
  const entry = (patch: Partial<HistoryEntry>) => ({ id: "scan", createdAt: now - 30 * DAY, analysis: mockAnalysis("food", "fr"), ...patch }) as HistoryEntry;

  it("a one-off reminder that came less than a day ago (home card, even when it is the only one)", () => {
    expect(arrivedAt(entry({ reminderAt: now - 5 * 60_000 }), now)).toBe(now - 5 * 60_000);
    expect(canSnooze(entry({ reminderAt: now - 2 * DAY }), now)).toBe(false);
    expect(canSnooze(entry({ reminderAt: now + 60_000 }), now)).toBe(false);
    expect(canSnooze(entry({}), now)).toBe(false);
  });

  it("never the mandatory insurance reminder", () => {
    expect(canSnooze(entry({ analysis: insurance("2026-11-30"), reminderAt: now - 60_000 }), now)).toBe(false);
  });

  describe("a recurring reminder already moved on to next month", () => {
    const repeat = makeRepeat("monthly", new Date(2026, 7, 27, 9, 0).getTime());
    // Came five hours ago.
    const came = occurrence(repeat, 2);
    const now = came + 5 * 3_600_000;
    const next = nextOccurrence(repeat, now);

    it("offers the occurrence kept when this device moved it on", () => {
      expect(arrivedAt(entry({ reminderAt: next, reminderRepeat: repeat, reminderFiredAt: came }), now)).toBe(came);
    });

    it("finds the occurrence that came when the server moved it on", () => {
      expect(next).toBe(occurrence(repeat, 3));
      expect(arrivedAt(entry({ reminderAt: next, reminderRepeat: repeat }), now)).toBe(came);
      expect(canSnooze(entry({ reminderAt: next, reminderRepeat: repeat }), now + 2 * DAY)).toBe(false);
    });

    it("stops offering it once put off (the snooze moved only this occurrence)", () => {
      expect(canSnooze(entry({ reminderAt: now + 3_600_000, reminderRepeat: repeat }), now)).toBe(false);
    });

    it("nothing before the first occurrence", () => {
      const fresh = makeRepeat("monthly", now + DAY);
      expect(canSnooze(entry({ reminderAt: now + DAY, reminderRepeat: fresh }), now)).toBe(false);
    });
  });
});
