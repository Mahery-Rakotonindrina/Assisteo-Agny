import type { AgendaContext, AgendaItem, AgendaSource } from "../types";
import { expensesSource } from "./expenses";
import { garageSource } from "./garage";
import { healthSource } from "./health";
import { homeSource } from "./home";
import { loansSource } from "./loans";
import { papersSource } from "./papers";
import { parcelsSource } from "./parcels";
import { plantsSource } from "./plants";
import { remindersSource } from "./reminders";

/** Every source of the agenda, in the order their domains are listed. A new one (vaccines, expiry dates) is added here. */
export const agendaSources: AgendaSource[] = [remindersSource, healthSource, loansSource, expensesSource, parcelsSource, garageSource, homeSource, papersSource, plantsSource];

/** What every source finds in the window; one failing source never hides the others. */
export function collectAgenda(context: AgendaContext, sources: AgendaSource[] = agendaSources): AgendaItem[] {
  return sources.flatMap((source) => {
    try {
      return source.collect(context);
    } catch {
      return [];
    }
  });
}
