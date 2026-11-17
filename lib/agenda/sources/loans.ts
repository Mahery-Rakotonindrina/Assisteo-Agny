import { startOfDay } from "@/lib/format";
import { loanLateAmount, loanRemaining, personKey, scheduleState } from "@/lib/loans";
import { inWindow, type AgendaItem, type AgendaSource } from "../types";

/** The days money is to be paid back or received, and what is late (a loan past its day, unpaid). Kept loans stay (read only). */
export const loansSource: AgendaSource = {
  id: "loans",
  domain: "loans",
  collect(context) {
    const items: AgendaItem[] = [];
    const today = startOfDay(context.now);
    for (const loan of context.data.loans) {
      if (loan.deletedAt || loanRemaining(loan) <= 0) continue;
      const href = `/loans?person=${encodeURIComponent(personKey(loan.person))}${loan.direction === "borrowed" ? "&dir=borrowed" : ""}`;
      const label = { key: loan.direction === "lent" ? "agenda.items.loanLent" : "agenda.items.loanBorrowed", params: { person: loan.person } };
      const late = loanLateAmount(loan, context.now);
      // What is late is one line a loan, whatever the number of installments behind.
      if (late > 0) {
        const oldest = loan.schedule?.length ? (scheduleState(loan, context.now).find((item) => item.status === "late")?.dueAt ?? today) : (loan.dueAt ?? today);
        items.push({ key: `loan-late:${loan.id}`, domain: "loans", at: oldest, timed: false, label, detail: { key: "agenda.items.late" }, amountMga: late, href, late: true });
      }
      if (loan.schedule?.length) {
        for (const item of scheduleState(loan, context.now)) {
          if (item.leftMga > 0 && item.dueAt >= today && inWindow(item.dueAt, context)) items.push({ key: `loan:${loan.id}:${item.id}`, domain: "loans", at: item.dueAt, timed: false, label, amountMga: item.leftMga, href });
        }
      } else if (loan.dueAt !== undefined && loan.dueAt >= today && inWindow(loan.dueAt, context)) {
        items.push({ key: `loan:${loan.id}`, domain: "loans", at: loan.dueAt, timed: false, label, amountMga: loanRemaining(loan), href });
      }
    }
    return items;
  },
};
