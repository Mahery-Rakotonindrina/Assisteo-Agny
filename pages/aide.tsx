import Link from "next/link";
import { motion } from "motion/react";
import { useState } from "react";
import { Apple, BellRing, Camera, ChevronDown, FileText, HandCoins, LifeBuoy, ListChecks, Mail, MessageCircle, Package, ScanSearch, Search, Sparkles, UserRound, Wallet, WifiOff, type LucideIcon } from "lucide-react";
import { Seo } from "@/components/Seo";
import { useTranslation } from "@/hooks/useTranslation";
import { helpGuides, helpTopics, searchHelp, type HelpGuideId, type HelpTopicId } from "@/lib/help";
import { rise, stagger } from "@/lib/motion";
import styles from "@/styles/Help.module.scss";

const topicIcons: Record<HelpTopicId, LucideIcon> = {
  scan: ScanSearch,
  plans: Sparkles,
  parcels: Package,
  expenses: Wallet,
  loans: HandCoins,
  account: UserRound,
  offline: WifiOff,
};

// The same icons as the screens they explain.
const guideIcons: Record<HelpGuideId, [LucideIcon, LucideIcon, LucideIcon]> = {
  scan: [Camera, Sparkles, MessageCircle],
  parcel: [Package, ListChecks, BellRing],
  expense: [FileText, Apple, Wallet],
  account: [UserRound, Mail, ListChecks],
};

/** Help: guides in a few steps, then the common questions by topic, with a search. */
export default function HelpPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const entries = helpTopics.flatMap(({ id, questions }) =>
    questions.map((question) => {
      const base = `help.topics.${id}.questions.${question}`;
      return { key: `${id}-${question}`, topic: id, q: t(`${base}.q`), a: t(`${base}.a`), text: `${t(`${base}.q`)} ${t(`${base}.a`)} ${t(`help.topics.${id}.title`)}` };
    }),
  );
  const found = searchHelp(entries, query);
  const searching = query.trim() !== "";

  return (
    <>
      <Seo title={t("help.metaTitle")} description={t("help.metaDescription")} path="/aide" />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.hero}>
          <h1>
            <LifeBuoy size={26} aria-hidden /> {t("help.title")}
          </h1>
          <p>{t("help.lead")}</p>
          <label className={styles.search}>
            <Search size={18} aria-hidden />
            <span className="visually-hidden">{t("help.searchLabel")}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 80))} placeholder={t("help.searchPlaceholder")} autoComplete="off" data-testid="help-search" />
          </label>
        </motion.header>

        {!searching && (
          <motion.section variants={rise} className={styles.section} data-testid="help-guides">
            <h2>{t("help.guidesTitle")}</h2>
            <div className={styles.guides}>
              {helpGuides.map((id) => (
                <article key={id} className={styles.guide} data-guide={id}>
                  <h3>{t(`help.guides.${id}.title`)}</h3>
                  <ol>
                    {guideIcons[id].map((Icon, index) => (
                      <li key={index}>
                        <span className={styles.stepIcon}>
                          <Icon size={18} aria-hidden />
                        </span>
                        <span>
                          <strong>{t(`help.guides.${id}.steps.${index + 1}.t`)}</strong>
                          <small>{t(`help.guides.${id}.steps.${index + 1}.b`)}</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          </motion.section>
        )}

        <motion.section variants={rise} className={styles.section}>
          <h2>{t("help.faqTitle")}</h2>
          {searching && (
            <p className={styles.count} role="status" data-testid="help-count">
              {found.length === 0 ? t("help.noResult", { query: query.trim() }) : t("help.resultCount", { count: found.length })}
            </p>
          )}
          {helpTopics.map(({ id }) => {
            const list = found.filter((entry) => entry.topic === id);
            if (list.length === 0) return null;
            const Icon = topicIcons[id];
            return (
              <div key={id} className={styles.topic} data-topic={id}>
                <h3>
                  <Icon size={18} aria-hidden /> {t(`help.topics.${id}.title`)}
                </h3>
                {list.map((entry) => (
                  // Open as soon as the person searches: the answer is what they want.
                  <details key={`${entry.key}-${searching}`} className={styles.question} open={searching || undefined}>
                    <summary>
                      {entry.q}
                      <ChevronDown size={18} />
                    </summary>
                    <p>{entry.a}</p>
                  </details>
                ))}
              </div>
            );
          })}
        </motion.section>

        <motion.p variants={rise} className={styles.contact}>
          {t("help.contact")} <Link href="/settings">{t("settings.title")}</Link>
        </motion.p>
      </motion.div>
    </>
  );
}
