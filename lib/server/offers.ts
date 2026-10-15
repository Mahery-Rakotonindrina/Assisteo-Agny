import { discountStillValid, referralReward, type PromoCode } from "@/lib/offers";
import { logAdminAction } from "./adminLog";
import {
  clearDiscount,
  getDiscount,
  getPromoCode,
  markRedeemed,
  markRewarded,
  parentOf,
  returnPromoUse,
  swapDiscount,
  takePromoUse,
  unmarkRedeemed,
  unmarkRewarded,
  type PendingDiscount,
} from "./offerStore";
import { reportError } from "./reportError";
import { addSubscriptions, subscriptionsForEmail } from "./subscriptions";

// ---- Discounts ----------------------------------------------------------------
//
// A discount code is used once per account, and its use is taken as soon as
// it is entered (so `maxUses` holds before any payment). A discount replaced
// by another, or whose code was turned off, expired or deleted, gives its use
// back; the payment then only forgets it.

/** Whether a discount's code is still the very one it was entered with (not deleted, nor made again since). */
const sameCode = (promo: PromoCode | null, discount: PendingDiscount): promo is PromoCode => promo !== null && promo.createdAt === discount.since;

/** Gives back what a discount took when entered: its use, and the account's right to enter it. */
async function giveBack(email: string, discount: PendingDiscount) {
  // A deleted code (or a new one under the same name) has nothing of this discount's to give back.
  if (!sameCode(await getPromoCode(discount.code), discount)) return;
  await returnPromoUse(discount.code);
  await unmarkRedeemed(discount.code, email);
}

/** Keeps a discount code for this account's next payment, replacing the one waiting. */
export async function enterDiscountCode(email: string, promo: PromoCode): Promise<"ok" | "already_used" | "used_up"> {
  if (!(await markRedeemed(promo.code, email))) return "already_used";
  if (!(await takePromoUse(promo.code, promo.maxUses))) {
    await unmarkRedeemed(promo.code, email);
    return "used_up";
  }
  const previous = await swapDiscount(email, { code: promo.code, percent: promo.percent, since: promo.createdAt });
  if (previous) await giveBack(email, previous);
  return "ok";
}

/** The discount waiting for this account, if its code still counts; else it is dropped (and given back). */
export async function pendingDiscount(email: string, now = Date.now()): Promise<PendingDiscount | null> {
  const discount = await getDiscount(email);
  if (!discount) return null;
  const promo = await getPromoCode(discount.code);
  if (sameCode(promo, discount) && discountStillValid(promo, now)) return discount;
  if (await clearDiscount(email)) await giveBack(email, discount);
  return null;
}

/**
 * After the owner records a payment (an amount above 0) for these e-mails:
 * each one's waiting discount is used up (counted when entered), and a
 * referred e-mail's first payment gives their referrer a month. A failure
 * here never undoes the payment just recorded.
 */
export async function afterPayment(actor: string, emails: string[], amountMga: number | null, now = Date.now()) {
  if (!amountMga || amountMga <= 0) return;
  for (const email of emails) {
    try {
      // Checked again: a code turned off or expired since is dropped, not used.
      const discount = await pendingDiscount(email, now);
      if (discount && (await clearDiscount(email))) {
        await logAdminAction(actor, "promo_discount_used", `${email} · ${discount.code} · -${discount.percent} %`);
      }
    } catch (error) {
      await reportError(error, { route: "admin/subscriptions", kind: "discount" });
    }

    try {
      const referrer = await parentOf(email);
      if (!referrer || !(await markRewarded(email))) continue;
      try {
        const reward = referralReward(await subscriptionsForEmail(referrer), now);
        await addSubscriptions([
          { email: referrer, ...reward, amountMga: null, paymentMethod: "referral", paymentRef: null, note: `Parrainage : ${email}` },
        ]);
        await logAdminAction(actor, "referral_reward", `${referrer} · ${reward.plan} · ${email}`);
      } catch (error) {
        // Not given: may be given at the next payment.
        await unmarkRewarded(email);
        throw error;
      }
    } catch (error) {
      await reportError(error, { route: "admin/subscriptions", kind: "referral" });
    }
  }
}
