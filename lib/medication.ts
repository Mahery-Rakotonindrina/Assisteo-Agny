// Doses to take, from a scanned prescription or medicine box: the plan the
// user confirmed (each medicine, its times of day and how many days), and
// the moments to remind them. Pure, so it can be tested; scheduled by
// services/medicationReminders.ts.

/** One medicine of the plan, as the user confirmed it. */
export type MedicationCourse = {
  name: string;
  /** The dosage as written (shown in the notification), if any. */
  dose?: string;
  /** Times of day, "HH:mm", sorted. */
  times: string[];
  /** Days of treatment, from the plan's first day. */
  days: number;
};

/** The reminders of a scan, kept on its history entry (synced with the account). */
export type MedicationPlan = {
  /** First day, "YYYY-MM-DD". */
  start: string;
  courses: MedicationCourse[];
  createdAt: number;
  /** The doses ticked "J'ai pris": the moments (as in the reminders), at most MAX_TAKEN. */
  taken?: number[];
  /** The prescription says it can be renewed: the last-day notice adds "pense à racheter". */
  renew?: boolean;
};

/** The longest course a plan accepts (a long treatment is set again later). */
export const MAX_DAYS = 90;
/** At most this many doses a day per medicine. */
export const MAX_TIMES = 6;
/** How far ahead the doses are scheduled (redone when the app opens and at each change). */
export const HORIZON_DAYS = 7;

const DAY = 86_400_000;

/** Usual times for so many doses a day: "matin et soir" = 08:00 and 20:00. */
export function defaultTimes(timesPerDay: number | null | undefined): string[] {
  switch (timesPerDay) {
    case 2:
      return ["08:00", "20:00"];
    case 3:
      return ["08:00", "13:00", "20:00"];
    case 4:
      return ["07:00", "12:00", "17:00", "22:00"];
    default:
      return ["08:00"];
  }
}

/** "8:05" or "08:05" → { hour: 8, minute: 5 }; null when not a time. */
export function parseTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

const dayParts = (day: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1, date: Number(match[3]) } : null;
};

