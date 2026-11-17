import { liveAppointments } from "@/lib/appointments";
import { liveProfiles } from "@/lib/healthProfiles";
import { doseMoments, planEnd } from "@/lib/medication";
import { localDay } from "../days";
import { inWindow, plain, type AgendaItem, type AgendaSource } from "../types";

/** Medical appointments, with the person's first name, and the treatments (one line a day). For everyone: "Ma santé" has no plan. */
export const healthSource: AgendaSource = {
  id: "health",
  domain: "health",
  collect(context) {
    const { appointments, profiles, entries } = context.data;
    const names = new Map(liveProfiles(profiles).map((profile) => [profile.id, profile.name.trim().split(/\s+/)[0]]));
    const items: AgendaItem[] = [];

    for (const appointment of liveAppointments(appointments)) {
      if (!inWindow(appointment.at, context)) continue;
      const who = appointment.profileId ? names.get(appointment.profileId) : undefined;
      items.push({
        key: `appointment:${appointment.id}`,
        domain: "health",
        at: appointment.at,
        timed: true,
        label: plain(appointment.who || appointment.place || appointment.note),
        ...(who && { detail: { key: "agenda.items.forPerson", params: { name: who } } }),
        href: `/sante?appt=${encodeURIComponent(appointment.id)}`,
      });
    }

    // A treatment is one line a day ("2 prises : Amoxicilline"), never one per dose; the doses already ticked are not counted.
    for (const entry of entries) {
      const plan = entry.medication;
      if (!plan) continue;
      const taken = new Set(plan.taken ?? []);
      const lastDay = planEnd(plan);
      const byDay = new Map<number, { first: number; count: number; names: string[] }>();
      for (const moment of doseMoments(plan)) {
        // A dose of this morning already past is not "to come".
        if (!inWindow(moment.at, context) || moment.at < context.now || taken.has(moment.at)) continue;
        const day = localDay(moment.at);
        const found = byDay.get(day) ?? { first: moment.at, count: 0, names: [] };
        found.count += 1;
        for (const medicine of moment.medicines) if (!found.names.includes(medicine.name)) found.names.push(medicine.name);
        byDay.set(day, found);
      }
      for (const [day, found] of byDay) {
        items.push({
          key: `doses:${entry.id}:${day}`,
          domain: "health",
          at: found.first,
          timed: true,
          label: { key: "agenda.items.doses", params: { count: found.count, names: found.names.join(", ") } },
          ...(lastDay !== null && localDay(lastDay) === day && { detail: { key: "agenda.items.lastDay" } }),
          href: `/sante?scan=${encodeURIComponent(entry.id)}`,
        });
      }
    }
    return items;
  },
};
