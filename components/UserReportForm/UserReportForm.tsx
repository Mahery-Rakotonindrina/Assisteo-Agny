import { useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { ChevronRight, MessageSquareHeart, Send } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useTranslation } from "@/hooks/useTranslation";
import { deviceLabel, REPORT_MESSAGE_MAX, type ReportKind, type UserReportRequest } from "@/lib/userReport";
import { authHeaders, getSession } from "@/services/account";
import { httpClient } from "@/services/httpClient";
import { previousScreen } from "@/services/lastScreen";
import { ApiError } from "@/types/api";
import styles from "./UserReportForm.module.scss";

/** Settings: "Give my feedback / Report a problem". Text only; opens as a row, then a small form. */
export function UserReportForm({ rowClassName, labelClassName, iconClassName }: { rowClassName: string; labelClassName: string; iconClassName: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const version = useAppVersion();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>("problem");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = () => {
    setOpen(true);
    // "Signed in" only counts with a confirmed e-mail: else the server sees an anonymous message, and a contact is needed.
    void getSession().then((session) => setSignedIn(Boolean(session?.user.email_confirmed_at)));
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (message.trim().length < 5) return toast(t("userReport.tooShort"), "error");
    setBusy(true);
    try {
      const body: UserReportRequest = {
        kind,
        message: message.trim(),
        contact: !signedIn && contact.trim() ? contact.trim() : undefined,
        screen: previousScreen() ?? undefined,
        appVersion: version.slice(0, 40),
        device: deviceLabel(navigator.userAgent, Capacitor.getPlatform()),
      };
      await httpClient.post<void>("/api/reports", body, { headers: await authHeaders() });
      toast(t("userReport.sent"), "success");
      setMessage("");
      setContact("");
      setOpen(false);
    } catch (error) {
      toast(t(error instanceof ApiError && error.status === 429 ? "userReport.tooMany" : "userReport.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={rowClassName} onClick={show} data-testid="report-open">
        <span className={iconClassName}>
          <MessageSquareHeart />
        </span>
        <span className={labelClassName}>{t("userReport.open")}</span>
        <ChevronRight size={16} />
      </button>
    );
  }

  return (
    <form className={styles.form} onSubmit={(event) => void send(event)} data-testid="report-form">
      <strong>{t("userReport.title")}</strong>
      <div className={styles.kinds} role="group" aria-label={t("userReport.kindLabel")}>
        {(["problem", "idea"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
            {t(`userReport.kinds.${value}`)}
          </button>
        ))}
      </div>
      <label className={styles.field}>
        <span className="visually-hidden">{t("userReport.messageLabel")}</span>
        <textarea
          rows={5}
          value={message}
          maxLength={REPORT_MESSAGE_MAX}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t(kind === "problem" ? "userReport.placeholderProblem" : "userReport.placeholderIdea")}
          data-testid="report-message"
        />
        <small>{message.length} / {REPORT_MESSAGE_MAX}</small>
      </label>
      {!signedIn && (
        <label className={styles.field}>
          <span className="visually-hidden">{t("userReport.contactLabel")}</span>
          <input type="text" autoComplete="off" value={contact} maxLength={120} onChange={(event) => setContact(event.target.value)} placeholder={t("userReport.contactLabel")} data-testid="report-contact" />
        </label>
      )}
      <p className={styles.hint}>{t(signedIn ? "userReport.hintSignedIn" : "userReport.hint")}</p>
      <div className={styles.actions}>
        <Button type="submit" icon={<Send />} disabled={busy || message.trim().length < 5} data-testid="report-send">
          {t("userReport.send")}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {t("userReport.cancel")}
        </Button>
      </div>
    </form>
  );
}
