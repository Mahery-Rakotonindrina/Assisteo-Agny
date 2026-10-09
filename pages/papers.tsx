import Head from "next/head";
import Link from "next/link";
import { motion } from "motion/react";
import { useMemo } from "react";
import { BellRing, ChevronRight, FileText, ScanLine } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { useHistory } from "@/hooks/useHistory";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { rise, stagger } from "@/lib/motion";
import { daysUntil, listPapers, SOON_DAYS, type PaperStatus } from "@/lib/papers";
import styles from "@/styles/Papers.module.scss";

const groups: PaperStatus[] = ["expired", "soon", "valid", "undated"];

/** "Mes papiers": ID cards, insurance, warranties… and when they expire. */
export default function PapersPage() {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const { entries, isLoading } = useHistory();
  const papers = useMemo(() => listPapers(entries, now), [entries, now]);
  const expired = papers.filter((paper) => paper.status === "expired").length;
  const soon = papers.filter((paper) => paper.status === "soon").length;

  const when = (status: PaperStatus, expiry: number | null) => {
    if (expiry === null) return t("papers.noDate");
    const days = daysUntil(expiry, now);
    const date = formatDate(expiry, locale);
    if (status === "expired") return t("papers.expiredOn", { date });
    if (status === "soon") return days === 0 ? t("papers.expiresToday") : t("papers.expiresIn", { date, count: days });
    return t("papers.validUntil", { date });
  };

  return (
    <>
      <Head>
        <title>{`${t("papers.title")} · ${t("meta.title")}`}</title>
      </Head>
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("papers.title")}</h1>
          <p>{t("papers.subtitle")}</p>
        </motion.header>

        {!isLoading && papers.length === 0 ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("papers.emptyTitle")}
              body={t("papers.emptyBody")}
              action={
                <Button href="/?mode=document" icon={<ScanLine />}>
                  {t("papers.scan")}
                </Button>
              }
            />
          </motion.div>
        ) : (
          <>
            {(expired > 0 || soon > 0) && (
              <motion.p variants={rise} className={styles.alert} data-tone={expired > 0 ? "expired" : "soon"}>
                {[expired > 0 && t("papers.alertExpired", { count: expired }), soon > 0 && t("papers.alertSoon", { count: soon, days: SOON_DAYS })]
                  .filter(Boolean)
                  .join(" · ")}
              </motion.p>
            )}
            {groups.map((status) => {
              const items = papers.filter((paper) => paper.status === status);
              if (items.length === 0) return null;
              return (
                <motion.section key={status} variants={rise} className={styles.group}>
                  <h2>{t(`papers.groups.${status}`)}</h2>
                  <ul>
                    {items.map(({ entry, kind, expiry }) => (
                      <li key={entry.id}>
                        <Link href={{ pathname: "/result", query: { id: entry.id } }} className={styles.paper} data-status={status}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                          {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : <FileText size={20} />}
                          <span className={styles.text}>
                            <strong>{entry.analysis.title}</strong>
                            <small>{t(`papers.kinds.${kind}`)}</small>
                            <span className={styles.when}>{when(status, expiry)}</span>
                          </span>
                          {entry.reminderAt && entry.reminderAt > now && <BellRing size={16} className={styles.bell} aria-label={t("papers.reminderSet")} />}
                          <ChevronRight size={18} className={styles.chevron} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </motion.section>
              );
            })}
            <motion.div variants={rise}>
              <Button href="/?mode=document" variant="secondary" icon={<ScanLine />}>
                {t("papers.scan")}
              </Button>
            </motion.div>
          </>
        )}
      </motion.div>
    </>
  );
}
