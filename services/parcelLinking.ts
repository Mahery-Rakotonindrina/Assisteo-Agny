import { isNewerParcel, sameParcel } from "@/lib/parcels";
import type { HistoryEntry } from "@/types/history";
import { historyStore } from "./historyStore";

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
