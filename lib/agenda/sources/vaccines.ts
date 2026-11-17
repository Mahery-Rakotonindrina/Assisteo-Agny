import { liveProfiles } from "@/lib/healthProfiles";
import { nextDoses, vaccineOwner } from "@/lib/vaccines";
import { addDays, localDay } from "../days";
import { inWindow, type AgendaItem, type AgendaSource } from "../types";

/** A next dose gone by and not noted as done stays "late" this many days, like a paper, then leaves the agenda. */
export const LATE_VACCINE_DAYS = 90;

/** The next vaccine doses written by hand, with the person's first name; a late one for LATE_VACCINE_DAYS. For everyone, like "Ma santé". */
export const vaccinesSource: AgendaSource = {
  id: "vaccines",
  domain: "vaccines",
  collect(context) {
    const { vaccines, profiles } = context.data;
    const names = new Map(liveProfiles(profiles).map((profile) => [profile.id, profile.name.trim().split(/\s+/)[0]]));
    const today = localDay(context.now);
    const oldest = addDays(today, -LATE_VACCINE_DAYS);
    const items: AgendaItem[] = [];
    for (const { vaccine, at } of nextDoses(vaccines, context.now)) {
      // A relative no longer on this device: their record is shown nowhere.
      if (vaccineOwner(vaccine, profiles) === null) continue;
      const day = localDay(at);
      const who = vaccine.profileId ? names.get(vaccine.profileId) : undefined;
      const base = {
        domain: "vaccines",
        at: day,
        timed: false,
        label: { key: "agenda.items.vaccine", params: { name: vaccine.name } },
        href: `/sante?vax=${encodeURIComponent(vaccine.id)}`,
      };
      const person = who ? { key: "agenda.items.forPerson", params: { name: who } } : undefined;
      if (day < today) {
        if (day >= oldest) items.push({ ...base, key: `vaccine-late:${vaccine.id}`, detail: who ? { key: "agenda.items.vaccineLateFor", params: { name: who } } : { key: "agenda.items.vaccineLate" }, late: true });
      } else if (inWindow(day, context)) items.push({ ...base, key: `vaccine:${vaccine.id}`, ...(person && { detail: person }) });
    }
    return items;
  },
};
