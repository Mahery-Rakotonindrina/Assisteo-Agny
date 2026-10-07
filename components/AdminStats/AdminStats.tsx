import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { MessageCircle, RefreshCw, ScanLine, Smartphone, ThumbsDown, ThumbsUp, Timer } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { categories } from "@/lib/ai/schema";
import { rise } from "@/lib/motion";
import type { AdminStatsResponse } from "@/pages/api/admin/stats";
import { httpClient } from "@/services/httpClient";
import styles from "./AdminStats.module.scss";

type Totals = Record<string, number>;

function sumCounters(days: AdminStatsResponse["days"]): Totals {
  const totals: Totals = {};
  for (const day of days) for (const [field, value] of Object.entries(day.counters)) totals[field] = (totals[field] ?? 0) + value;
  return totals;
}

/** Usage over the last 14 days and the latest answer feedback (admin page). */
export function AdminStats({ token }: { token: string }) {
  const { t, locale } = useTranslation();
  const [data, setData] = useState<AdminStatsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    httpClient
      .get<AdminStatsResponse>("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, version]);

  if (failed) return <p className={styles.error}>{t("admin.error")}</p>;
  if (!data) return <div className={styles.card} aria-busy />;

  const totals = sumCounters(data.days);
  const scans = totals.scans ?? 0;
  const votes = (totals["feedback:up"] ?? 0) + (totals["feedback:down"] ?? 0);
  const chronological = [...data.days].reverse();
  const maxDay = Math.max(1, ...chronological.map((day) => day.counters.scans ?? 0));
  const byCategory = categories
    .map((category) => ({ category, count: totals[`scans:category:${category}`] ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const errors = Object.entries(totals)
    .filter(([field]) => field.startsWith("errors:"))
    .map(([field, count]) => ({ code: field.replace(/^errors:/, ""), count }))
    .sort((a, b) => b.count - a.count);
  const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short" });

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={styles.card}>
      <div className={styles.head}>
        <div>
          <h2>{t("admin.stats.title")}</h2>
          <p>{t("admin.stats.subtitle")}</p>
        </div>
        <button type="button" className={styles.refresh} onClick={() => setVersion((value) => value + 1)} aria-label={t("admin.stats.refresh")}>
          <RefreshCw size={16} />
        </button>
      </div>

      <div className={styles.kpis}>
        <Kpi icon={<ScanLine />} value={scans} label={t("admin.stats.scans")} />
        <Kpi icon={<Smartphone />} value={data.devices} label={t("admin.stats.devices")} />
        <Kpi icon={<MessageCircle />} value={totals.questions ?? 0} label={t("admin.stats.questions")} />
        <Kpi
          icon={<ThumbsUp />}
          value={votes ? `${Math.round(((totals["feedback:up"] ?? 0) / votes) * 100)} %` : "–"}
          label={t("admin.stats.satisfaction", { count: votes })}
        />
      </div>

      <div>
        <h3>{t("admin.stats.perDay")}</h3>
        <div className={styles.chart} role="img" aria-label={t("admin.stats.perDay")}>
          {chronological.map((day) => {
            const count = day.counters.scans ?? 0;
            return (
              <div key={day.date} className={styles.bar} title={`${dayLabel(day.date)} : ${count}`}>
                <span className={styles.barValue}>{count > 0 ? count : ""}</span>
                <motion.span
                  className={styles.barFill}
                  initial={{ height: 0 }}
                  animate={{ height: `${(count / maxDay) * 100}%` }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            );
          })}
        </div>
        <div className={styles.chartLabels}>
          <span>{dayLabel(chronological[0].date)}</span>
          <span>{t("admin.stats.today")}</span>
        </div>
      </div>

      <div className={styles.facts}>
        <span>
          <Timer size={15} /> {t("admin.stats.avgDuration", { seconds: scans ? ((totals["scans:ms"] ?? 0) / scans / 1000).toFixed(1) : "–" })}
        </span>
        <span>{t("admin.stats.ownKey", { count: totals["scans:own"] ?? 0 })}</span>
      </div>

      {byCategory.length > 0 && (
        <div>
          <h3>{t("admin.stats.categories")}</h3>
          <ul className={styles.rows}>
            {byCategory.map(({ category, count }) => (
              <li key={category} style={{ "--cat": `var(--cat-${category})` } as React.CSSProperties}>
                <span className={styles.rowLabel}>{t(`categories.${category}`)}</span>
                <span className={styles.rowBar}>
                  <span style={{ width: `${(count / byCategory[0].count) * 100}%` }} />
                </span>
                <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div>
          <h3>{t("admin.stats.errors")}</h3>
          <ul className={styles.errors}>
            {errors.map(({ code, count }) => (
              <li key={code}>
                <code>{code}</code>
                <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3>{t("admin.stats.feedback")}</h3>
        {data.feedback.length === 0 ? (
          <p className={styles.empty}>{t("admin.stats.noFeedback")}</p>
        ) : (
          <ul className={styles.feedback}>
            {data.feedback.map((item) => (
              <li key={`${item.at}-${item.title}`}>
                <span className={item.vote === "up" ? styles.up : styles.down}>{item.vote === "up" ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />}</span>
                <span className={styles.feedbackText}>
                  <strong>{item.title}</strong>
                  <small>
                    {t(`categories.${item.category}`)} · {Math.round(item.confidence * 100)} %
                    {item.reason && <> · {t(`feedback.reasons.${item.reason}`)}</>} · {item.model}
                  </small>
                </span>
                <time>{new Date(item.at).toLocaleDateString(locale, { day: "numeric", month: "short" })}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.section>
  );
}

function Kpi({ icon, value, label }: { icon: React.ReactNode; value: number | string; label: string }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiIcon}>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}
