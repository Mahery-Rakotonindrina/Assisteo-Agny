import Link from "next/link";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { Apple, ArrowRight, BellRing, Briefcase, Camera, Car, ChevronDown, Coins, Download, FileDown, Files, FileText, HandCoins, House, ListChecks, MessageCircle, Package, ScanSearch, Sparkles, Sprout, Wallet, type LucideIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import { Seo } from "@/components/Seo";
import { useAndroidDownload } from "@/hooks/useAndroidDownload";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { discoverCards, type DiscoverFeature } from "@/lib/discoverFeatures";
import { exampleIds, exampleImage } from "@/lib/examples";
import { rise, stagger } from "@/lib/motion";
import styles from "@/styles/Discover.module.scss";

// Ids double as the category colour (--cat-<id>) and the text keys.
const features = [
  { id: "document", icon: FileText },
  { id: "food", icon: Apple },
  { id: "parcel", icon: Package },
  { id: "vehicle", icon: Car },
  { id: "object", icon: Sprout },
  { id: "list", icon: ListChecks },
] as const;
const extraIcons: Record<DiscoverFeature, LucideIcon> = {
  reminders: BellRing,
  pdfExport: FileDown,
  parcelCosts: Coins,
  multiPage: Files,
  deepAnalysis: ScanSearch,
  garage: Car,
  inventory: House,
  plants: Sprout,
  reseller: Briefcase,
  expenses: Wallet,
  loans: HandCoins,
};
const steps = [
  { id: "photo", icon: Camera },
  { id: "analysis", icon: Sparkles },
  { id: "questions", icon: MessageCircle },
] as const;
const questions = ["free", "account", "photos", "devices", "network", "mistakes"] as const;

/** Presentation of the app for visitors and search engines: what it does, how, the plans, a FAQ. */
export default function DiscoverPage() {
  const { t } = useTranslation();
  const android = useAndroidDownload();
  // Null in the static HTML and on the first render: the built-in cards, unlabelled.
  // Then the offers' settings: their labels, without what no sold plan has now.
  const { plan } = usePlan();
  const extras = discoverCards(plan ? (plan.featureFrom ?? {}) : null);

  const tryButton = (
    <Button href="/" size="lg" icon={<Sparkles />}>
      {t("discover.try")}
    </Button>
  );

  return (
    <>
      <Seo title={t("meta.discoverTitle")} description={t("meta.discover")} path="/decouvrir" />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.hero}>
          <p className={styles.eyebrow}>{t("discover.eyebrow")}</p>
          <h1>
            {t("discover.headline")} <em>{t("discover.headlineAccent")}</em>
          </h1>
          <p className={styles.lead}>{t("discover.lead")}</p>
          <div className={styles.actions}>
            {tryButton}
            {android && (
              <Button href={android.url} variant="secondary" size="lg" icon={<Download />}>
                {t("sidebar.androidDownload")}
              </Button>
            )}
          </div>
          <p className={styles.note}>{t("discover.freeNote")}</p>
        </motion.header>

        <motion.section variants={rise} className={styles.section}>
          <h2>{t("discover.featuresTitle")}</h2>
          <ul className={styles.features}>
            {features.map(({ id, icon: Icon }) => (
              <li key={id} className={styles.feature} style={{ "--tint": `var(--cat-${id})` } as CSSProperties}>
                <span className={styles.featureIcon}>
                  <Icon size={20} />
                </span>
                <h3>{t(`discover.features.${id}.title`)}</h3>
                <p>{t(`discover.features.${id}.body`)}</p>
              </li>
            ))}
          </ul>
        </motion.section>

        <motion.section variants={rise} className={styles.section}>
          <h2>{t("discover.extrasTitle")}</h2>
          <p className={styles.hint}>{t("discover.extrasHint")}</p>
          <ul className={styles.features}>
            {extras.map(({ feature, from }) => {
              const Icon = extraIcons[feature];
              return (
                <li key={feature} className={styles.feature} data-feature={feature} style={{ "--tint": "var(--accent)" } as CSSProperties}>
                  <span className={styles.featureIcon}>
                    <Icon size={20} />
                  </span>
                  <h3>{t(`discover.extras.${feature}.title`)}</h3>
                  <p>{t(`discover.extras.${feature}.body`)}</p>
                  {from && (
                    <span className={styles.from}>
                      {from === "free" ? (
                        t("discover.extrasFree")
                      ) : (
                        <>
                          {t("discover.extrasFrom")} <PlanBadge plan={from} />
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </motion.section>

        <motion.section variants={rise} className={styles.section}>
          <h2>{t("discover.examplesTitle")}</h2>
          <p className={styles.hint}>{t("examples.hint")}</p>
          <div className={styles.examples}>
            {exampleIds.map((id) => (
              <Link key={id} href={{ pathname: "/result", query: { example: id } }} className={styles.example}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static example photo, works in the static export */}
                <img src={exampleImage(id)} alt="" loading="lazy" />
                <span>{t(`examples.labels.${id}`)}</span>
              </Link>
            ))}
          </div>
        </motion.section>

        <motion.section variants={rise} className={styles.section}>
          <h2>{t("discover.howTitle")}</h2>
          <ol className={styles.steps}>
            {steps.map(({ id, icon: Icon }, index) => (
              <li key={id} className={styles.step}>
                <span className={styles.stepNumber}>{index + 1}</span>
                <div>
                  <h3>
                    <Icon size={18} />
                    {t(`discover.steps.${id}.title`)}
                  </h3>
                  <p>{t(`discover.steps.${id}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </motion.section>

        <motion.section variants={rise} className={`${styles.section} ${styles.plans}`}>
          <h2>{t("discover.plansTitle")}</h2>
          <p>{t("discover.plansBody")}</p>
          <Link href="/plans" className={styles.plansLink}>
            {t("discover.plansCta")} <ArrowRight size={16} />
          </Link>
        </motion.section>

        <motion.section variants={rise} className={styles.section}>
          <h2>{t("discover.faqTitle")}</h2>
          <div className={styles.faq}>
            {questions.map((id) => (
              <details key={id} className={styles.question}>
                <summary>
                  {t(`discover.faq.${id}.q`)}
                  <ChevronDown size={18} />
                </summary>
                <p>{t(`discover.faq.${id}.a`)}</p>
              </details>
            ))}
          </div>
        </motion.section>

        <motion.section variants={rise} className={styles.final}>
          <h2>{t("discover.finalTitle")}</h2>
          <p>{t("discover.finalBody")}</p>
          {tryButton}
        </motion.section>

        <motion.footer variants={rise} className={styles.footer}>
          <Link href="/privacy">{t("legal.privacy")}</Link>
          <Link href="/terms">{t("legal.terms")}</Link>
        </motion.footer>
      </motion.div>
    </>
  );
}
