import { clear, createStore, get, set } from "idb-keyval";
import type { ExpenseSummary, ExpenseSummaryRequest, ExpenseSummaryResponse } from "@/lib/ai/schema";
import { authHeaders } from "./account";
import { httpClient } from "./httpClient";

// "Mes dépenses": the AI's review of a month. Only the month's totals are
// sent (lib/expenseAi.ts). The last review of each month stays on this
// device: not synced, wiped with the expenses on sign-out.

export type SavedReview = { month: string; summary: ExpenseSummary; at: number; demo: boolean; total: number };

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-expense-reviews", "reviews"));

export async function savedReview(month: string) {
  return (await get<SavedReview>(month, db())) ?? null;
}

/** Asks the server for the month's review, and keeps it. */
export async function requestReview(input: ExpenseSummaryRequest): Promise<SavedReview> {
  const response = await httpClient.post<ExpenseSummaryResponse>("/api/expenses/summary", input, { headers: await authHeaders() });
  const review: SavedReview = { month: input.month, summary: response.summary, at: Date.now(), demo: response.demo, total: input.total };
  await set(input.month, review, db());
  return review;
}

export async function wipeReviews() {
  await clear(db());
}
