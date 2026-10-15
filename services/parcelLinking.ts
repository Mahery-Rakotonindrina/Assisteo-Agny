import { isNewerParcel, sameParcel } from "@/lib/parcels";
import type { HistoryEntry } from "@/types/history";
import { historyStore } from "./historyStore";
import { hasNewStatus, parcelMiniature, parcelStore } from "./parcelStore";

/**
 * A new screenshot of a parcel scanned before: the earlier scans take the new
 * status (status, last event, expected date), so the history never shows a
 * stale state. Returns the scans that were updated. The "Mes colis" list is
 * only changed when the user confirms (see the result page).
 */
export async function updateEarlierParcelScans(entry: HistoryEntry) {
  const info = entry.analysis.parcel;
  if (!info) return [];
  const updated: HistoryEntry[] = [];
  for (const other of await historyStore.list()) {
    const earlier = other.analysis.parcel;
    if (other.id === entry.id || !earlier || !sameParcel(earlier, info) || !isNewerParcel(earlier, info)) continue;
    await historyStore.update(other.id, {
      analysis: {
        ...other.analysis,
        parcel: {
          ...earlier,
          status: info.status,
          statusLabel: info.statusLabel,
          lastEvent: info.lastEvent ?? earlier.lastEvent,
          estimatedDelivery: info.estimatedDelivery ?? earlier.estimatedDelivery,
          shippedAt: earlier.shippedAt ?? info.shippedAt,
        },
      },
    });
    updated.push(other);
  }
  return updated;
}

/** What became of one photo of a batch of parcel screenshots. */
export type ParcelFollowOutcome = "added" | "updated" | "unchanged" | "limit" | "notParcel";

/**
 * Parcel screenshots scanned one by one (see useScan): each scan starts
 * following its parcel in "Mes colis", or brings the followed one up to date
 * when it shows a later state. Choosing that mode is the user's confirmation.
 * `limit`: parcels followed at once (not received yet) by the plan, 0 = no limit.
 */
export async function followScannedParcel(entry: HistoryEntry, limit: number): Promise<ParcelFollowOutcome> {
  const info = entry.analysis.parcel;
  if (!info) return "notParcel";
  const followed = await parcelStore.findFor(info);
  if (followed) {
    if (!hasNewStatus(followed, info)) return "unchanged";
    await parcelStore.applyScan(followed, entry);
    return "updated";
  }
  if (limit > 0 && (await parcelStore.list()).filter((parcel) => !parcel.receivedAt).length >= limit) return "limit";
  await parcelStore.add(entry);
  return "added";
}

/**
 * Before scans are deleted (or to catch up parcels followed earlier): the
 * parcels without their own photo copy one from their scans, so they stay
 * recognisable. `scanIds`: only the parcels linked to these scans.
 */
export async function keepParcelThumbnails(scanIds?: string[]) {
  const parcels = await parcelStore.list();
  await Promise.all(
    parcels
      .filter((parcel) => !parcel.thumbnail && (!scanIds || parcel.scanIds.some((id) => scanIds.includes(id))))
      .map(async (parcel) => {
        for (const id of parcel.scanIds) {
          const thumbnail = await parcelMiniature((await historyStore.get(id))?.thumbnail);
          if (thumbnail) {
            await parcelStore.setThumbnail(parcel.id, thumbnail);
            return;
          }
        }
      }),
  );
}
