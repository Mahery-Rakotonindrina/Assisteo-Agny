import type { Analysis } from "./ai/schema";
import { receiptDraft } from "./expenseAi";
import { monthKey, receiptKey, shiftMonth, type ManualExpense, type MonthItem } from "./expenses";
import { ME, liveProfiles, ownerOf, type HealthProfile } from "./healthProfiles";

// "Dépenses de santé" (Ma santé): what the pharmacy, the doctor, the tests and
// the hospital cost this month, for oneself or a relative ("Pour qui ?").
// Two homes, never both for one expense:
// - with "Mes dépenses", a real expense of the category "health", tagged with
//   its kind and its person (ManualExpense.health); the lines "Mes dépenses"
//   computes (a pharmacy receipt scanned…) count too;
// - without, a list of its own (services/healthSpendStore.ts, table
//   health_spending, migration 0025), kept when the plan changes.
// Pure, so it can be tested.

export const healthSpendKinds = ["pharmacy", "consultation", "tests", "hospital", "other"] as const;
export type HealthSpendKind = (typeof healthSpendKinds)[number];

/** The category of "Mes dépenses" these expenses belong to. */
export const HEALTH_CATEGORY = "health";

/** What a health expense adds to an expense of "Mes dépenses" (older apps ignore it). */
export type HealthTag = { kind: HealthSpendKind; profileId?: string };

/** A health expense of its own (without "Mes dépenses"). */
export type HealthSpend = {
  id: string;
  /** The day it was paid (local midnight). */
  at: number;
  amountMga: number;
  kind: HealthSpendKind;
  /** A relative's profile; none for "Moi". */
  profileId?: string;
  note?: string;
  /** Added from a scanned receipt: the scan (never added twice). */
  scanId?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  dirty?: boolean;
};

export type HealthSpendFields = Pick<HealthSpend, "at" | "amountMga" | "kind" | "profileId" | "note" | "scanId">;

/** What the form gives (the amount as typed: "12 500", "12500"). */
export type HealthSpendDraft = { at: number; amount: string; kind: HealthSpendKind; profileId?: string; note?: string; scanId?: string };

export const NOTE_MAX = 200;
/** A typing slip, not a judgement: a billion ariary is already a lot. */
export const AMOUNT_MAX = 1_000_000_000;

/** "12 500", "12.500" or "12500" to 12500; null when it is not a whole amount in range. */
export function readAmount(value: string | undefined): number | null {
  const text = (value ?? "").replace(/[\s.]/g, "").replace(/ar$/i, "");
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  return amount > 0 && amount <= AMOUNT_MAX ? amount : null;
}

export const isHealthKind = (value: unknown): value is HealthSpendKind => healthSpendKinds.includes(value as HealthSpendKind);

/** The form's values, checked; the fields wrong (to show) when they are not. */
export function cleanHealthSpend(draft: HealthSpendDraft): { fields: HealthSpendFields; wrong: [] } | { fields: null; wrong: string[] } {
  const amountMga = readAmount(draft.amount);
  const wrong = [amountMga === null && "amount", !(Number.isFinite(draft.at) && draft.at > 0) && "at"].filter((field): field is string => Boolean(field));
  if (wrong.length || amountMga === null) return { fields: null, wrong };
  return {
    fields: {
      at: draft.at,
      amountMga,
      kind: isHealthKind(draft.kind) ? draft.kind : "other",
      ...(draft.profileId && draft.profileId !== ME && { profileId: draft.profileId }),
      ...(draft.note?.trim() && { note: draft.note.trim().slice(0, NOTE_MAX) }),
      ...(draft.scanId && { scanId: draft.scanId }),
    },
    wrong: [],
  };
}

/** A health expense as stored, read back (another device, an older version): null when unusable. */
export function readHealthSpend(value: HealthSpend): HealthSpend | null {
  if (!value || !Number.isFinite(value.at) || !(Number.isFinite(value.amountMga) && value.amountMga > 0)) return null;
  return isHealthKind(value.kind) ? value : { ...value, kind: "other" };
}

