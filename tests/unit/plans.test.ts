import { describe, expect, it } from "vitest";
import { activePlan, hasFeature, isAdminPlan, periodEnd, type PaidPlanId, type PlanId } from "@/lib/plans";

const at = (day: string) => new Date(`${day}T12:00:00Z`).getTime();
const row = (plan: PaidPlanId, start: string, end: string | null) => ({
  plan,
  startsAt: new Date(at(start)).toISOString(),
  endsAt: end === null ? null : new Date(at(end)).toISOString(),
});

describe("active plan", () => {
  const now = at("2026-10-15");

  it("is free without a running subscription", () => {
    expect(activePlan([], now)).toEqual({ plan: "free", endsAt: null });
    expect(activePlan([row("lite", "2026-09-01", "2026-10-01")], now).plan).toBe("free");
    expect(activePlan([row("lite", "2026-11-01", "2026-12-01")], now).plan).toBe("free");
  });

  it("runs until the end, renewals without a gap included", () => {
    const rows = [row("lite", "2026-10-01", "2026-11-01"), row("lite", "2026-11-01", "2026-12-01"), row("lite", "2026-12-05", "2027-01-05")];
    expect(activePlan(rows, now)).toEqual({ plan: "lite", endsAt: at("2026-12-01") });
  });

  it("takes the highest plan running, and an offered access never ends", () => {
    expect(activePlan([row("lite", "2026-10-01", "2026-11-01"), row("pro", "2026-10-10", "2026-10-20")], now)).toEqual({ plan: "pro", endsAt: at("2026-10-20") });
    expect(activePlan([row("lite", "2026-10-01", "2026-11-01"), row("unlimited", "2026-10-01", null)], now)).toEqual({ plan: "unlimited", endsAt: null });
  });

  it("does not let a lower plan extend a higher one", () => {
    const rows = [row("premium", "2026-10-01", "2026-10-20"), row("lite", "2026-10-20", "2026-11-20")];
    expect(activePlan(rows, now)).toEqual({ plan: "premium", endsAt: at("2026-10-20") });
  });
});

describe("plan features", () => {
  it("climbs the ladder", () => {
    expect(hasFeature("free", "ownKey")).toBe(false);
    expect(hasFeature("lite", "ownKey")).toBe(true);
    expect(hasFeature("premium", "reseller")).toBe(false);
    expect(hasFeature("pro", "reseller")).toBe(true);
    expect(hasFeature("unlimited", "reseller")).toBe(true);
  });

  it("makes only full access an administrator", () => {
    expect(isAdminPlan("unlimited")).toBe(true);
    expect(["free", "lite", "premium", "pro"].some((plan) => isAdminPlan(plan as PlanId))).toBe(false);
  });
});

describe("period end", () => {
  it("adds weeks and calendar months, or nothing", () => {
    const start = new Date(2026, 9, 8, 10);
    expect(periodEnd(start, "week")).toEqual(new Date(2026, 9, 15, 10));
    expect(periodEnd(start, "month")).toEqual(new Date(2026, 10, 8, 10));
    expect(periodEnd(start, "year")).toEqual(new Date(2027, 9, 8, 10));
    expect(periodEnd(start, "none")).toBeNull();
  });
});
