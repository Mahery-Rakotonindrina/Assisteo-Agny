import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { ArrowLeft, BadgePercent, Check, Copy, ExternalLink, Gift, LogIn, MessageCircle, Phone, RefreshCw, Share2, Sparkles, TicketCheck } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanIcon } from "@/components/PlanBadge";
import { Seo } from "@/components/Seo";
import { useToast } from "@/components/Toast";
import { useAccount } from "@/lib/account/AccountProvider";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDate, formatNumber } from "@/lib/format";
import { config } from "@/lib/config";
import { rise, stagger } from "@/lib/motion";
import { defaultYearPrice, discountedPrice, monthsFree, TRIAL_DAYS } from "@/lib/offers";
import { isBuiltInPlan, localName, planRankIn } from "@/lib/customPlans";
import { defaultPlansConfig, planIds, planRank, soldPlans, type AnyPlanId, type PlanOffer, type PlanResponse } from "@/lib/plans";
import { offerLines } from "@/lib/planPerks";
import { haptics, shareText } from "@/services/device";
import { redeemCode, startPremiumTrial } from "@/services/offers";
import { planStore } from "@/services/plan";
import { ApiError } from "@/types/api";
import styles from "@/styles/Plans.module.scss";

const fallbackOffers: PlanResponse["offers"] = soldPlans.map((id) => ({ id, ...defaultPlansConfig.offers[id] }));

