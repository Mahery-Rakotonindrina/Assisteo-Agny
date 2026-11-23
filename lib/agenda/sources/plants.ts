import { cleanWaterDays, nextWaterDay } from "@/lib/plants";
import { addDays, localDay } from "../days";
import { inWindow, plain, type AgendaItem, type AgendaSource } from "../types";

/** Watering: one line a day for all the plants due, projected from each plant's next day and its rhythm (a late one counts today). Follows the plants' plan. */
export const plantsSource: AgendaSource = {
  id: "plants",
  domain: "plants",
  collect(context) {
    if (!context.has("plants")) return [];
    const today = localDay(context.now);
    const byDay = new Map<number, string[]>();
    for (const plant of context.data.plants) {
      if (plant.deletedAt) continue;
      const every = cleanWaterDays(plant.waterEveryDays);
      // A late plant waits for today; the next ones follow its rhythm.
      for (let day = Math.max(nextWaterDay(plant), today); day < context.to; day = addDays(day, every)) {
        if (inWindow(day, context)) byDay.set(day, [...(byDay.get(day) ?? []), plant.name]);
      }
    }
    const items: AgendaItem[] = [];
    for (const [day, names] of byDay) {
      items.push({ key: `watering:${day}`, domain: "plants", at: day, timed: false, label: { key: "agenda.items.watering", params: { count: names.length } }, detail: plain(names.join(", ")), href: "/plants" });
    }
    return items;
  },
};
