import { vehicleReminders, type Vehicle, type VehicleReminder } from "@/lib/garage";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";
import { vehicleStore } from "./vehicleStore";

// "Mon garage" reminders: insurance, technical inspection, estimated oil
// change, odometer update. One local notification per vehicle and kind, to
// come; the ids scheduled on this device are kept here, not in the vehicle
// (they are meaningless on another device). Same scheme as parcelReminders.

/** Marks a tapped notification as a vehicle's: it opens "Mon garage". */
export const VEHICLE_NOTIFICATION_PREFIX = "vehicle:";

const STORAGE_KEY = "vehicle-reminders.v1";

/** What this device has scheduled, by "vehicleId:kind". */
export type ScheduledVehicleReminders = Record<string, { id: number; at: number; text: string }>;

type Texts = { title: string; body: string };

export type VehicleReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  /** Ids still to come; null when unknown (then the saved state is trusted). */
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledVehicleReminders;
  save: (scheduled: ScheduledVehicleReminders) => void;
};

export type VehicleReminderTexts = (vehicle: Vehicle, reminder: VehicleReminder) => Texts;

/**
 * The notifications wanted now, by "vehicleId:kind": only those still to come,
 * and none while the plan doesn't include the garage (back once it does).
 */
export function plannedVehicleReminders(vehicles: Vehicle[], now: number, enabled = true) {
  const planned = new Map<string, { vehicle: Vehicle; reminder: VehicleReminder }>();
  if (!enabled) return planned;
  for (const vehicle of vehicles) {
    for (const reminder of vehicleReminders(vehicle)) {
      if (reminder.at > now) planned.set(`${vehicle.id}:${reminder.kind}`, { vehicle, reminder });
    }
  }
  return planned;
}

/**
 * Brings the scheduled notifications in line with the vehicles and the plan:
 * cancels the ones no longer wanted (vehicle removed, date or text changed,
 * plan below Premium) and schedules the missing ones. Never asks for
 * permission: without it, nothing happens.
 */
export async function reconcileVehicleReminderState(
  vehicles: Vehicle[],
  texts: VehicleReminderTexts,
  deps: VehicleReminderDeps,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  if ((await deps.permission()) !== "granted") return;
  const planned = plannedVehicleReminders(vehicles, now, enabled);
  const scheduled = deps.load();
  const pending = await deps.pending();
  const next: ScheduledVehicleReminders = {};

  for (const [key, current] of Object.entries(scheduled)) {
    const wanted = planned.get(key);
    const stillThere = !pending || pending.has(current.id);
    const text = wanted && texts(wanted.vehicle, wanted.reminder);
    if (wanted && text && stillThere && wanted.reminder.at === current.at && text.body === current.text) next[key] = current;
    else await deps.cancel(current.id);
  }

  for (const [key, { vehicle, reminder }] of planned) {
    if (next[key]) continue;
    const text = texts(vehicle, reminder);
    const id = await deps.notify({ ...text, at: new Date(reminder.at), entryId: VEHICLE_NOTIFICATION_PREFIX + vehicle.id });
    if (id !== null) next[key] = { id, at: reminder.at, text: text.body };
  }

  deps.save(next);
}

const deviceDeps: VehicleReminderDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => {
    try {
      return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as ScheduledVehicleReminders) ?? {};
    } catch {
      return {};
    }
  },
  save: (scheduled) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduled));
    } catch {
      // Private mode or full storage: scheduled again next time.
    }
  },
};

let running: Promise<void> | null = null;
let again: (() => Promise<void>) | null = null;

/** Reconciles this device's vehicle notifications; calls made meanwhile run once after. */
export function reconcileVehicleReminders(texts: VehicleReminderTexts, enabled: boolean) {
  const run = async () => reconcileVehicleReminderState(await vehicleStore.list(), texts, deviceDeps, { enabled }).catch(() => undefined);
  if (running) {
    again = run;
    return running;
  }
  running = (async () => {
    try {
      await run();
      while (again) {
        const next = again;
        again = null;
        await next();
      }
    } finally {
      running = null;
    }
  })();
  return running;
}
