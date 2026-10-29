import { byKind, monthExpenses, monthIncomes, monthKey, shiftMonth, type ExpenseOrigin, type ExpenseRecord, type IncomeKind, type IncomeOrigin, type SourceItem } from "@/lib/expenses";

// "Chercher" in "Mes dépenses": every month's expenses and incomes (typed
// in, fixed, computed from the rest of the app), found by their label, note,
// shop or person, category and amount. Pure and local, so it can be tested.

/** Lower case, without accents nor extra spaces: "Électricité" finds "electricite". */
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** "12000", "12 000", "12.000 Ar": the amount asked for, or null. */
export function askedAmount(query: string) {
  const cleaned = query.toLowerCase().replace(/ariary|ar\b|mga/g, "").replace(/[\s.,\u00a0\u202f]/g, "");
  return /^\d{2,}$/.test(cleaned) ? Number(cleaned) : null;
}

export type SearchHit = {
  key: string;
  flow: "expense" | "income";
  origin: ExpenseOrigin | IncomeOrigin;
  at: number;
  amountMga: number;
  label?: string;
  /** The expense category, or the income kind. */
  category: string;
  excluded: boolean;
  /** A typed-in expense: opened in its form. */
  recordId?: string;
};

export type SearchGroup = { month: string; hits: SearchHit[] };

export type SearchResult = { groups: SearchGroup[]; count: number; total: number };

type Names = { category: (key: string) => string; income: (kind: IncomeKind) => string };

/** At most 10 years are read back. */
const MAX_MONTHS = 120;

/** The first month anything is dated in: the oldest record or line from the app. */
function firstMonth(records: ExpenseRecord[], sources: SourceItem[], now: number) {
  let oldest = now;
  for (const record of byKind(records, "expense")) oldest = Math.min(oldest, record.at);
  for (const record of byKind(records, "income")) oldest = Math.min(oldest, record.at);
  for (const source of sources) oldest = Math.min(oldest, source.at);
  let first = monthKey(oldest);
  for (const recurring of byKind(records, "recurring")) if (recurring.startMonth < first) first = recurring.startMonth;
  const limit = shiftMonth(monthKey(now), -(MAX_MONTHS - 1));
  return first < limit ? limit : first;
}

/**
 * Every line matching the query, from the current month back, grouped by
 * month (the latest first, and the latest line first in each). The total adds
 * up the lines counted (the ones kept out are shown, not counted).
 */
export function searchExpenses(records: ExpenseRecord[], sources: SourceItem[], query: string, now: number, names: Names): SearchResult {
  const words = fold(query).split(" ").filter(Boolean);
  const amount = askedAmount(query);
  if (words.length === 0) return { groups: [], count: 0, total: 0 };
  const matches = (hit: SearchHit, texts: Array<string | undefined>) => {
    if (amount !== null && hit.amountMga === amount) return true;
    const haystack = fold(texts.filter(Boolean).join(" "));
    return words.every((word) => haystack.includes(word));
  };

  const groups: SearchGroup[] = [];
  const first = firstMonth(records, sources, now);
  for (let month = monthKey(now), step = 0; month >= first && step < MAX_MONTHS; month = shiftMonth(month, -1), step += 1) {
    const hits: SearchHit[] = [];
    for (const item of monthExpenses(records, sources, month)) {
      if (item.at > now && item.origin !== "recurring") continue;
      const hit: SearchHit = { key: item.key, flow: "expense", origin: item.origin, at: item.at, amountMga: item.amountMga, label: item.label, category: item.category, excluded: item.excluded, ...(item.record && { recordId: item.record.id }) };
      if (matches(hit, [item.label, item.record?.note, item.recurring?.label, names.category(item.category)])) hits.push(hit);
    }
    for (const item of monthIncomes(records, month, sources)) {
      const hit: SearchHit = { key: item.key, flow: "income", origin: item.origin, at: item.at, amountMga: item.amountMga, label: item.label, category: item.income, excluded: item.excluded };
      if (matches(hit, [item.label, item.record?.note, item.recurring?.label, names.income(item.income)])) hits.push(hit);
    }
    if (hits.length > 0) groups.push({ month, hits: hits.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key)) });
  }
  const all = groups.flatMap((group) => group.hits);
  return { groups, count: all.length, total: all.reduce((sum, hit) => sum + (hit.excluded ? 0 : hit.amountMga), 0) };
}
