import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import type { Analysis } from "@/lib/ai/schema";
import { insuranceReminderAt } from "@/services/reminders";

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
