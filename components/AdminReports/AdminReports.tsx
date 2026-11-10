import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { MessageSquareHeart } from "lucide-react";
import { Button } from "@/components/Button";
import shared from "@/components/AdminSubscriptions/AdminSubscriptions.module.scss";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDateTime } from "@/lib/format";
import { rise } from "@/lib/motion";
import { reportStatuses, type AdminReportsResponse, type ReportStatus, type UserReport } from "@/lib/userReport";
import { httpClient } from "@/services/httpClient";
import styles from "./AdminReports.module.scss";

const PAGE = 20;

/** Admin: the feedback and problem reports, newest first, with their state (new / read / done). */
export function AdminReports({ token }: { token: string }) {
  const { t, locale } = useTranslation();
  const [reports, setReports] = useState<UserReport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState<ReportStatus | "all">("all");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let cancelled = false;
    httpClient
      .get<AdminReportsResponse>("/api/admin/reports", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        if (cancelled) return;
        setReports(result.reports);
        setHidden(Boolean(result.contactsHidden));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const mark = async (id: string, status: ReportStatus) => {
    setFailed(false);
    try {
      await httpClient.patch<void>("/api/admin/reports", { id, status }, { headers });
      setReports((list) => list?.map((report) => (report.id === id ? { ...report, status } : report)) ?? null);
    } catch {
      setFailed(true);
    }
  };

  const visible = (reports ?? []).filter((report) => filter === "all" || report.status === filter);
  const waiting = (reports ?? []).filter((report) => report.status === "new").length;

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={shared.card} data-testid="admin-reports">
      <div>
        <h2 className={shared.title}>
          <MessageSquareHeart size={18} /> {t("userReport.admin.title")}
          {waiting > 0 && <span className={styles.count}>{waiting}</span>}
        </h2>
        <p className={shared.subtitle}>{t("userReport.admin.subtitle")}</p>
      </div>
      {failed && <p className={shared.error}>{t("admin.error")}</p>}
      {reports && reports.length > 0 && (
        <div className={styles.filters} role="group">
          {(["all", ...reportStatuses] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setShown(PAGE); }}>
              {t(value === "all" ? "userReport.admin.filterAll" : `userReport.admin.status.${value}`)}
            </button>
          ))}
        </div>
      )}
      {reports?.length === 0 && <p className={shared.empty}>{t("userReport.admin.empty")}</p>}
      {visible.length > 0 && (
        <ul className={shared.people}>
          {visible.slice(0, shown).map((report) => (
            <li key={report.id} className={styles.report} data-status={report.status} data-testid="admin-report">
              <p className={styles.meta}>
                <span className={styles.status}>{t(`userReport.admin.status.${report.status}`)}</span>
                <span>{t(`userReport.kinds.${report.kind}`)}</span>
                <span>{formatDateTime(report.at, locale)}</span>
              </p>
              <p className={styles.message}>{report.message}</p>
              <small className={styles.details}>
                {[
                  report.email ?? report.contact ?? t(hidden ? "userReport.admin.contactHidden" : "userReport.admin.anonymous"),
                  report.screen && t("userReport.admin.screen", { screen: report.screen }),
                  report.appVersion,
                  report.device,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              <div className={styles.actions}>
                {report.status === "new" && (
                  <Button variant="secondary" onClick={() => void mark(report.id, "read")}>
                    {t("userReport.admin.markRead")}
                  </Button>
                )}
                {report.status !== "done" && (
                  <Button variant="secondary" onClick={() => void mark(report.id, "done")}>
                    {t("userReport.admin.markDone")}
                  </Button>
                )}
                {report.status !== "new" && (
                  <Button variant="ghost" onClick={() => void mark(report.id, "new")}>
                    {t("userReport.admin.markNew")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {visible.length > shown && (
        <Button variant="ghost" block onClick={() => setShown(shown + PAGE)}>
          {t("userReport.admin.more", { count: visible.length - shown })}
        </Button>
      )}
    </motion.section>
  );
}