/** The offers, and how to subscribe: the payment happens outside the app. */
export default function PlansPage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { plan, id, current, name: planName, color } = usePlan();
  const { email } = useAccount();
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"trial" | "code" | null>(null);
  // By rank: a plan created from the Admin sits between the built-in ones.
  const offers = [...(plan?.offers ?? fallbackOffers)].sort((a, b) => planRankIn(a.id, plan) - planRankIn(b.id, plan));
  const payment = plan?.payment ?? defaultPlansConfig.payment;
  const discount = email ? (plan?.discount ?? null) : null;
  const referralCode = email ? (plan?.referralCode ?? null) : null;
  const canTry = Boolean(email && plan?.trialEligible) && planRank[id] < planRank.premium;
  const price = (value: number) => (discount ? discountedPrice(value, discount.percent) : value);

  const startTrial = async () => {
    setBusy("trial");
    try {
      await startPremiumTrial();
      haptics.tap();
    } catch (error) {
      toast(error instanceof ApiError && error.code === "refused" ? t("plans.trialOffer.used") : t("plans.codes.failed"), "error");
      void planStore.refresh();
    } finally {
      setBusy(null);
    }
  };

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy("code");
    try {
      const result = await redeemCode(code);
      if (!result.ok) {
        toast(t(`plans.codes.refused.${result.reason}`), "error");
        return;
      }
      haptics.tap();
      setCode("");
      if (result.kind === "discount") toast(t("plans.codes.discountDone", { percent: result.percent }));
      else if (result.kind === "referral") toast(t("plans.codes.referralDone"));
      // An access: the plan is fetched again, and the welcome screen shows it.
      else toast(t("plans.codes.accessDone", { plan: result.name ? localName(result.name, locale) : t(`plans.names.${result.plan}`) }));
    } catch (error) {
      toast(error instanceof ApiError && error.code === "rate_limited" ? t("plans.codes.tooMany") : t("plans.codes.failed"), "error");
    } finally {
      setBusy(null);
    }
  };

  // The presentation page at the public address (the server's in the Android app),
  // else this page's origin (local dev).
  const shareMessage = () => t("plans.referral.message", { code: referralCode ?? "", link: `${config.siteUrl || window.location.origin}/decouvrir` });
  const shareReferral = async () => {
    haptics.tap();
    if ((await shareText(t("plans.referral.title"), shareMessage())) === "copied") toast(t("plans.copied"));
  };
  const whatsappReferral = () => {
    haptics.tap();
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage())}`, "_blank", "noopener,noreferrer");
  };

  const back = () => {
    if (window.history.length > 1) router.back();
    else void router.push("/settings");
  };

  const limit = (value: number, key: "scans" | "questions" | "parcels") =>
    value === 0 ? t(`plans.features.${key}Unlimited`) : t(`plans.features.${key}`, { count: formatNumber(value, locale) });

  // Each offer's features as set in /admin (none in test nor switched off); the built-in ladder from an older server.
  const offerFeatures = (offerId: AnyPlanId) =>
    offers.find((offer) => offer.id === offerId)?.features ?? (isBuiltInPlan(offerId) ? defaultPlansConfig.features[offerId] : []);
  // The built-in plan below: Lite under Premium, Premium under Pro; a created plan, the one it comes after.
  const belowOf = (offerId: AnyPlanId) => {
    if (offerId === "pro") return "premium";
    if (offerId === "premium") return "lite";
    if (isBuiltInPlan(offerId)) return null;
    const below = planIds[Math.floor(planRankIn(offerId, plan))];
    return below === "lite" || below === "premium" || below === "pro" ? below : null;
  };
  const features = (offer: PlanOffer, offerId: AnyPlanId) => {
    const limits = [limit(offer.scans, "scans"), limit(offer.questionsPerDay, "questions"), limit(offer.parcels, "parcels")];
    const below = belowOf(offerId);
    return offerLines(
      { id: offerId, features: offerFeatures(offerId), deepPerMonth: offer.deepPerMonth },
      below && { id: below, name: planName(below), features: offerFeatures(below) },
      limits,
      t,
      locale,
    );
  };

  /** "or 50 000 Ar a year: 2 months free" (a plan cached by an older version has no yearly price). */
  const yearly = (offer: PlanOffer) => {
    const yearPriceMga = offer.yearPriceMga ?? defaultYearPrice(offer.priceMga);
    if (!yearPriceMga) return null;
    const free = monthsFree({ priceMga: offer.priceMga, yearPriceMga });
    const values = { price: formatAriary(price(yearPriceMga), locale), count: free };
    return <p className={styles.year}>{free > 0 ? t("plans.perYearFree", values) : t("plans.perYear", values)}</p>;
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      haptics.tap();
      toast(t("plans.copied"));
    } catch {
      toast(t("parcel.copyFailed"), "error");
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await planStore.refresh();
    setRefreshing(false);
    toast(t("plans.refreshed"));
  };

  const contact = payment.contact.trim();
  const contactIsLink = /^https?:\/\//i.test(contact);
  const contactIsPhone = !contactIsLink && /^\+?[\d\s.-]{6,}$/.test(contact);

  return (
    <>
      <Seo title={`${t("plans.title")} · ${t("meta.title")}`} description={t("meta.plans")} path="/plans" />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <Button variant="secondary" size="icon" onClick={back} aria-label={t("nav.back")}>
            <ArrowLeft />
          </Button>
          <h1>{t("plans.title")}</h1>
          <p>{t("plans.subtitle")}</p>
        </motion.header>

        {id !== "free" && plan && (
          <motion.p variants={rise} className={styles.current} data-plan={current} data-plan-color={color()}>
            <PlanIcon plan={current} size={16} />{" "}
            {plan.endsAt === null
              ? t("plans.currentNoEnd", { plan: planName() })
              : t("plans.current", { plan: planName(), date: formatDate(plan.endsAt - 1, locale) })}
          </motion.p>
        )}

        {discount && (
          <motion.p variants={rise} className={styles.discount}>
            <BadgePercent size={16} /> {t("plans.codes.discountWaiting", { percent: discount.percent, code: discount.code })}
          </motion.p>
        )}

        {canTry && (
          <motion.section variants={rise} className={styles.trial} data-plan="premium">
            <h2>{t("plans.trialOffer.title", { days: TRIAL_DAYS })}</h2>
            <p>{t("plans.trialOffer.body", { days: TRIAL_DAYS })}</p>
            <Button icon={<Sparkles />} onClick={() => void startTrial()} disabled={busy !== null}>
              {t("plans.trialOffer.cta", { days: TRIAL_DAYS })}
            </Button>
          </motion.section>
        )}

        <motion.div variants={rise} className={styles.offers}>
          {offers.map((offer) => {
            const isCurrent = current === offer.id;
            const included = !isCurrent && planRankIn(current, plan) > planRankIn(offer.id, plan);
            return (
              <article key={offer.id} className={styles.offer} data-plan={offer.id} data-plan-color={color(offer.id)} data-current={isCurrent ? "" : undefined}>
                <div className={styles.offerHead}>
                  <span className={styles.offerIcon}>
                    <PlanIcon plan={offer.id} size={20} />
                  </span>
                  <h2>{planName(offer.id)}</h2>
                  {isCurrent && <span className={styles.tag}>{t("plans.yours")}</span>}
                  {included && <span className={styles.tag}>{t("plans.included")}</span>}
                  {offer.id === "premium" && !isCurrent && !included && <span className={styles.tag}>{t("plans.recommended")}</span>}
                </div>
                <p className={styles.price}>
                  {discount && <s className={styles.was}>{formatAriary(offer.priceMga, locale)}</s>}
                  <strong>{formatAriary(price(offer.priceMga), locale)}</strong> <span>{t("plans.perMonth")}</span>
                </p>
                {yearly(offer)}
                {isBuiltInPlan(offer.id) && <p className={styles.pitch}>{t(`plans.pitch.${offer.id}`)}</p>}
                <ul>
                  {features(offer, offer.id).map((line) => (
                    <li key={line.text} className={line.inherit ? styles.inherit : undefined}>
                      <Check size={15} /> {line.text}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </motion.div>

        <motion.section variants={rise} className={styles.extras}>
          <h2>
            <TicketCheck size={18} /> {t("plans.codes.title")}
          </h2>
          {email ? (
            <form className={styles.codeForm} onSubmit={(event) => void redeem(event)}>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.slice(0, 24))}
                placeholder={t("plans.codes.placeholder")}
                aria-label={t("plans.codes.title")}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" variant="secondary" size="md" disabled={!code.trim() || busy !== null}>
                {t("plans.codes.apply")}
              </Button>
            </form>
          ) : (
            <p>{t("plans.codes.signIn")}</p>
          )}
          <p>{t("plans.codes.hint")}</p>
        </motion.section>

        {referralCode && (
          <motion.section variants={rise} className={styles.extras}>
            <h2>
              <Gift size={18} /> {t("plans.referral.title")}
            </h2>
            <p>{t("plans.referral.body")}</p>
            <p className={styles.referralCode}>{referralCode}</p>
            <div className={styles.contact}>
              <Button variant="secondary" size="md" icon={<MessageCircle />} onClick={whatsappReferral}>
                {t("plans.referral.whatsapp")}
              </Button>
              <Button variant="ghost" size="md" icon={<Share2 />} onClick={() => void shareReferral()}>
                {t("plans.referral.share")}
              </Button>
              <Button variant="ghost" size="md" icon={<Copy />} onClick={() => void copy(referralCode)}>
                {t("plans.referral.copy")}
              </Button>
            </div>
          </motion.section>
        )}

        <motion.section variants={rise} className={styles.how}>
          <h2>{t("plans.how")}</h2>
          <ol>
            <li>
              <strong>{t("plans.step1")}</strong>
              {email ? (
                <p className={styles.done}>
                  <Check size={15} /> {t("plans.signedInAs", { email })}
                </p>
              ) : (
                <>
                  <p>{t("plans.step1Body")}</p>
                  <Button href="/settings?section=account" variant="secondary" size="md" icon={<LogIn />}>
                    {t("plans.signIn")}
                  </Button>
                </>
              )}
            </li>
            <li>
              <strong>{t("plans.step2")}</strong>
              <p className={styles.instructions}>{payment.instructions || t("plans.noInstructions")}</p>
            </li>
            <li>
              <strong>{t("plans.step3")}</strong>
              <p>{t("plans.step3Body")}</p>
              <div className={styles.contact}>
                {contactIsLink && (
                  <a className={styles.phone} href={contact} target="_blank" rel="noopener noreferrer">
                    <MessageCircle size={15} /> {t("plans.message")} <ExternalLink size={13} />
                  </a>
                )}
                {contactIsPhone && (
                  <>
                    <a className={styles.phone} href={`tel:${contact.replace(/[^\d+]/g, "")}`}>
                      <Phone size={15} /> {contact}
                    </a>
                    <Button variant="ghost" size="md" icon={<Copy />} onClick={() => void copy(contact)}>
                      {t("plans.copyNumber")}
                    </Button>
                  </>
                )}
                {contact && !contactIsLink && !contactIsPhone && <p>{contact}</p>}
                {email && (
                  <Button variant="ghost" size="md" icon={<Copy />} onClick={() => void copy(email)}>
                    {t("plans.copyEmail")}
                  </Button>
                )}
              </div>
            </li>
            <li>
              <strong>{t("plans.step4")}</strong>
              <p>{t("plans.step4Body")}</p>
              <Button variant="secondary" size="md" icon={<RefreshCw />} onClick={() => void refresh()} disabled={refreshing}>
                {t("plans.refresh")}
              </Button>
            </li>
          </ol>
          <p className={styles.note}>{t("plans.noRenewal")}</p>
        </motion.section>
      </motion.div>
    </>
  );
}
