import { byKind, newBudgetAlerts, nextDueReminder, type BudgetLevel, type BudgetLine, type DueAlert, type ExpenseRecord } from "@/lib/expenses";
import { nextTontineReminder, type TontineAlert } from "@/lib/savings";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";

// "Mes dépenses" notifications: a recurring expense's due date (the day
// before or the day itself, at 9:00), a tontine's payment (the day before,
// at 9:00), and the budget reaching 80 % then
// going over. Same scheme as services/vehicleReminders.ts: the ids scheduled
// on this device are kept here, not in the records.

/** Marks a tapped notification as an expense's: it opens "Mes dépenses". */
export const EXPENSE_NOTIFICATION_PREFIX = "expense:";

const STORAGE_KEY = "expense-reminders.v1";
const ALERTS_KEY = "expense-budget-alerts.v1";

/** What this device has scheduled, by recurring id (`tontine:<id>` for a tontine). */
export type ScheduledExpenseReminders = Record<string, { id: number; at: number; text: string }>;

type Texts = { title: string; body: string };

export type ExpenseReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  /** Ids still to come; null when unknown (then the saved state is trusted). */
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledExpenseReminders;
  save: (scheduled: ScheduledExpenseReminders) => void;
};

/** A recurring expense's due date, or a tontine's next payment. */
export type ExpenseAlert = DueAlert | TontineAlert;

export type ExpenseReminderTexts = (alert: ExpenseAlert) => Texts;

/** The reminders wanted now, by recurring id; none while the plan doesn't include them. */
export function plannedExpenseReminders(records: ExpenseRecord[], now: number, enabled = true) {
  const planned = new Map<string, ExpenseAlert>();
  if (!enabled) return planned;
  for (const recurring of byKind(records, "recurring")) {
    const alert = nextDueReminder(recurring, records, now);
    if (alert) planned.set(recurring.id, alert);
  }
  for (const tontine of byKind(records, "tontine")) {
    const alert = nextTontineReminder(tontine, now);
    if (alert) planned.set(`tontine:${tontine.id}`, alert);
  }
  return planned;
}

/**
 * Brings the scheduled notifications in line with the recurring expenses and
 * the plan: cancels the ones no longer wanted, schedules the missing ones.
 * Never asks for permission: without it, nothing happens.
 */
export async function reconcileExpenseReminderState(
  records: ExpenseRecord[],
  texts: ExpenseReminderTexts,
  deps: ExpenseReminderDeps,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  if ((await deps.permission()) !== "granted") return;
  const planned = plannedExpenseReminders(records, now, enabled);
  const scheduled = deps.load();
  const pending = await deps.pending();
  const next: ScheduledExpenseReminders = {};

  for (const [key, current] of Object.entries(scheduled)) {
    const wanted = planned.get(key);
    const stillThere = !pending || pending.has(current.id);
    const text = wanted && texts(wanted);
    if (wanted && text && stillThere && wanted.at === current.at && text.body === current.text) next[key] = current;
    else await deps.cancel(current.id);
  }

  for (const [key, alert] of planned) {
    if (next[key]) continue;
    const text = texts(alert);
    const id = await deps.notify({ ...text, at: new Date(alert.at), entryId: EXPENSE_NOTIFICATION_PREFIX + key });
    if (id !== null) next[key] = { id, at: alert.at, text: text.body };
  }

  deps.save(next);
}

const readJson = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: done again next time.
  }
};

const deviceDeps: ExpenseReminderDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => readJson<ScheduledExpenseReminders>(STORAGE_KEY, {}),
  save: (scheduled) => writeJson(STORAGE_KEY, scheduled),
};

/** Reconciles this device's due-date notifications. */
export function reconcileExpenseReminders(records: ExpenseRecord[], texts: ExpenseReminderTexts, enabled: boolean) {
  return reconcileExpenseReminderState(records, texts, deviceDeps, { enabled }).catch(() => undefined);
}

/**
 * Notifies the budget alerts not yet notified this month (80 %, then over),
 * once each. The level seen is remembered per month on this device.
 */
export async function notifyBudgetAlerts(month: string, lines: BudgetLine[], text: (line: BudgetLine) => Texts) {
  const seen = readJson<{ month?: string; levels?: Record<string, BudgetLevel> }>(ALERTS_KEY, {});
  const levels = seen.month === month ? (seen.levels ?? {}) : {};
  const fresh = newBudgetAlerts(lines, levels);
  if (fresh.length === 0) return;
  if ((await getNotificationPermission().catch(() => "denied")) !== "granted") return;
  for (const line of fresh) {
    await notify({ ...text(line), entryId: `${EXPENSE_NOTIFICATION_PREFIX}budget` }).catch(() => null);
    levels[line.scope] = line.level;
  }
  writeJson(ALERTS_KEY, { month, levels });
}
