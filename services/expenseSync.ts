import { createRowSync } from "./rowSync";
import { expenseStore, type ExpenseRecord } from "./expenseStore";

// Syncs "Mes dépenses" with the account (table "expenses", see services/rowSync.ts).

const expenses = createRowSync<ExpenseRecord>("expenses", expenseStore);

export const syncExpenses = expenses.sync;

/** Keeps "Mes dépenses" synced while signed in. Returns the stop function. */
export const startExpenseSync = expenses.start;
