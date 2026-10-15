import { describe, expect, it } from "vitest";
import {
  accessPeriod,
  CODE_PATTERN,
  DAY_MS,
  defaultYearPrice,
  discountedPrice,
  hasPaid,
  monthsFree,
  normalizeCode,
  promoProblem,
  referralCodeFor,
  referralReward,
  suggestedAmount,
  trialEligible,
} from "@/lib/offers";
import { defaultPlansConfig, periodEnd, type PaidPlanId } from "@/lib/plans";
import { mergeOffer } from "@/lib/server/planConfig";

const at = (day: string) => new Date(`${day}T12:00:00Z`).getTime();
const row = (plan: PaidPlanId, start: string, end: string | null) => ({
  plan,
  startsAt: new Date(at(start)).toISOString(),
  endsAt: end === null ? null : new Date(at(end)).toISOString(),
});

describe("yearly price", () => {
  it("defaults to ten months: two offered", () => {
    expect(defaultYearPrice(5000)).toBe(50000);
    expect(monthsFree({ priceMga: 5000, yearPriceMga: 50000 })).toBe(2);
    expect(monthsFree(defaultPlansConfig.offers.premium)).toBe(2);
  });

  it("counts whole months only, never below 0", () => {
    expect(monthsFree({ priceMga: 15000, yearPriceMga: 160000 })).toBe(1);
    expect(monthsFree({ priceMga: 5000, yearPriceMga: 60000 })).toBe(0);
    expect(monthsFree({ priceMga: 5000, yearPriceMga: 90000 })).toBe(0);
    expect(monthsFree({ priceMga: 0, yearPriceMga: 0 })).toBe(0);
  });

  it("is ten times the stored monthly price for a config saved before it existed", () => {
    expect(mergeOffer("lite", { priceMga: 6000, scans: 60 }).yearPriceMga).toBe(60000);
    expect(mergeOffer("lite", { priceMga: 6000, yearPriceMga: 55000 }).yearPriceMga).toBe(55000);
    expect(mergeOffer("pro", undefined)).toEqual(defaultPlansConfig.offers.pro);
  });
});

describe("Premium trial", () => {
  it("is open to an account that never had a trial nor Premium", () => {
    expect(trialEligible([])).toBe(true);
    expect(trialEligible([{ plan: "lite", paymentMethod: "mvola" }])).toBe(true);
  });

  it("is closed after a trial, or any Premium, Pro or admin plan", () => {
    expect(trialEligible([{ plan: "lite", paymentMethod: "trial" }])).toBe(false);
    expect(trialEligible([{ plan: "premium", paymentMethod: "promo" }])).toBe(false);
    expect(trialEligible([{ plan: "pro", paymentMethod: "mvola" }])).toBe(false);
    expect(trialEligible([{ plan: "unlimited", paymentMethod: null }])).toBe(false);
  });

  it("lasts the given days from now", () => {
    const now = at("2026-10-15");
    const period = accessPeriod(now, 7);
    expect(Date.parse(period.startsAt)).toBe(now);
    expect(Date.parse(period.endsAt)).toBe(now + 7 * DAY_MS);
  });
});

describe("promo codes", () => {
  const now = at("2026-10-15");
  const promo = { active: true, expiresAt: null, maxUses: 0 };

  it("are typed in any case, with stray spaces", () => {
    expect(normalizeCode("  noel 2026 ")).toBe("NOEL2026");
    expect(CODE_PATTERN.test("NOEL-2026")).toBe(true);
    expect(CODE_PATTERN.test("AB")).toBe(false);
    expect(CODE_PATTERN.test("NOËL")).toBe(false);
  });

  it("work while active, before their expiry and under their limit", () => {
    expect(promoProblem(promo, 1000, now)).toBeNull();
    expect(promoProblem({ ...promo, active: false }, 0, now)).toBe("inactive");
    expect(promoProblem({ ...promo, expiresAt: now }, 0, now)).toBe("expired");
    expect(promoProblem({ ...promo, expiresAt: now + 1 }, 0, now)).toBeNull();
    expect(promoProblem({ ...promo, maxUses: 10 }, 9, now)).toBeNull();
    expect(promoProblem({ ...promo, maxUses: 10 }, 10, now)).toBe("used_up");
  });

  it("take a percentage off, rounded to the ariary", () => {
    expect(discountedPrice(15000, 20)).toBe(12000);
    expect(discountedPrice(5000, 15)).toBe(4250);
    expect(discountedPrice(5000, 33)).toBe(3350);
    expect(discountedPrice(5000, 100)).toBe(0);
    expect(discountedPrice(5000, 150)).toBe(0);
  });

  it("suggest the yearly price, and the reduced price with a discount", () => {
    const offer = { priceMga: 15000, yearPriceMga: 150000 };
    expect(suggestedAmount(offer, "year", null)).toBe(150000);
    expect(suggestedAmount(offer, "month", null)).toBeNull();
    expect(suggestedAmount(offer, "year", 20)).toBe(120000);
    expect(suggestedAmount(offer, "month", 20)).toBe(12000);
    expect(suggestedAmount(offer, "quarter", 10)).toBe(40500);
    expect(suggestedAmount(offer, "week", 20)).toBeNull();
    expect(suggestedAmount(offer, "custom", 20)).toBeNull();
  });
});

describe("referral", () => {
  it("gives each account a short, stable code", () => {
    const id = "5b1f3c2e-8a4d-4c1b-9e7f-0123456789ab";
    expect(referralCodeFor(id)).toBe(referralCodeFor(id.toUpperCase()));
    expect(referralCodeFor(id)).toMatch(/^[2-9A-HJKMNP-Z]{7}$/);
    expect(CODE_PATTERN.test(referralCodeFor(id))).toBe(true);
    const codes = new Set(Array.from({ length: 2000 }, (_, index) => referralCodeFor(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)));
    expect(codes.size).toBe(2000);
  });

  it("is a payment once an amount above 0 was recorded", () => {
    expect(hasPaid([{ amountMga: null }, { amountMga: 0 }])).toBe(false);
    expect(hasPaid([{ amountMga: 5000 }])).toBe(true);
  });

  const now = at("2026-10-15");

  it("gives a Lite month from now to a referrer without a plan", () => {
    const reward = referralReward([row("premium", "2026-01-01", "2026-02-01")], now);
    expect(reward.plan).toBe("lite");
    expect(Date.parse(reward.startsAt)).toBe(now);
    // A calendar month, in local time (as recorded from /admin).
    expect(reward.endsAt).toBe(periodEnd(new Date(now), "month")!.toISOString());
  });

  it("gives a month of the running plan, after its end", () => {
    const reward = referralReward([row("premium", "2026-10-01", "2026-11-01"), row("premium", "2026-11-01", "2026-12-01")], now);
    expect(reward.plan).toBe("premium");
    expect(reward.startsAt).toBe(new Date(at("2026-12-01")).toISOString());
    expect(reward.endsAt).toBe(new Date(at("2027-01-01")).toISOString());
  });

  it("gives an admin a Lite month, not delayed by the admin plan", () => {
    const reward = referralReward([row("unlimited", "2026-01-01", null)], now);
    expect(reward.plan).toBe("lite");
    expect(Date.parse(reward.startsAt)).toBe(now);
  });

  it("starts now when the running plan has no end", () => {
    const reward = referralReward([row("pro", "2026-01-01", null)], now);
    expect(reward.plan).toBe("pro");
    expect(Date.parse(reward.startsAt)).toBe(now);
  });
});
