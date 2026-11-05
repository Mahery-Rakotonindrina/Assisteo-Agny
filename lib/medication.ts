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
};

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
  return [...reminders.values()].sort((a, b) => a.at - b.at || a.entryId.localeCompare(b.entryId));
}

export const doseKey = (entryId: string, at: number) => `${entryId}@${at}`;
