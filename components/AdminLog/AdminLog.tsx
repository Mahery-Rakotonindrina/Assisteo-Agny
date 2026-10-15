import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/Button";
import shared from "@/components/AdminSubscriptions/AdminSubscriptions.module.scss";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDateTime } from "@/lib/format";
import { rise } from "@/lib/motion";
import type { AdminLogEntry } from "@/lib/server/adminLog";
import type { AdminLogResponse } from "@/pages/api/admin/log";
import { httpClient } from "@/services/httpClient";

const PAGE = 30;

/** Owner only: what was done in /admin, and by whom, newest first. */
export function AdminLog({ token }: { token: string }) {
  const { t, locale } = useTranslation();
  const [entries, setEntries] = useState<AdminLogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let cancelled = false;
    httpClient
      .get<AdminLogResponse>("/api/admin/log", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        if (!cancelled) setEntries(result.entries);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const who = (actor: string) => (actor === "owner" ? t("admin.log.owner") : actor === "github" ? t("admin.log.github") : actor);

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={shared.card}>
      <div>
        <h2 className={shared.title}>
          <History size={18} /> {t("admin.log.title")}
        </h2>
        <p className={shared.subtitle}>{t("admin.log.subtitle")}</p>
      </div>
      {failed && <p className={shared.error}>{t("admin.error")}</p>}
      {entries?.length === 0 && <p className={shared.empty}>{t("admin.log.empty")}</p>}
      {entries && entries.length > 0 && (
        <ul className={shared.people}>
          {entries.slice(0, shown).map((entry, index) => (
            <li key={`${entry.at}-${index}`} className={shared.person}>
              <div className={shared.personSummary}>
                <span className={shared.personText}>
                  <strong>{t(`admin.log.actions.${entry.action}`)}</strong>
                  <small>{[formatDateTime(entry.at, locale), who(entry.actor), entry.detail].filter(Boolean).join(" · ")}</small>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {entries && entries.length > shown && (
        <Button variant="ghost" block onClick={() => setShown(shown + PAGE)}>
          {t("admin.log.more", { count: entries.length - shown })}
        </Button>
      )}
    </motion.section>
  );
}
