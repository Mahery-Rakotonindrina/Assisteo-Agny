import { deliveryState } from "@/lib/parcelDelivery";
import { inWindow, type AgendaItem, type AgendaSource } from "../types";

/** The parcels awaited, on their expected day; one past its day, still not received, is late. */
export const parcelsSource: AgendaSource = {
  id: "parcels",
  domain: "parcels",
  collect(context) {
    const items: AgendaItem[] = [];
    for (const parcel of context.data.parcels) {
      if (parcel.deletedAt) continue;
      const state = deliveryState(parcel, context.now);
      if (!state) continue;
      const at = new Date(state.day.year, state.day.month - 1, state.day.day).getTime();
      const base = { domain: "parcels", at, timed: false, label: { key: "agenda.items.parcel", params: { title: parcel.title } }, href: `/parcels?open=${encodeURIComponent(parcel.id)}` };
      if (state.when === "late") items.push({ ...base, key: `parcel-late:${parcel.id}`, detail: { key: "agenda.items.late" }, late: true });
      else if (inWindow(at, context)) items.push({ ...base, key: `parcel:${parcel.id}` });
    }
    return items;
  },
};
