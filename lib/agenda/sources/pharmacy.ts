import { liveProfiles } from "@/lib/healthProfiles";
import { expiryDay, expiryStatus, homeMedicines } from "@/lib/pharmacy";
import { localDay } from "../days";
import { inWindow, type AgendaItem, type AgendaSource } from "../types";

/**
 * The home medicines' expiry dates, on their last good day ("Dernier jour :
 * X"); an expired one still in the cabinet stays "late" until it is removed.
 * For everyone, like "Ma santé".
 */
export const pharmacySource: AgendaSource = {
  id: "pharmacy",
  domain: "pharmacy",
  collect(context) {
    const names = new Map(liveProfiles(context.data.profiles).map((profile) => [profile.id, profile.name.trim().split(/\s+/)[0]]));
    const items: AgendaItem[] = [];
    for (const medicine of homeMedicines(context.data.pharmacy)) {
      const day = localDay(expiryDay(medicine.expiry));
      const who = medicine.forWho && medicine.forWho !== "me" ? names.get(medicine.forWho) : undefined;
      const base = { domain: "pharmacy", at: day, timed: false, href: `/sante?med=${encodeURIComponent(medicine.id)}`, ...(who && { detail: { key: "agenda.items.forPerson", params: { name: who } } }) };
      if (expiryStatus(medicine.expiry, context.now) === "expired") items.push({ ...base, key: `medicine-late:${medicine.id}`, label: { key: "agenda.items.medicineExpired", params: { name: medicine.name } }, late: true });
      else if (inWindow(day, context)) items.push({ ...base, key: `medicine:${medicine.id}`, label: { key: "agenda.items.medicineLastDay", params: { name: medicine.name } } });
    }
    return items;
  },
};
