import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Bell, BellOff, Sparkles, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDateTime } from "@/lib/format";
import { spring } from "@/lib/motion";
import styles from "./ReminderSheet.module.scss";

type ReminderSheetProps = {
  open: boolean;
  /** The reminder already scheduled, if any. */
  current?: number;
  /** The AI's suggested delay, in hours from now. */
  suggestedHours?: number;
  onSchedule: (at: number) => Promise<void> | void;
  onCancelReminder: () => Promise<void> | void;
  onClose: () => void;
};

const pad = (value: number) => String(value).padStart(2, "0");
const toDateInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Lets the user pick exactly when a reminder fires: a shortcut, or any date and time. */
export function ReminderSheet({ open, current, suggestedHours, onSchedule, onCancelReminder, onClose }: ReminderSheetProps) {
  const { t, locale } = useTranslation();
  const [now] = useState(() => Date.now());
  const initial = useMemo(() => new Date(current ?? now + (suggestedHours ?? 1) * 3_600_000), [current, now, suggestedHours]);
  const [day, setDay] = useState(toDateInput(initial));
  const [time, setTime] = useState(toTimeInput(initial));
  const [busy, setBusy] = useState(false);
  const clock = useNow(15_000);

  const presets = useMemo(() => {
    const at = (days: number, hours: number) => {
      const date = new Date(now);
      date.setDate(date.getDate() + days);
      date.setHours(hours, 0, 0, 0);
      return date;
    };
    const tonight = at(0, 19);
    return [
      { id: "hour", label: t("reminders.inOneHour"), date: new Date(now + 3_600_000) },
      tonight.getTime() > now + 15 * 60_000
        ? { id: "tonight", label: t("reminders.tonight"), date: tonight }
        : { id: "tomorrowEvening", label: t("reminders.tomorrowEvening"), date: at(1, 19) },
      { id: "tomorrow", label: t("reminders.tomorrowMorning"), date: at(1, 9) },
      { id: "week", label: t("reminders.nextWeek"), date: at(7, 9) },
      ...(suggestedHours ? [{ id: "ai", label: t("reminders.aiSuggestion"), date: new Date(now + suggestedHours * 3_600_000), ai: true }] : []),
    ];
  }, [now, suggestedHours, t]);

  const chosen = useMemo(() => {
    const [year, month, date] = day.split("-").map(Number);
    const [hours, minutes] = time.split(":").map(Number);
    const value = new Date(year, (month ?? 1) - 1, date ?? 1, hours ?? 9, minutes ?? 0);
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }, [day, time]);
  const inPast = chosen !== null && chosen <= clock + 30_000;

  const pick = (date: Date) => {
    setDay(toDateInput(date));
    setTime(toTimeInput(date));
  };

  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className={styles.sheet}
            role="dialog"
            aria-modal
            aria-labelledby="reminder-title"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={spring}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.top}>
              <h2 id="reminder-title">
                <Bell size={20} /> {current ? t("reminders.editTitle") : t("reminders.title")}
              </h2>
              <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t("common.cancel")}>
                <X size={20} />
              </button>
            </div>

            <div className={styles.presets}>
              {presets.map((preset) => {
                const active = chosen !== null && Math.abs(chosen - preset.date.getTime()) < 60_000;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`${styles.preset} ${active ? styles.active : ""} ${"ai" in preset ? styles.ai : ""}`}
                    onClick={() => pick(preset.date)}
                  >
                    {"ai" in preset && <Sparkles size={14} />}
                    <span>{preset.label}</span>
                    <small>{formatDateTime(preset.date.getTime(), locale)}</small>
                  </button>
                );
              })}
            </div>

            <div className={styles.custom}>
              <label className={styles.field}>
                <span>{t("reminders.date")}</span>
                <input id="reminder-day" type="date" value={day} min={toDateInput(new Date(now))} onChange={(event) => setDay(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>{t("reminders.time")}</span>
                <input id="reminder-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
            </div>

            <p className={inPast ? styles.error : styles.summary} role="status">
              {chosen === null
                ? t("reminders.invalid")
                : inPast
                  ? t("reminders.past")
                  : t("reminders.willFire", { date: formatDateTime(chosen, locale) })}
            </p>

            <div className={styles.actions}>
              <Button size="lg" block icon={<Bell />} disabled={busy || chosen === null || inPast} onClick={() => chosen && void run(() => onSchedule(chosen))}>
                {current ? t("reminders.update") : t("reminders.schedule")}
              </Button>
              {current && (
                <Button variant="ghost" block icon={<BellOff />} disabled={busy} onClick={() => void run(onCancelReminder)}>
                  {t("reminders.cancel")}
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
