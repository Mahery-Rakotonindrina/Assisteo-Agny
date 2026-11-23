import { parseDay } from "@/lib/papers";
import { inWindow, type AgendaItem, type AgendaSource } from "../types";

/** The end of a warranty in "Ma maison". Follows its plan. */
export const homeSource: AgendaSource = {
  id: "home",
  domain: "home",
  collect(context) {
    if (!context.has("inventory")) return [];
    const items: AgendaItem[] = [];
    for (const item of context.data.homeItems) {
      const end = parseDay(item.warrantyUntil);
      if (item.deletedAt || end === null || !inWindow(end, context)) continue;
      items.push({ key: `warranty:${item.id}`, domain: "home", at: end, timed: false, label: { key: "agenda.items.warranty", params: { name: item.name } }, href: `/inventory?open=${encodeURIComponent(item.id)}` });
    }
    return items;
  },
};