/** A course as it can be saved: a name, valid times (each once, sorted), 1 to MAX_DAYS days; null otherwise. */
export function cleanCourse(course: MedicationCourse): MedicationCourse | null {
  const name = course.name.trim().slice(0, 80);
  const times = [...new Set(course.times.map((time) => parseTime(time)).filter((time) => time !== null).map(({ hour, minute }) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`))]
    .sort()
    .slice(0, MAX_TIMES);
  const days = Math.floor(course.days);
  if (!name || times.length === 0 || !(days >= 1 && days <= MAX_DAYS)) return null;
  return { name, ...(course.dose?.trim() && { dose: course.dose.trim().slice(0, 120) }), times, days };
}

/** Every dose of a course, as local times, in order. */
function courseDoses(start: string, course: MedicationCourse) {
  const first = dayParts(start);
  if (!first) return [];
  const doses: number[] = [];
  for (let day = 0; day < course.days; day += 1) {
    for (const time of course.times) {
      const parsed = parseTime(time);
      if (parsed) doses.push(new Date(first.year, first.month, first.date + day, parsed.hour, parsed.minute).getTime());
    }
  }
  return doses;
}

/** When the last dose of the plan is taken; null without any dose. */
export function planEnd(plan: MedicationPlan) {
  const doses = plan.courses.flatMap((course) => courseDoses(plan.start, course));
  return doses.length ? Math.max(...doses) : null;
}

/** Whether doses are still to come. */
export const isActive = (plan: MedicationPlan, now: number) => (planEnd(plan) ?? 0) > now;

export type DoseReminder = {
  /** The scan the plan belongs to. */
  entryId: string;
  at: number;
  /** The medicines of that moment, with their dose. */
  medicines: Array<{ name: string; dose?: string }>;
  /** "lastDay": the evening before the last day of treatment (its medicines, and whether to buy more). */
  kind?: "lastDay";
  /** lastDay: the prescription can be renewed. */
  renew?: boolean;
};

/** Ticked doses kept at most (a 90-day course at 6 a day would be more: the oldest go first). */
export const MAX_TAKEN = 400;
/** The last-day notice: the evening before, at this hour. */
export const LAST_DAY_HOUR = 19;
/** How far back "this week" counts the doses taken. */
const WEEK = 7 * DAY;

/** Every moment of the plan (doses at the same time are one moment), with its medicines, in order. */
export function doseMoments(plan: MedicationPlan) {
  const moments = new Map<number, Array<{ name: string; dose?: string }>>();
  for (const course of plan.courses) {
    for (const at of courseDoses(plan.start, course)) moments.set(at, [...(moments.get(at) ?? []), { name: course.name, ...(course.dose && { dose: course.dose }) }]);
  }
  return [...moments.entries()].sort(([a], [b]) => a - b).map(([at, medicines]) => ({ at, medicines }));
}

/** The plan with this moment ticked "J'ai pris" (once; the oldest dropped past MAX_TAKEN). */
export function withTaken(plan: MedicationPlan, at: number): MedicationPlan {
  const taken = [...new Set([...(plan.taken ?? []), at])].sort((a, b) => a - b).slice(-MAX_TAKEN);
  return { ...plan, taken };
}

/** The doses due in the last 7 days (now included) and how many were ticked: "12 prises sur 14 cette semaine". */
export function weekAdherence(plan: MedicationPlan, now: number) {
  const taken = new Set(plan.taken ?? []);
  const due = doseMoments(plan).filter(({ at }) => at <= now && at > now - WEEK);
  return { due: due.length, taken: due.filter(({ at }) => taken.has(at)).length };
}

export type DoseState = "taken" | "missed" | "upcoming";

/** Today's moments and where each stands: ticked, gone by without a tick, or still to come. */
export function todayDoses(plan: MedicationPlan, now: number) {
  const day = new Date(now);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const taken = new Set(plan.taken ?? []);
  return doseMoments(plan)
    .filter(({ at }) => at >= start && at < end)
    .map(({ at, medicines }) => ({ at, medicines, state: (taken.has(at) ? "taken" : at <= now ? "missed" : "upcoming") as DoseState }));
}

/**
 * The evening before the last day of treatment, at LAST_DAY_HOUR: when to
 * say "Dernier jour demain". Null for a one-day plan, or without doses.
 */
export function lastDayNotice(plan: MedicationPlan) {
  const end = planEnd(plan);
  const first = doseMoments(plan)[0]?.at;
  if (end === null || first === undefined) return null;
  const last = new Date(end);
  const notice = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 1, LAST_DAY_HOUR).getTime();
  // Before the treatment's first day: nothing to say (it lasts a day).
  return notice > first ? notice : null;
}

/**
 * The doses of the next HORIZON_DAYS, one reminder per scan and moment (two
 * medicines at 08:00 are one notification). None when disabled.
 */
export function doseReminders(entries: Array<{ id: string; medication?: MedicationPlan }>, now: number, enabled = true): DoseReminder[] {
  if (!enabled) return [];
  const until = now + HORIZON_DAYS * DAY;
  const reminders = new Map<string, DoseReminder>();
  for (const entry of entries) {
    if (!entry.medication) continue;
    // The evening before the last day: which medicines end, and whether to buy more.
    const notice = lastDayNotice(entry.medication);
    if (notice !== null && notice > now && notice <= until) {
      reminders.set(`${doseKey(entry.id, notice)}:last`, {
        entryId: entry.id,
        at: notice,
        kind: "lastDay",
        medicines: entry.medication.courses.map((course) => ({ name: course.name })),
        ...(entry.medication.renew && { renew: true }),
      });
    }
    for (const course of entry.medication.courses) {
      for (const at of courseDoses(entry.medication.start, course)) {
        if (at <= now || at > until) continue;
        const key = doseKey(entry.id, at);
        const reminder = reminders.get(key) ?? { entryId: entry.id, at, medicines: [] };
        reminder.medicines.push({ name: course.name, ...(course.dose && { dose: course.dose }) });
        reminders.set(key, reminder);
      }
    }
  }
  return [...reminders.values()].sort((a, b) => a.at - b.at || a.entryId.localeCompare(b.entryId) || (a.kind ?? "").localeCompare(b.kind ?? ""));
}

export const doseKey = (entryId: string, at: number) => `${entryId}@${at}`;

/** A reminder's own key (a dose and the last-day notice may fall at the same time). */
export const reminderKey = (reminder: Pick<DoseReminder, "entryId" | "at" | "kind">) => `${doseKey(reminder.entryId, reminder.at)}${reminder.kind === "lastDay" ? ":last" : ""}`;

/** A medicine name the scan could read: unreadable names come back empty, and are never replaced by a plausible one. */
export const hasReadableName = (name: string) => name.trim().length > 0;

/** What the scan could not read, without its closing punctuation (the text around adds its own). */
export const unreadableNote = (text: string) => text.trim().replace(/[\s.!?…:;,]+$/u, "");
