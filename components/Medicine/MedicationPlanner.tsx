import { useState } from "react";
import { BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanLock } from "@/components/PlanLock";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import type { Analysis } from "@/lib/ai/schema";
import { formatDate, toDateInput } from "@/lib/format";
import { cleanCourse, defaultTimes, hasReadableName, isActive, MAX_DAYS, planEnd, type MedicationCourse, type MedicationPlan } from "@/lib/medication";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { requestNotificationPermission } from "@/services/notifications";
import type { HistoryEntry } from "@/types/history";
import styles from "./Medicine.module.scss";

type Medicine = NonNullable<Analysis["medicine"]>;
type Draft = { on: boolean; /** The name was not readable: the person types it. */ typed: boolean; name: string; dose: string; times: string[]; days: string };

const PER_DAY = [1, 2, 3, 4] as const;

/**
 * "Me rappeler les prises": the user confirms each medicine, its times and
 * how many days, before anything is scheduled. With the reminders (Lite and
 * up); otherwise the plan that has them.
 */
export function MedicationPlanner({ entry, medicine }: { entry: HistoryEntry; medicine: Medicine }) {
  const { t, locale } = useTranslation();
  const { has, planFor, name: planName } = usePlan();
  const now = useNow(60_000);
  const toast = useToast();
  const [stopping, setStopping] = useState(false);

  if (!has("reminders")) {
    // No plan sells the reminders now: PlanLock then says so by itself.
    const lockedPlan = planFor("reminders");
    return <PlanLock plan={planFor("reminders")} text={lockedPlan ? t("medicine.locked", { plan: planName(lockedPlan) }) : ""} />;
  }

  const plan = entry.medication;
  if (plan && isActive(plan, now)) {
    const end = planEnd(plan)!;
    const stop = async () => {
      if (!stopping) {
        setStopping(true);
        return;
      }
      haptics.press();
      await historyStore.update(entry.id, { medication: undefined });
      toast(t("medicine.stopped"));
    };
    return (
      <div className={styles.planner} data-testid="medication-active">
        <p className={styles.active}>
          <BellRing size={16} /> {t("medicine.activeUntil", { date: formatDate(end, locale) })}
        </p>
        <ul className={styles.courses}>
          {plan.courses.map((course) => (
            <li key={course.name}>
              <strong>{course.name}</strong>
              <span>{t("medicine.courseLine", { times: course.times.join(", "), count: course.days })}</span>
            </li>
          ))}
        </ul>
        <Button variant={stopping ? "danger" : "secondary"} icon={<BellOff />} onClick={() => void stop()}>
          {stopping ? t("medicine.confirmStop") : t("medicine.stop")}
        </Button>
      </div>
    );
  }

  return <PlannerForm entry={entry} medicine={medicine} />;
}

function PlannerForm({ entry, medicine }: { entry: HistoryEntry; medicine: Medicine }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [start, setStart] = useState(() => toDateInput(Date.now()));
  // Ticked only when the prescription itself says how often and how long.
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    medicine.items.map((item) => ({
      // Never ticked for a name the scan could not read, until the person types it and ticks it.
      on: hasReadableName(item.name) && Boolean(item.timesPerDay && item.durationDays),
      typed: !hasReadableName(item.name),
      name: item.name,
      dose: item.dose ?? "",
      times: defaultTimes(item.timesPerDay),
      days: item.durationDays ? String(item.durationDays) : "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const set = (index: number, patch: Partial<Draft>) => setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  const courses = drafts
    .filter((draft) => draft.on)
    .map((draft) => cleanCourse({ name: draft.name, dose: draft.dose, times: draft.times, days: Number(draft.days) }));
  const valid = courses.length > 0 && courses.every((course): course is MedicationCourse => course !== null) && /^\d{4}-\d{2}-\d{2}$/.test(start);

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const plan: MedicationPlan = { start, courses: courses as MedicationCourse[], createdAt: Date.now() };
      const permission = await requestNotificationPermission().catch(() => "denied" as const);
      await historyStore.update(entry.id, { medication: plan });
      haptics.success();
      const end = planEnd(plan);
      if (permission !== "granted") toast(t("medicine.savedNoNotifications"), "error");
      else toast(end ? t("medicine.saved", { date: formatDate(end, locale) }) : t("medicine.savedShort"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.planner} data-testid="medication-planner">
      <p className={styles.muted}>{t("medicine.plannerHint")}</p>
      <label className={styles.field}>
        <span>{t("medicine.start")}</span>
        <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
      </label>
      {drafts.map((draft, index) => (
        <fieldset key={index} className={styles.course} data-testid="medication-course">
          <label className={styles.check}>
            <input type="checkbox" checked={draft.on} disabled={!hasReadableName(draft.name)} onChange={(event) => set(index, { on: event.target.checked })} />
            <span>
              {draft.typed ? (
                <input
                  value={draft.name}
                  onChange={(event) => set(index, { name: event.target.value.slice(0, 80), ...(event.target.value.trim() ? {} : { on: false }) })}
                  placeholder={t("medicine.typeName")}
                  aria-label={t("medicine.typeName")}
                  data-testid="medication-name"
                />
              ) : (
                <strong>{draft.name}</strong>
              )}
              <small>{draft.dose || t("medicine.notWritten")}</small>
            </span>
          </label>
          {draft.on && (
            <>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>{t("medicine.perDay")}</span>
                  <select value={draft.times.length} onChange={(event) => set(index, { times: defaultTimes(Number(event.target.value)) })}>
                    {PER_DAY.map((count) => (
                      <option key={count} value={count}>
                        {t("medicine.perDayOption", { count })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{t("medicine.daysLabel")}</span>
                  <input
                    inputMode="numeric"
                    value={draft.days}
                    onChange={(event) => set(index, { days: event.target.value.replace(/\D/g, "").slice(0, 2) })}
                    placeholder={t("medicine.daysPlaceholder")}
                    aria-invalid={draft.days !== "" && !(Number(draft.days) >= 1 && Number(draft.days) <= MAX_DAYS)}
                  />
                </label>
              </div>
              <div className={styles.times}>
                {draft.times.map((time, timeIndex) => (
                  <label key={timeIndex} className={styles.field}>
                    <span>{t("medicine.timeLabel", { number: timeIndex + 1 })}</span>
                    <input type="time" value={time} onChange={(event) => set(index, { times: draft.times.map((value, i) => (i === timeIndex ? event.target.value : value)) })} />
                  </label>
                ))}
              </div>
              {!draft.days && <small className={styles.needDays}>{t("medicine.needDays")}</small>}
            </>
          )}
        </fieldset>
      ))}
      <Button icon={<BellRing />} onClick={() => void save()} disabled={!valid || saving} data-testid="medication-save">
        {t("medicine.create")}
      </Button>
    </div>
  );
}
