import { describe, expect, it, vi } from "vitest";
import { discountStillValid, type PromoCode } from "@/lib/offers";

// The store's process-memory fallback: no Redis in these tests.
vi.mock("@/lib/server/redis", () => ({ redis: null }));

const { afterPayment, enterDiscountCode, pendingDiscount } = await import("@/lib/server/offers");
const { deletePromoCode, getDiscount, promoUses, savePromoCode } = await import("@/lib/server/offerStore");

const now = Date.parse("2026-10-15T12:00:00Z");
const discount = (code: string, patch: Partial<PromoCode> = {}): PromoCode => ({
  code,
  kind: "discount",
  plan: "lite",
  days: 0,
  percent: 20,
  maxUses: 0,
  expiresAt: null,
  active: true,
  createdAt: now,
  ...patch,
});

describe("a waiting discount", () => {
  it("counts while its code is an active discount, not expired", () => {
    expect(discountStillValid(discount("A"), now)).toBe(true);
    expect(discountStillValid(null, now)).toBe(false);
    expect(discountStillValid(discount("A", { active: false }), now)).toBe(false);
    expect(discountStillValid(discount("A", { expiresAt: now }), now)).toBe(false);
    expect(discountStillValid(discount("A", { kind: "access" }), now)).toBe(false);
  });
});

describe("discount codes", () => {
  it("are used once per account, even after the payment", async () => {
    const promo = discount("ONCE");
    await savePromoCode(promo);
    expect(await enterDiscountCode("a@example.com", promo)).toBe("ok");
    expect(await enterDiscountCode("a@example.com", promo)).toBe("already_used");
    await afterPayment("owner", ["a@example.com"], 4000, now);
    expect(await getDiscount("a@example.com")).toBeNull();
    expect(await enterDiscountCode("a@example.com", promo)).toBe("already_used");
    expect(await enterDiscountCode("b@example.com", promo)).toBe("ok");
  });

  it("hold their limit as soon as they are entered, and the payment does not count again", async () => {
    const promo = discount("TWO", { maxUses: 2 });
    await savePromoCode(promo);
    expect(await enterDiscountCode("c1@example.com", promo)).toBe("ok");
    expect(await enterDiscountCode("c2@example.com", promo)).toBe("ok");
    expect(await enterDiscountCode("c3@example.com", promo)).toBe("used_up");
    expect(await promoUses("TWO")).toBe(2);
    await afterPayment("owner", ["c1@example.com", "c2@example.com"], 4000, now);
    expect(await promoUses("TWO")).toBe(2);
  });

  it("give their use back when replaced by another", async () => {
    const first = discount("FIRST", { maxUses: 1 });
    const second = discount("SECOND", { percent: 30 });
    await Promise.all([savePromoCode(first), savePromoCode(second)]);
    expect(await enterDiscountCode("d@example.com", first)).toBe("ok");
    expect(await enterDiscountCode("d@example.com", second)).toBe("ok");
    expect(await getDiscount("d@example.com")).toEqual({ code: "SECOND", percent: 30 });
    expect(await promoUses("FIRST")).toBe(0);
    // Free again, for someone else (or the same account).
    expect(await enterDiscountCode("e@example.com", first)).toBe("ok");
  });

  it("are dropped and given back once their code is turned off or expired", async () => {
    const promo = discount("OFF", { maxUses: 1 });
    await savePromoCode(promo);
    expect(await enterDiscountCode("f@example.com", promo)).toBe("ok");
    expect(await pendingDiscount("f@example.com", now)).toEqual({ code: "OFF", percent: 20 });
    await savePromoCode({ ...promo, active: false });
    expect(await pendingDiscount("f@example.com", now)).toBeNull();
    expect(await getDiscount("f@example.com")).toBeNull();
    expect(await promoUses("OFF")).toBe(0);

    const late = discount("LATE", { expiresAt: now + 1000 });
    await savePromoCode(late);
    expect(await enterDiscountCode("g@example.com", late)).toBe("ok");
    expect(await pendingDiscount("g@example.com", now + 1000)).toBeNull();
  });

  it("are not used by a payment once their code is deleted", async () => {
    const promo = discount("GONE");
    await savePromoCode(promo);
    expect(await enterDiscountCode("h@example.com", promo)).toBe("ok");
    await deletePromoCode("GONE");
    await afterPayment("owner", ["h@example.com"], 4000, now);
    expect(await getDiscount("h@example.com")).toBeNull();
    expect(await promoUses("GONE")).toBe(0);
  });
});
