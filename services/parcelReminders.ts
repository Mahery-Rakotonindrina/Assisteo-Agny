import { deliveryNotifyAt } from "@/lib/parcelDelivery";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";
import { parcelStore, type Parcel } from "./parcelStore";

// "Your parcel arrives today": one local notification per awaited parcel, on
// its expected day at the hour chosen in the settings (Madagascar time). The
// ids scheduled on this device are kept here, not in the parcel (they are
// meaningless on another device).

/** Marks a tapped notification as a parcel's: it opens "Mes colis". */
export const PARCEL_NOTIFICATION_PREFIX = "parcel:";

const STORAGE_KEY = "parcel-reminders.v1";

/** What this device has scheduled, by parcel id. */
export type ScheduledParcelReminders = Record<string, { id: number; at: number; title: string }>;

type Texts = { title: string; body: string };

export type ParcelReminderOptions = { enabled: boolean; hour: number };

export type ParcelReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  /** Ids still to come; null when unknown (then the saved state is trusted). */
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledParcelReminders;
  save: (scheduled: ScheduledParcelReminders) => void;
};

/** The notifications wanted now, by parcel id. */
export function plannedParcelReminders(parcels: Parcel[], options: ParcelReminderOptions, now: number) {
  const planned = new Map<string, { at: number; title: string }>();
  if (!options.enabled) return planned;
  for (const parcel of parcels) {
    const at = deliveryNotifyAt(parcel, options.hour, now);
    if (at !== null) planned.set(parcel.id, { at, title: parcel.title });
  }
  return planned;
}

/**
 * Brings the scheduled notifications in line with the parcels and the
 * settings: cancels the ones no longer wanted (parcel removed or received,
 * day or hour changed, setting off) and schedules the missing ones.
 * Never asks for permission: without it, nothing happens.
 */
export async function reconcileParcelReminderState(
  parcels: Parcel[],
  options: ParcelReminderOptions,
  texts: (parcel: Parcel) => Texts,
  deps: ParcelReminderDeps,
  now = Date.now(),
) {
  if ((await deps.permission()) !== "granted") return;
  const planned = plannedParcelReminders(parcels, options, now);
  const scheduled = deps.load();
  const pending = await deps.pending();
  const next: ScheduledParcelReminders = {};

  for (const [parcelId, current] of Object.entries(scheduled)) {
    const wanted = planned.get(parcelId);
    const stillThere = !pending || pending.has(current.id);
    if (wanted && stillThere && wanted.at === current.at && wanted.title === current.title) next[parcelId] = current;
    else await deps.cancel(current.id);
  }

  for (const [parcelId, wanted] of planned) {
    if (next[parcelId]) continue;
    const parcel = parcels.find(({ id }) => id === parcelId)!;
    const id = await deps.notify({ ...texts(parcel), at: new Date(wanted.at), entryId: PARCEL_NOTIFICATION_PREFIX + parcelId });
    if (id !== null) next[parcelId] = { id, ...wanted };
  }

  deps.save(next);
}

const deviceDeps: ParcelReminderDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => {
    try {
      return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as ScheduledParcelReminders) ?? {};
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

/** Reconciles this device's parcel notifications; calls made meanwhile run once after. */
export function reconcileParcelReminders(options: ParcelReminderOptions, texts: (parcel: Parcel) => Texts) {
  const run = async () => reconcileParcelReminderState(await parcelStore.list(), options, texts, deviceDeps).catch(() => undefined);
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
