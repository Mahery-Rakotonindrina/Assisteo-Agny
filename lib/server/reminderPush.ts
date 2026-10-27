import { AnalysisSchema, normalizeStoredAnalysis, type Analysis } from "@/lib/ai/schema";
import { activePlan, hasFeature, type PaidPlanId } from "@/lib/plans";
import { nextOccurrence, parseRepeat } from "@/lib/reminderRepeat";

// Decides which reminder pushes to send: pure, so it can be tested without
// Supabase or Firebase (the cron route does the I/O).

export type DueRow = {
  user_id: string;
  id: string;
  analysis: unknown;
  reminder_at: string;
  reminder_pushed_at: string | null;
  /** The synced user fields, among them reminderRepeat (see services/sync.ts). */
  meta?: { reminderRepeat?: unknown } | null;
};
export type PushDevice = { user_id: string; device_id: string; token: string; scheduled: string[] | null };
export type PushLocale = "fr" | "en";
export type PlannedPush = { device: PushDevice; entryId: string; title: string; body: string };

const texts = {
  fr: {
    body: "Tu m’as demandé de te le rappeler.",
    insuranceTitle: (name: string) => `Assurance : ${name}`,
    insuranceBody: (date: string) => `Ton assurance arrive à échéance le ${date}. Pense à la renouveler.`,
  },
  en: {
    body: "You asked me to remind you.",
    insuranceTitle: (name: string) => `Insurance: ${name}`,
    insuranceBody: (date: string) => `Your insurance expires on ${date}. Remember to renew it.`,
  },
};

export function reminderMessage(analysis: Analysis, locale: PushLocale) {
  const t = texts[locale];
  const expires = analysis.document?.isInsurance ? analysis.document.expiresOn : null;
  if (expires) {
    const date = new Date(`${expires}T12:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    return { title: t.insuranceTitle(analysis.title), body: t.insuranceBody(date) };
  }
  return { title: analysis.reminder?.title ?? analysis.title, body: analysis.reminder?.body ?? t.body };
}

/** Not pushed yet for this reminder time (the reminder may have been moved since the last push). */
export function isPending(row: DueRow) {
  return !row.reminder_pushed_at || new Date(row.reminder_pushed_at).getTime() < new Date(row.reminder_at).getTime();
}

/**
 * Whether this device shows the reminder by itself. Devices list "id@time"
 * (older apps: just the id), so a recurring reminder that already fired there
 * is pushed again for its next occurrence.
 */
export function holdsReminder(device: PushDevice, row: DueRow) {
  const scheduled = device.scheduled ?? [];
  return scheduled.includes(row.id) || scheduled.includes(`${row.id}@${new Date(row.reminder_at).getTime()}`);
}

/**
 * A recurring reminder that came due: when its next occurrence is, so it goes
 * on even if the app isn't opened. Null for a one-off reminder.
 */
export function nextReminderAt(row: Pick<DueRow, "reminder_at" | "meta">, now: number) {
  const repeat = parseRepeat(row.meta?.reminderRepeat);
  if (!repeat) return null;
  return new Date(nextOccurrence(repeat, Math.max(now, new Date(row.reminder_at).getTime()))).toISOString();
}

/**
 * One push per due reminder and per device of its owner that doesn't already
 * hold it as a local notification.
 */
export function planPushes(rows: DueRow[], devices: PushDevice[], locales: Map<string, PushLocale>): PlannedPush[] {
  const planned: PlannedPush[] = [];
  for (const row of rows) {
    if (!isPending(row)) continue;
    const analysis = AnalysisSchema.safeParse(normalizeStoredAnalysis(row.analysis));
    if (!analysis.success) continue;
    const message = reminderMessage(analysis.data, locales.get(row.user_id) ?? "fr");
    for (const device of devices) {
      if (device.user_id !== row.user_id || holdsReminder(device, row)) continue;
      planned.push({ device, entryId: row.id, ...message });
    }
  }
  return planned;
}

export type SubscriptionRow = { email: string; plan: PaidPlanId; starts_at: string; ends_at: string | null };

/**
 * The users whose plan includes reminders (Lite and up, the Premium trial
 * included) right now: only they get reminder pushes, and only their
 * recurring reminders move on. Subscriptions are kept by e-mail.
 */
export function paidReminderUsers(users: Array<{ id: string; email: string | null }>, subscriptions: SubscriptionRow[], now: number) {
  const byEmail = new Map<string, SubscriptionRow[]>();
  for (const row of subscriptions) {
    const email = row.email.toLowerCase();
    byEmail.set(email, [...(byEmail.get(email) ?? []), row]);
  }
  const paid = new Set<string>();
  for (const user of users) {
    const rows = user.email ? (byEmail.get(user.email.toLowerCase()) ?? []) : [];
    const { plan } = activePlan(
      rows.map((row) => ({ plan: row.plan, startsAt: row.starts_at, endsAt: row.ends_at })),
      now,
    );
    if (hasFeature(plan, "reminders")) paid.add(user.id);
  }
  return paid;
}
