import { doseReminders, isActive, planEnd, type DoseReminder, type MedicationPlan } from "@/lib/medication";

// "Ma santé": the treatments being taken (dose reminders still to come) and
// the prescriptions and medicine boxes scanned. Read from the history, where
// the scans and their dose plans already live (synced): nothing stored apart.
// Pure, so it can be tested; the screen is pages/sante.tsx.

type Scan = { id: string; createdAt: number; analysis: { medicine?: { items: unknown[] } | null }; medication?: MedicationPlan };

export type Treatment<T extends Scan> = {
  entry: T;
  /** When the last dose is taken. */
  end: number;
  /** Days left, today included (1 on the last day). */
  daysLeft: number;
  /** The next dose: when, and which medicines. Null if none comes in the next days. */
  next: DoseReminder | null;
};

const DAY = 86_400_000;
const startOfDay = (at: number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** A prescription or a medicine box, or a scan with a dose plan. */
export const isHealthScan = (entry: Scan) => Boolean(entry.analysis.medicine) || Boolean(entry.medication);

/**
 * What "Ma santé" shows: the treatments in progress, the next dose first, and
 * every prescription or box scanned, the latest first.
 */
export function healthOverview<T extends Scan>(entries: T[], now: number) {
  const scans = entries.filter(isHealthScan).sort((a, b) => b.createdAt - a.createdAt);
  const treatments: Treatment<T>[] = [];
  for (const entry of scans) {
    if (!entry.medication || !isActive(entry.medication, now)) continue;
    const end = planEnd(entry.medication)!;
    // The next dose (not the last-day notice, also among the reminders).
    const next = doseReminders([{ id: entry.id, medication: entry.medication }], now).find((reminder) => !reminder.kind) ?? null;
    treatments.push({ entry, end, daysLeft: Math.round((startOfDay(end) - startOfDay(now)) / DAY) + 1, next });
  }
  treatments.sort((a, b) => (a.next?.at ?? Infinity) - (b.next?.at ?? Infinity));
  return { treatments, scans };
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** One treatment for sharing: its title, then one line per medicine (dose, times, until when). */
export function treatmentLines<T extends Scan & { analysis: { title: string } }>(treatment: Treatment<T>, t: Translate, formatDay: (at: number) => string) {
  const plan = treatment.entry.medication!;
  return {
    title: treatment.entry.analysis.title,
    lines: plan.courses.map((course) =>
      t("health.share.line", { name: course.name, dose: course.dose ?? t("medicine.notWritten"), times: course.times.join(", "), date: formatDay(treatment.end) }),
    ),
  };
}

/**
 * "Partager mes traitements": the treatments in progress as plain text (to a
 * relative, a doctor), with the medical warning. Only what the plans say:
 * nothing else from the app.
 */
export function treatmentsText<T extends Scan & { analysis: { title: string } }>(treatments: Array<Treatment<T>>, t: Translate, formatDay: (at: number) => string) {
  const blocks = treatments.map((treatment) => {
    const { title, lines } = treatmentLines(treatment, t, formatDay);
    return [title, ...lines.map((line) => `- ${line}`)].join("\n");
  });
  return [t("health.share.heading"), ...blocks, t("medicine.disclaimer")].join("\n\n");
}