/** The tag of an expense of "Mes dépenses", read back: none when the expense is not a health one. */
export function healthTagOf(expense: Pick<ManualExpense, "category"> & { health?: unknown }): HealthTag | null {
  if (expense.category !== HEALTH_CATEGORY) return null;
  const tag = expense.health as Partial<HealthTag> | undefined;
  return { kind: isHealthKind(tag?.kind) ? tag.kind : "other", ...(typeof tag?.profileId === "string" && tag.profileId && tag.profileId !== ME && { profileId: tag.profileId }) };
}

/** One line of the section, whichever home it has. */
export type HealthLine = {
  key: string;
  /** "own": its own list; "expense": typed in "Mes dépenses"; "computed": read by "Mes dépenses" elsewhere (a receipt…). */
  from: "own" | "expense" | "computed";
  /** The record to open (own list or "Mes dépenses"). */
  id?: string;
  at: number;
  amountMga: number;
  kind: HealthSpendKind;
  profileId?: string;
  note?: string;
  /** Where a computed line is shown in the app. */
  href?: string;
  scanId?: string;
};

export const spendLine = (spend: HealthSpend): HealthLine => ({
  key: `own:${spend.id}`,
  from: "own",
  id: spend.id,
  at: spend.at,
  amountMga: spend.amountMga,
  kind: spend.kind,
  ...(spend.profileId && { profileId: spend.profileId }),
  ...(spend.note && { note: spend.note }),
  ...(spend.scanId && { scanId: spend.scanId }),
});

/**
 * The health lines of a month of "Mes dépenses" (lib/expenses.ts
 * monthExpenses): the category "health", as counted there (a line kept out
 * of the budget, a receipt in doubt, are not). A computed line takes the person of its scan.
 */
export function expenseLines(items: MonthItem[], scanOwner: (scanId: string) => string | undefined = () => undefined): HealthLine[] {
  return items
    .filter((item) => item.category === HEALTH_CATEGORY && !item.excluded && !item.doubt)
    .map((item): HealthLine => {
      if (item.record) {
        const tag = healthTagOf(item.record) ?? { kind: "other" as const };
        return {
          key: `expense:${item.record.id}`,
          from: "expense",
          id: item.record.id,
          at: item.at,
          amountMga: item.amountMga,
          kind: tag.kind,
          ...(tag.profileId && { profileId: tag.profileId }),
          ...(item.record.note && { note: item.record.note }),
          ...(item.record.scanId && { scanId: item.record.scanId }),
        };
      }
      const profileId = item.scanId ? scanOwner(item.scanId) : undefined;
      return {
        key: `computed:${item.key}`,
        from: "computed",
        at: item.at,
        amountMga: item.amountMga,
        // A receipt or a bill of the category health: most often the pharmacy.
        kind: item.origin === "receipt" ? "pharmacy" : "other",
        ...(profileId && { profileId }),
        ...(item.label && { note: item.label }),
        ...(item.href && { href: item.href }),
        ...(item.scanId && { scanId: item.scanId }),
      };
    });
}

/** Both homes together, without counting a scanned receipt twice (kept in the own list, and read by "Mes dépenses" since). */
export function mergeLines(own: HealthLine[], expenses: HealthLine[]): HealthLine[] {
  // Moved to "Mes dépenses" already, its removal not synced yet (another device): the expense counts.
  const moved = new Set(expenses.map((line) => line.id).filter(Boolean));
  // One receipt, one line: the same scan kept twice in the own list (an older version) counts once.
  const scans = new Set<string>();
  const kept = own.filter((line) => {
    if (line.id && moved.has(movedExpenseId(line.id))) return false;
    if (!line.scanId) return true;
    if (scans.has(line.scanId)) return false;
    scans.add(line.scanId);
    return true;
  });
  return [...kept, ...expenses.filter((line) => !(line.scanId && scans.has(line.scanId)))];
}

/**
 * The id of the own expense a scanned receipt makes: always the same, so
 * adding it twice (two taps, two devices before the sync) rewrites one line.
 */
