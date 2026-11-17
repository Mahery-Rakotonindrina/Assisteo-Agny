import { byKind, monthKey, occurrenceIn, occurrenceKey, shiftMonth } from "@/lib/expenses";
import { inWindow, plain, type AgendaItem, type AgendaSource } from "../types";

/** The fixed expenses and incomes ("loyer le 5"): their days in the window, unless skipped that month or already entered. Follows "Mes dépenses". */
export const expensesSource: AgendaSource = {
  id: "expenses",
  domain: "expenses",
  collect(context) {
    if (!context.has("expenses")) return [];
    const { records } = context.data;
    // An occurrence a typed-in expense or income stands for is done.
    const done = new Set([...byKind(records, "expense"), ...byKind(records, "income")].map((record) => record.sourceKey).filter(Boolean));
    const months: string[] = [];
    for (let month = monthKey(context.from); month <= monthKey(context.to - 1); month = shiftMonth(month, 1)) months.push(month);
    const items: AgendaItem[] = [];
    for (const recurring of byKind(records, "recurring")) {
      if (recurring.deletedAt) continue;
      for (const month of months) {
        if (recurring.skipped.includes(month)) continue;
        const at = occurrenceIn(recurring, month);
        if (at === null || !inWindow(at, context) || done.has(occurrenceKey(recurring.id, month))) continue;
        items.push({
          key: `recurring:${recurring.id}:${month}`,
          domain: "expenses",
          at,
          timed: false,
          label: plain(recurring.label),
          detail: { key: recurring.flow === "income" ? "agenda.items.incomeDue" : "agenda.items.expenseDue" },
          amountMga: recurring.amountMga,
          href: "/expenses?tab=recurring",
        });
      }
    }
    return items;
  },
};
