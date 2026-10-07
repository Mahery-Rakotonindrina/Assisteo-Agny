import { AnalysisSchema, normalizeStoredAnalysis, type Analysis } from "@/lib/ai/schema";

// Decides which reminder pushes to send: pure, so it can be tested without
// Supabase or Firebase (the cron route does the I/O).

export type DueRow = { user_id: string; id: string; analysis: unknown; reminder_at: string; reminder_pushed_at: string | null };
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
      if (device.user_id !== row.user_id || device.scheduled?.includes(row.id)) continue;
      planned.push({ device, entryId: row.id, ...message });
    }
  }
  return planned;
}
