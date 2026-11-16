import { APPOINTMENT_NOTIFICATION_PREFIX } from "@/lib/appointments";
import { LOAN_NOTIFICATION_PREFIX, loanTapTarget } from "@/lib/loanReminders";
import { EVENING_ENTRY_ID } from "./eveningReminder";
import { EXPENSE_NOTIFICATION_PREFIX } from "./expenseReminders";
import { PARCEL_NOTIFICATION_PREFIX } from "./parcelReminders";
import { PLANT_NOTIFICATION_PREFIX } from "./plantReminders";
import { MEDICATION_NOTIFICATION_PREFIX, medicationLink, TAKEN_ACTION, takenFromNotification } from "./medicationReminders";
import { isSnoozeAction } from "./reminders";
import { VEHICLE_NOTIFICATION_PREFIX } from "./vehicleReminders";
import { WEEKLY_ENTRY_ID } from "./weeklySummary";
import { HOME_ITEM_NOTIFICATION_PREFIX } from "./homeItemReminders";

// What a tapped local notification does. One listener only (useNativeBootstrap):
// when Android had closed the app, Capacitor hands the retained tap to the
// first listener alone, so the snooze buttons must be handled there too.

export type TapTarget = { pathname: string; query?: Record<string, string> };

type TapActions = {
  /** Puts the reminder off; the new time, or null when it couldn't be done. */
  snooze: (entryId: string, actionId: string, notificationId: number) => Promise<number | null>;
  open: (target: TapTarget) => void;
  snoozed?: (at: number) => void;
  /** "J'ai pris" on a dose notification: the dose was ticked. */
  taken?: () => void;
};

/** Where the notification itself leads: "Mes colis", the vehicle in "Mon garage", "Mes dépenses" (the add form for the evening one), the person in "Prêts", or the scan offering "remind me later". */
export function tapTarget(entryId: string): TapTarget {
  const loan = loanTapTarget(entryId);
  if (loan) return loan;
  if (entryId === WEEKLY_ENTRY_ID) return { pathname: "/" };
  if (entryId.startsWith(PARCEL_NOTIFICATION_PREFIX)) return { pathname: "/parcels" };
  if (entryId.startsWith(VEHICLE_NOTIFICATION_PREFIX)) return { pathname: "/garage", query: { open: entryId.slice(VEHICLE_NOTIFICATION_PREFIX.length) } };
  if (entryId.startsWith(HOME_ITEM_NOTIFICATION_PREFIX)) return { pathname: "/inventory", query: { open: entryId.slice(HOME_ITEM_NOTIFICATION_PREFIX.length) } };
  if (entryId.startsWith(PLANT_NOTIFICATION_PREFIX)) return { pathname: "/plants" };
  // A dose to take, or the last day: "Ma santé", the treatments in sight.
  // The scan says whose it is: "Ma santé" opens on that person (pages/sante.tsx, personFromLink).
  if (entryId.startsWith(MEDICATION_NOTIFICATION_PREFIX)) {
    const scanId = medicationLink(entryId)?.scanId;
    return scanId ? { pathname: "/sante", query: { scan: scanId } } : { pathname: "/sante" };
  }
  // A medical appointment: "Ma santé", its appointments.
  if (entryId.startsWith(APPOINTMENT_NOTIFICATION_PREFIX)) {
    const id = entryId.slice(APPOINTMENT_NOTIFICATION_PREFIX.length);
    return { pathname: "/sante", query: { show: "appointments", ...(id && { appt: id }) } };
  }
  if (entryId === EVENING_ENTRY_ID) return { pathname: "/expenses", query: { add: "expense" } };
  if (entryId.startsWith(EXPENSE_NOTIFICATION_PREFIX)) return { pathname: "/expenses" };
  return { pathname: "/result", query: { id: entryId, reminded: "1" } };
}

/**
 * "In 1 h" / "Tomorrow" buttons put the reminder off without opening the scan
 * (the entry is read from storage, so it works on a cold start too); if that
 * fails, the scan opens so nothing is silently lost. Anything else opens.
 */
export async function handleNotificationTap(entryId: string, actionId: string, notificationId: number, actions: TapActions) {
  const isScan = ![PARCEL_NOTIFICATION_PREFIX, VEHICLE_NOTIFICATION_PREFIX, EXPENSE_NOTIFICATION_PREFIX, LOAN_NOTIFICATION_PREFIX, HOME_ITEM_NOTIFICATION_PREFIX, PLANT_NOTIFICATION_PREFIX, MEDICATION_NOTIFICATION_PREFIX, APPOINTMENT_NOTIFICATION_PREFIX].some((prefix) => entryId.startsWith(prefix)) && entryId !== WEEKLY_ENTRY_ID;
  // "J'ai pris": ticked from the notification; if that fails, "Ma santé" opens.
  if (actionId === TAKEN_ACTION && entryId.startsWith(MEDICATION_NOTIFICATION_PREFIX)) {
    if (await takenFromNotification(entryId, notificationId).catch(() => false)) {
      actions.taken?.();
      return;
    }
  }
  if (isSnoozeAction(actionId) && isScan) {
    const at = await actions.snooze(entryId, actionId, notificationId).catch(() => null);
    if (at !== null) {
      actions.snoozed?.(at);
      return;
    }
  }
  actions.open(tapTarget(entryId));
}
