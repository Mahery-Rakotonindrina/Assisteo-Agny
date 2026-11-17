import { vehicleReminders } from "@/lib/garage";
import { inWindow, type AgendaItem, type AgendaSource } from "../types";

const kinds = { insurance: "agenda.items.insurance", inspection: "agenda.items.inspection", oilChange: "agenda.items.oilChange" } as const;

/** Insurance, technical inspection and the estimated oil change: the date of each (not the day its notice comes). Follows the garage's plan. */
export const garageSource: AgendaSource = {
  id: "garage",
  domain: "garage",
  collect(context) {
    if (!context.has("garage")) return [];
    const items: AgendaItem[] = [];
    for (const vehicle of context.data.vehicles) {
      if (vehicle.deletedAt) continue;
      for (const reminder of vehicleReminders(vehicle)) {
        if (reminder.kind === "odometer" || !inWindow(reminder.dueAt, context)) continue;
        items.push({
          key: `vehicle:${vehicle.id}:${reminder.kind}`,
          domain: "garage",
          at: reminder.dueAt,
          timed: false,
          label: { key: kinds[reminder.kind], params: { name: vehicle.name } },
          href: `/garage?open=${encodeURIComponent(vehicle.id)}`,
        });
      }
    }
    return items;
  },
};
