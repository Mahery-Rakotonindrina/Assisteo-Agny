import { supabase } from "@/lib/supabase";
import { parcelStore, type Parcel } from "./parcelStore";

// Syncs "Mes colis" with the account. A family follows a handful of parcels,
// so every sync reads the whole (small) table: newer side wins per parcel,
// then local changes are pushed. Removals travel as tombstones.

type Row = { id: string; data: Parcel; updated_at: string; deleted_at: string | null };

const time = (value: string | null) => (value ? new Date(value).getTime() : 0);

/** What is stored server-side: the parcel without device bookkeeping. */
function toData(parcel: Parcel) {
  const data: Partial<Parcel> = { ...parcel };
  delete data.dirty;
  delete data.deletedAt;
  return data;
}

let running: Promise<void> | null = null;

export function syncParcels(uid: string) {
  running ??= (async () => {
    const db = supabase();
    const { data, error } = await db.from("parcels").select("id, data, updated_at, deleted_at");
    if (error) throw error;
    let changed = false;

    // Pull: take the server's version unless this device has a newer edit.
    for (const row of (data ?? []) as Row[]) {
      const local = await parcelStore.rawGet(row.id);
      const remoteAt = time(row.updated_at);
      if (local?.dirty && local.updatedAt >= remoteAt) continue;
      if (row.deleted_at) {
        if (local) {
          await parcelStore.rawDelete(row.id);
          changed = true;
        }
      } else if (!local || local.updatedAt !== remoteAt) {
        await parcelStore.rawPut({ ...row.data, id: row.id, updatedAt: remoteAt, dirty: false });
        changed = true;
      }
    }

    // Push.
    for (const local of await parcelStore.raw()) {
      if (!local.dirty) continue;
      const { error: pushError } = await db.from("parcels").upsert({
        user_id: uid,
        id: local.id,
        data: toData(local),
        updated_at: new Date(local.updatedAt).toISOString(),
        deleted_at: local.deletedAt ? new Date(local.deletedAt).toISOString() : null,
      });
      if (pushError) throw pushError;
      // Only clear the flag if nothing changed while uploading.
      const latest = await parcelStore.rawGet(local.id);
      if (latest && latest.updatedAt === local.updatedAt) {
        if (latest.deletedAt) await parcelStore.rawDelete(local.id);
        else await parcelStore.rawPut({ ...latest, dirty: false });
      }
    }

    if (changed) parcelStore.notify();
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Keeps "Mes colis" synced while signed in. Returns the stop function. */
export function startParcelSync(uid: string) {
  parcelStore.setKeepTombstones(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => void syncParcels(uid).catch((error) => console.warn("[parcels]", error instanceof Error ? error.message : error));
  run();

  // Local edits are pushed a moment later; a pull alone never schedules another sync.
  const unsubscribe = parcelStore.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if ((await parcelStore.raw()).some((parcel) => parcel.dirty)) run();
    }, 1500);
  });
  const resume = () => document.visibilityState === "visible" && run();
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", run);

  return () => {
    clearTimeout(timer);
    unsubscribe();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("online", run);
    parcelStore.setKeepTombstones(false);
  };
}
