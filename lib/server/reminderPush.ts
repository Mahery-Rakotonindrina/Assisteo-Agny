import { AnalysisSchema, normalizeStoredAnalysis, type Analysis } from "@/lib/ai/schema";
import { seatLive, seatWins, shareableSeats } from "@/lib/familySeats";
import { activePlan, activeSubscription, defaultFeatureSettings, defaultPlansConfig, effectiveFeatures, type CustomPlan, type FeatureDiff, type FeatureGrant, type FeatureSettings, type PlansConfig, type SubscriptionPlanId } from "@/lib/plans";
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
/** `platform` "web": a browser's Web Push subscription in `token` (lib/webPush.ts); otherwise an FCM token. */
export type PushDevice = { user_id: string; device_id: string; token: string; scheduled: string[] | null; platform?: string | null };
export type PushChannel = "fcm" | "web";

/** How this device is reached: Web Push for a browser (iPhone home screen), FCM for the Android app. */
export function pushChannel(device: Pick<PushDevice, "platform">): PushChannel {
  return device.platform === "web" ? "web" : "fcm";
}

/** The devices whose channel is configured on the server (FCM, VAPID keys): the others are left alone, never dropped. */
export function reachableDevices<T extends Pick<PushDevice, "platform">>(devices: T[], enabled: Record<PushChannel, boolean>) {
  return devices.filter((device) => enabled[pushChannel(device)]);
}
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
 * The due reminders not handled yet, page after page: rows already pushed (or
 * set aside for a user without a paid plan) stay in the time window for a
 * while, and must not hide the ones still to send. At most `limit` rows, and
 * `maxPages` reads.
 */
export async function collectPending(fetchPage: (from: number, to: number) => Promise<DueRow[]>, limit: number, maxPages: number) {
  const pending: DueRow[] = [];
  for (let page = 0; page < maxPages && pending.length < limit; page += 1) {
    const rows = await fetchPage(page * limit, page * limit + limit - 1);
    pending.push(...rows.filter(isPending));
    if (rows.length < limit) break;
  }
  return pending.slice(0, limit);
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

/** `features`: the subscription's own (migration 0011), absent before it. `payment_method`: "trial" gives no family seat. */
export type SubscriptionRow = { email: string; plan: SubscriptionPlanId; starts_at: string; ends_at: string | null; payment_method?: string | null; features?: FeatureDiff | null };

/** A family seat (migration 0016), with its subscriber's other seats passed alongside to rank it. */
export type SeatRow = { id: string; ownerId: string; ownerEmail: string; memberEmail: string; createdAt: number; pending?: boolean };

/**
 * The users who may use reminders by the Admin settings (Lite and up by default, the Premium trial
 * included) right now: only they get reminder pushes, and only their
 * recurring reminders move on. Subscriptions are kept by e-mail; a
 * subscription's own features and the features offered for a while count,
 * and so does a family seat (`seats`: those of the users and every seat of
 * their subscribers), as `resolvePlan` reckons it.
 */
export function paidReminderUsers(
  users: Array<{ id: string; email: string | null }>,
  subscriptions: SubscriptionRow[],
  now: number,
  config: FeatureSettings & { customPlans?: readonly CustomPlan[]; offers?: PlansConfig["offers"] } = defaultFeatureSettings,
  grants: ReadonlyArray<Pick<FeatureGrant, "email" | "feature" | "startsAt" | "endsAt">> = [],
  seats: readonly SeatRow[] = [],
) {
  const byEmail = new Map<string, SubscriptionRow[]>();
  for (const row of subscriptions) {
    const email = row.email.toLowerCase();
    byEmail.set(email, [...(byEmail.get(email) ?? []), row]);
  }
  const created = config.customPlans ?? [];
  const access = (email: string) => {
    const rows = (byEmail.get(email) ?? []).map((row) => ({ plan: row.plan, startsAt: row.starts_at, endsAt: row.ends_at, paymentMethod: row.payment_method ?? null, features: row.features ?? null }));
    return { current: activePlan(rows, now, created), subscription: activeSubscription(rows, now, created) };
  };
  const offers = { offers: config.offers ?? defaultPlansConfig.offers, customPlans: config.customPlans };
  const paid = new Set<string>();
  for (const user of users) {
    const email = user.email?.toLowerCase() ?? null;
    let { current, subscription } = access(email ?? "");
    // A family seat: the subscriber's plan, while it runs and gives this seat, when better than the user's own.
    const seat = email ? seats.find((entry) => !entry.pending && entry.memberEmail.toLowerCase() === email) : undefined;
    if (seat) {
      const owner = access(seat.ownerEmail.toLowerCase());
      const { seats: count } = shareableSeats(offers, owner.current, owner.subscription?.paymentMethod);
      const live = seatLive(seats.filter((entry) => entry.ownerId === seat.ownerId), seat.id, count);
      if (live && seatWins(current, owner.current, created)) {
        current = owner.current;
        subscription = null;
      }
    }
    const offered = email ? grants.filter((grant) => grant.email.toLowerCase() === email) : [];
    if (effectiveFeatures({ plan: current.plan, custom: current.custom, email: user.email, config, subscription, grants: offered, now }).has("reminders")) paid.add(user.id);
  }
  return paid;
}
