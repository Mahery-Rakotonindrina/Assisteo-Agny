import { morningKey, wateringMornings, type Plant } from "@/lib/plants";
import { cancelNotification, getNotificationPermission, notify, pendingNotificationIds } from "./notifications";
import { plantStore } from "./plantStore";

// "Mes plantes": the watering reminder, one local notification on each of
// the next 7 mornings with a plant to water (lib/plants.ts), again when the
// app opens and at each change (PlantReminderKeeper). Same scheme as the
// evening reminder of "Mes dépenses"; the ids are this device's.

/** Tapped, it opens "Mes plantes" (services/notificationTap.ts). */
export const PLANT_NOTIFICATION_PREFIX = "plant:";
export const PLANT_ENTRY_ID = `${PLANT_NOTIFICATION_PREFIX}morning`;

const STORAGE_KEY = "plant-mornings.v1";

/** What this device has scheduled, by day ("2026-10-30"). */
export type ScheduledMornings = Record<string, { id: number; at: number; text: string }>;

type Texts = { title: string; body: string };

export type PlantReminderDeps = {
  permission: () => Promise<string>;
  notify: (options: Texts & { at: Date; entryId: string }) => Promise<number | null>;
  cancel: (id: number) => Promise<void>;
  /** Ids still to come; null when unknown (then the saved state is trusted). */
  pending: () => Promise<Set<number> | null>;
  load: () => ScheduledMornings;
  save: (scheduled: ScheduledMornings) => void;
};

/** What a morning says, from the names of the plants to water. */
export type PlantReminderTexts = (names: string[]) => Texts;

/**
 * Brings the scheduled mornings in line with the plants and the plan:
 * cancels the mornings no longer wanted (all of them without the plan or the
 * reminders), or whose plants changed, and schedules the missing ones.
 * Never asks for permission.
 */
export async function reconcilePlantReminderState(
  plants: Plant[],
  texts: PlantReminderTexts,
  deps: PlantReminderDeps,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  const scheduled = deps.load();
  const wanted = new Map(wateringMornings(plants, now, enabled).map(({ at, names }) => [morningKey(at), { at, text: texts(names) }]));
  // Nothing wanted: cancelled even without the permission (nothing to keep).
  if (wanted.size > 0 && (await deps.permission()) !== "granted") return;
  const pending = wanted.size > 0 ? await deps.pending() : null;
  const next: ScheduledMornings = {};
  for (const [key, current] of Object.entries(scheduled)) {
    const morning = wanted.get(key);
    if (morning && morning.at === current.at && morning.text.body === current.text && (!pending || pending.has(current.id))) next[key] = current;
    else await deps.cancel(current.id);
  }
  for (const [key, { at, text }] of wanted) {
    if (next[key]) continue;
    const id = await deps.notify({ ...text, at: new Date(at), entryId: PLANT_ENTRY_ID });
    if (id !== null) next[key] = { id, at, text: text.body };
  }
  deps.save(next);
}

const deviceDeps: PlantReminderDeps = {
  permission: getNotificationPermission,
  notify,
  cancel: cancelNotification,
  pending: pendingNotificationIds,
  load: () => {
    try {
      return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as ScheduledMornings) ?? {};
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

/** Reconciles this device's watering notifications; calls made meanwhile run once after. */
export function reconcilePlantReminders(texts: PlantReminderTexts, enabled: boolean) {
  const run = async () => reconcilePlantReminderState(await plantStore.list(), texts, deviceDeps, { enabled }).catch(() => undefined);
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