export const receiptSpendId = (scanId: string) => `receipt:${scanId}`;

// ---- Moved to "Mes dépenses" (the plan has it now) ------------------------------

/**
 * The id of the expense one of Ma santé's own expenses becomes: always the
 * same, so moving it again (a second tap, another device, a slow sync)
 * rewrites that expense instead of adding one.
 */
export const movedExpenseId = (spendId: string) => `health:${spendId}`;

/** An expense made by moving one of Ma santé's own: its removal is remembered, so it never comes back. */
export const isMovedExpenseId = (id: string) => id.startsWith("health:");

/** What "Mes dépenses" saves for one of Ma santé's own expenses (expenseStore.saveExpense). */
export function movedExpense(spend: HealthSpend) {
  return {
    id: movedExpenseId(spend.id),
    at: spend.at,
    amountMga: spend.amountMga,
    category: HEALTH_CATEGORY,
    note: spend.note,
    health: { kind: spend.kind, ...(spend.profileId && { profileId: spend.profileId }) } as HealthTag,
    // From a scanned receipt: it stands for the line "Mes dépenses" reads from that receipt (never counted twice).
    ...(spend.scanId && { scanId: spend.scanId, sourceKey: receiptKey(spend.scanId) }),
  };
}

/** The months one can go back to: never past the current one. */
export const canGoForward = (key: string, now: number) => key < monthKey(now);

export type HealthMonth = {
  /** The person's lines, the most recent first. */
  lines: HealthLine[];
  total: number;
  /** Per kind, the kinds with an amount only, in their order. */
  byKind: { kind: HealthSpendKind; total: number }[];
};

/** The month of one person ("Moi" has every line without a known relative). */
export function healthMonth(lines: HealthLine[], key: string, person: string, profiles: HealthProfile[] | null | undefined): HealthMonth {
  const theirs = lines.filter((line) => monthKey(line.at) === key && ownerOf(line.profileId, profiles) === person).sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  const total = theirs.reduce((sum, line) => sum + line.amountMga, 0);
  const byKind = healthSpendKinds
    .map((kind) => ({ kind, total: theirs.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amountMga, 0) }))
    .filter((item) => item.total > 0);
  return { lines: theirs, total, byKind };
}

/** The month before, for the same person: its total only. */
export const previousTotal = (lines: HealthLine[], key: string, person: string, profiles: HealthProfile[] | null | undefined) => healthMonth(lines, shiftMonth(key, -1), person, profiles).total;

/** The month for each person with an expense ("Moi" first), when there are relatives. */
export function totalsByPerson(lines: HealthLine[], key: string, profiles: HealthProfile[] | null | undefined): { person: string; total: number }[] {
  const people = [ME, ...liveProfiles(profiles).map((profile) => profile.id)];
  return people.map((person) => ({ person, total: healthMonth(lines, key, person, profiles).total })).filter((item) => item.total > 0);
}

/** A relative removed: their own health expenses come back to "Moi" (the ids to change). */
export const spendsOf = (spends: HealthSpend[], profileId: string) => spends.filter((spend) => spend.profileId === profileId && !spend.deletedAt);

type ReceiptScan = { id: string; createdAt: number; profileId?: string; analysis: Pick<Analysis, "document"> };

/**
 * A pharmacy or doctor's receipt scanned (category "health", money paid, in
 * ariary): the health expense it makes, for "Ajouter aux dépenses de santé".
 * Null for any other scan.
 */
export function receiptSpend(scan: ReceiptScan): HealthSpendFields | null {
  const draft = receiptDraft(scan);
  const direction = scan.analysis.document?.receipt?.direction;
  if (!draft || draft.category !== HEALTH_CATEGORY || !draft.amountMga || !draft.at || direction === "in" || direction === "own") return null;
  return {
    at: draft.at,
    amountMga: draft.amountMga,
    kind: "pharmacy",
    ...(scan.profileId && scan.profileId !== ME && { profileId: scan.profileId }),
    ...(draft.note && { note: draft.note.slice(0, NOTE_MAX) }),
    scanId: scan.id,
  };
}
