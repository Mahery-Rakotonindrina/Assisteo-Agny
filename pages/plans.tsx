import Head from "next/head";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useState } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, LogIn, MessageCircle, Phone, RefreshCw } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanIcon } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { useAccount } from "@/lib/account/AccountProvider";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDate, formatNumber } from "@/lib/format";
import { rise, stagger } from "@/lib/motion";
import { defaultPlansConfig, planRank, soldPlans, type PlanOffer, type SoldPlanId } from "@/lib/plans";
import { haptics } from "@/services/device";
import { planStore } from "@/services/plan";
import styles from "@/styles/Plans.module.scss";

const fallbackOffers = soldPlans.map((id) => ({ id, ...defaultPlansConfig.offers[id] }));

/** The offers, and how to subscribe: the payment happens outside the app. */
export default function PlansPage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { plan, id } = usePlan();
  const { email } = useAccount();
  const [refreshing, setRefreshing] = useState(false);
  const offers = plan?.offers ?? fallbackOffers;
  const payment = plan?.payment ?? defaultPlansConfig.payment;

  const back = () => {
    if (window.history.length > 1) router.back();
    else void router.push("/settings");
  };

  const limit = (value: number, key: "scans" | "questions" | "parcels") =>
    value === 0 ? t(`plans.features.${key}Unlimited`) : t(`plans.features.${key}`, { count: formatNumber(value, locale) });

  const features = (offer: PlanOffer, offerId: SoldPlanId) => {
    const limits = [limit(offer.scans, "scans"), limit(offer.questionsPerDay, "questions"), limit(offer.parcels, "parcels")];
    if (offerId === "lite") return [...limits, t("plans.features.parcelCosts"), t("plans.features.ownKey")];
    const deep = offer.deepPerMonth === 0 ? t("plans.features.deepUnlimited") : t("plans.features.deep", { count: formatNumber(offer.deepPerMonth, locale) });
    if (offerId === "premium") return [t("plans.features.allLite"), ...limits, deep, t("plans.features.priority")];
    return [t("plans.features.allPremium"), ...limits, deep, t("plans.features.clients"), t("plans.features.reseller")];
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
      <Head>
        <title>{`${t("plans.title")} · ${t("meta.title")}`}</title>
      </Head>
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <Button variant="secondary" size="icon" onClick={back} aria-label={t("nav.back")}>
            <ArrowLeft />
          </Button>
          <h1>{t("plans.title")}</h1>
          <p>{t("plans.subtitle")}</p>
        </motion.header>

        {id !== "free" && plan && (
          <motion.p variants={rise} className={styles.current} data-plan={id}>
            <PlanIcon plan={id} size={16} />{" "}
            {plan.endsAt === null
              ? t("plans.currentNoEnd", { plan: t(`plans.names.${id}`) })
              : t("plans.current", { plan: t(`plans.names.${id}`), date: formatDate(plan.endsAt - 1, locale) })}
          </motion.p>
        )}

        <motion.div variants={rise} className={styles.offers}>
          {offers.map((offer) => {
            const isCurrent = id === offer.id;
            const included = !isCurrent && planRank[id] > planRank[offer.id];
            return (
              <article key={offer.id} className={styles.offer} data-plan={offer.id} data-current={isCurrent ? "" : undefined}>
                <div className={styles.offerHead}>
                  <span className={styles.offerIcon}>
                    <PlanIcon plan={offer.id} size={20} />
                  </span>
                  <h2>{t(`plans.names.${offer.id}`)}</h2>
                  {isCurrent && <span className={styles.tag}>{t("plans.yours")}</span>}
                  {included && <span className={styles.tag}>{t("plans.included")}</span>}
                  {offer.id === "premium" && !isCurrent && !included && <span className={styles.tag}>{t("plans.recommended")}</span>}
                </div>
                <p className={styles.price}>
                  <strong>{formatAriary(offer.priceMga, locale)}</strong> <span>{t("plans.perMonth")}</span>
                </p>
                <p className={styles.pitch}>{t(`plans.pitch.${offer.id}`)}</p>
                <ul>
                  {features(offer, offer.id).map((line, index) => (
                    <li key={line} className={index === 0 && offer.id !== "lite" ? styles.inherit : undefined}>
                      <Check size={15} /> {line}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </motion.div>

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
