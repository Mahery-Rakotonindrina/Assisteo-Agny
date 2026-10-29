import type { OwnKind, ReceiptDirection, Statement, StatementOperation } from "@/lib/ai/schema";
import {
  byKind,
  dayStart,
  sameReference,
  storedIncome,
  type ExpenseRecord,
  type Income,
  type IncomeKind,
  type ManualExpense,
  type SourceItem,
  type StatementTag,
  type Transfer,
  type Wallet,
} from "@/lib/expenses";
import { parseDay } from "@/lib/papers";
import { activeWallets, correctionFor, mobileMoneyTypes, ofType, paymentForWallet, type WalletBook } from "@/lib/wallets";

// "Mes dépenses": a Mobile Money or bank statement read by the AI, turned into
// ordinary expenses, incomes and moves between pockets. Pure, so it can be
// tested. Each operation gets a stable key ("statement:<reference>", or a
// fingerprint without one): importing the same statement again adds nothing.

export const STATEMENT_PREFIX = "statement:";
export const isStatementKey = (key: string | undefined) => Boolean(key?.startsWith(STATEMENT_PREFIX));
const feesKey = (key: string) => `${key}:fees`;

/** Why an operation is "already there": imported before, the same reference, or the same amount, way and day (1 day apart at most). */
export type Duplicate = "imported" | "reference" | "similar";

export type StatementLine = {
  key: string;
  at: number;
  /** Fees apart. */
  amountMga: number;
  feesMga: number;
  direction: ReceiptDirection;
  /** Money out of this pocket (debit) or into it (credit). */
  side: "debit" | "credit";
  ownKind?: OwnKind;
  counterparty?: string;
  reference?: string;
  /** For money out: the category offered (the user can change it). */
  category: string;
  /** For money in. */
  income: IncomeKind;
  balanceAfter?: number;
  duplicate?: Duplicate;
};

const normalized = (text: string | null | undefined) =>
  (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A short, stable hash (FNV-1a): the counterparty's name is not spelled out in the key. */
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

/** An operation's key: its reference, else its day, way, amount and counterparty. */
export function operationKey(operation: Pick<StatementOperation, "reference" | "date" | "direction" | "amount" | "counterparty">) {
  const reference = operation.reference?.replace(/\s+/g, "").toUpperCase();
  if (reference) return `${STATEMENT_PREFIX}${reference}`;
  return `${STATEMENT_PREFIX}${operation.date ?? "nodate"}:${operation.direction}:${Math.round(operation.amount)}:${hash(normalized(operation.counterparty))}`;
}

/** Amounts in ariary only (no rate on hand for the others). */
export function isAriaryStatement(statement: Pick<Statement, "currency">) {
  const code = statement.currency?.trim().toUpperCase();
  return !code || code === "MGA" || code === "AR" || code === "ARIARY";
}

const positive = (value: number | null | undefined) => (value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/**
 * The statement's operations as lines, the latest first. One without a day
 * takes the statement's last day (else `fallbackAt`). Two operations of the
 * same key in one statement (two equal payments to the same person on a day,
 * no reference) are told apart by their rank, so a second import still finds
 * them both.
 */
export function statementLines(statement: Statement, fallbackAt: number): StatementLine[] {
  const seen = new Map<string, number>();
  const lastDay = parseDay(statement.periodEnd) ?? dayStart(fallbackAt);
  const lines: StatementLine[] = [];
  for (const operation of statement.operations) {
    const amountMga = positive(operation.amount);
    if (amountMga === 0) continue;
    const base = operationKey(operation);
    const rank = (seen.get(base) ?? 0) + 1;
    seen.set(base, rank);
    const direction = operation.direction;
    const side = operation.side ?? (direction === "in" || operation.ownKind === "deposit" ? "credit" : "debit");
    lines.push({
      key: rank === 1 ? base : `${base}#${rank}`,
      at: parseDay(operation.date) ?? lastDay,
      amountMga,
      feesMga: positive(operation.fees),
      direction,
      side,
      ...(direction === "own" && operation.ownKind && { ownKind: operation.ownKind }),
      ...(operation.counterparty?.trim() && { counterparty: operation.counterparty.trim().slice(0, 80) }),
      ...(operation.reference?.trim() && { reference: operation.reference.trim().slice(0, 80) }),
      category: operation.category ?? "other",
      income: operation.incomeKind ?? "other",
      ...(operation.balanceAfter !== null && operation.balanceAfter !== undefined && Number.isFinite(operation.balanceAfter) && { balanceAfter: Math.round(operation.balanceAfter) }),
    });
  }
  return lines.sort((a, b) => b.at - a.at);
}

/** What the app has already, as far as a statement's operations go. */
export type KnownOperation = { at: number; amountMga: number; direction: ReceiptDirection; reference?: string; sourceKey?: string };

const isReceipt = (source: SourceItem) => source.origin === "receipt" || source.origin === "mobile_money";

/**
 * The receipts scanned, the expenses and incomes typed in (or imported) and
 * the moves between pockets. A statement's fees lines are left out: they are
 * found through their operation.
 */
export function knownOperations(records: ExpenseRecord[], sources: SourceItem[]): KnownOperation[] {
  const known: KnownOperation[] = [];
  for (const expense of byKind(records, "expense"))
    if (!expense.sourceKey?.endsWith(":fees")) known.push({ at: expense.at, amountMga: expense.amountMga, direction: "out", reference: expense.reference, sourceKey: expense.sourceKey });
  for (const income of byKind(records, "income")) known.push({ at: income.at, amountMga: income.amountMga, direction: "in", reference: income.reference, sourceKey: income.sourceKey });
  for (const transfer of byKind(records, "transfer")) known.push({ at: transfer.at, amountMga: transfer.amountMga, direction: "own", reference: transfer.reference, sourceKey: transfer.sourceKey });
  for (const source of sources)
    if (isReceipt(source) && !source.sameAs)
      known.push({ at: source.at, amountMga: source.amountMga, direction: source.own ? "own" : source.flow === "income" ? "in" : "out", reference: source.reference });
  return known;
}

const DAY = 86_400_000;
// One day apart at most (an hour more for the change to summer time).
const nearDay = (a: number, b: number) => Math.abs(dayStart(a) - dayStart(b)) <= DAY + 3_600_000;

/** Why the line is already there, if it is. A receipt's total has its fees in it. */
export function findDuplicate(line: StatementLine, known: KnownOperation[]): Duplicate | undefined {
  if (known.some((item) => item.sourceKey === line.key)) return "imported";
  if (line.reference && known.some((item) => sameReference(item.reference, line.reference))) return "reference";
  const amounts = [line.amountMga, line.amountMga + line.feesMga];
  if (known.some((item) => item.direction === line.direction && amounts.includes(item.amountMga) && nearDay(item.at, line.at))) return "similar";
  return undefined;
}

export const markDuplicates = (lines: StatementLine[], known: KnownOperation[]) => lines.map((line) => ({ ...line, duplicate: findDuplicate(line, known) }));

/** "23 operations · out 412,000 Ar · in 380,000 Ar": what left the pocket (fees included) and what came in, of the lines chosen. */
export function statementTotals(lines: StatementLine[]) {
  let out = 0;
  let income = 0;
  for (const line of lines) {
    if (line.side === "debit") out += line.amountMga + line.feesMga;
    else {
      income += line.amountMga;
      out += line.feesMga;
    }
  }
  return { count: lines.length, out, in: income };
}

/** The pocket the statement is offered in: its operator's, else the bank, else the first Mobile Money one. */
export function suggestedWallet(wallets: Wallet[], statement: Pick<Statement, "operator" | "kind">): Wallet | undefined {
  const active = activeWallets(wallets);
  if (statement.operator) {
    const own = ofType(active, statement.operator);
    if (own) return own;
  }
  if (statement.kind === "bank") return ofType(active, "bank");
  return active.find((wallet) => mobileMoneyTypes.includes(wallet.type));
}

/** The other pocket of a move: cash for a withdrawal or a deposit, else the first other pocket. */
export function otherWallet(wallets: Wallet[], wallet: string | undefined, line: Pick<StatementLine, "ownKind">) {
  const others = activeWallets(wallets).filter((item) => item.id !== wallet);
  if (line.ownKind !== "transfer") return (others.find((item) => item.type === "cash") ?? others[0])?.id;
  return others.find((item) => item.type !== "cash")?.id ?? others[0]?.id;
}

type Draft<T> = Omit<T, "id" | "kind" | "createdAt" | "updatedAt" | "deletedAt" | "dirty">;
export type ImportDrafts = { expenses: Draft<ManualExpense>[]; incomes: Draft<Income>[]; transfers: Draft<Transfer>[] };

type ImportOptions = {
  /** The statement's pocket (none without pockets). */
  wallet?: Wallet;
  tag: StatementTag;
  /** The other pocket of each move ("own"), by line key: a move without one is not imported. */
  others: Record<string, string | undefined>;
  /** The note of a fees line ("Frais"). */
  feesNote: string;
};

/**
 * The records to write for the lines chosen: an expense per payment, an
 * income per money received, a move between pockets per "own" operation (its
 * fees with it), and the fees of the others as an expense apart. All in the
 * statement's pocket, with the line's key, so never imported twice.
 */
export function importDrafts(lines: StatementLine[], { wallet, tag, others, feesNote }: ImportOptions): ImportDrafts {
  const drafts: ImportDrafts = { expenses: [], incomes: [], transfers: [] };
  const pocket = wallet ? { wallet: wallet.id } : {};
  const payment = paymentForWallet(wallet);
  const fees = (line: StatementLine) => {
    if (line.feesMga > 0)
      drafts.expenses.push({ at: line.at, amountMga: line.feesMga, category: "phone", note: feesNote, payment, sourceKey: feesKey(line.key), statement: tag, ...pocket });
  };
  for (const line of lines) {
    const note = line.counterparty;
    if (line.direction === "own") {
      const other = others[line.key];
      if (!wallet || !other || other === wallet.id) continue;
      const [from, to] = line.side === "debit" ? [wallet.id, other] : [other, wallet.id];
      drafts.transfers.push({ from, to, at: line.at, amountMga: line.amountMga, ...(line.feesMga > 0 && { feesMga: line.feesMga }), note, sourceKey: line.key, reference: line.reference, statement: tag });
      continue;
    }
    if (line.direction === "in") {
      const stored = storedIncome(line.income);
      drafts.incomes.push({ at: line.at, amountMga: line.amountMga, income: stored.kind, ...(stored.from && { from: stored.from }), note, sourceKey: line.key, reference: line.reference, statement: tag, ...pocket });
    } else {
      drafts.expenses.push({ at: line.at, amountMga: line.amountMga, category: line.category, note, payment, sourceKey: line.key, reference: line.reference, statement: tag, ...pocket });
    }
    fees(line);
  }
  return drafts;
}

/** The statement's tag: its operator or bank and its period (the first and last operations when none is printed). */
export function statementTag(statement: Statement, lines: StatementLine[], fallbackName: string): StatementTag {
  const days = lines.map((line) => line.at);
  const from = parseDay(statement.periodStart) ?? (days.length ? Math.min(...days) : undefined);
  const to = parseDay(statement.periodEnd) ?? (days.length ? Math.max(...days) : undefined);
  return { name: statement.institution?.trim().slice(0, 40) || fallbackName, ...(from !== undefined && { from }), ...(to !== undefined && { to }) };
}

/** What a pocket held at the end of a day: its balance now, less what moved it after that day. Null before the pocket was set. */
export function balanceOn(book: WalletBook, walletId: string, at: number): number | null {
  const wallet = book.context.byId.get(walletId);
  if (!wallet || dayStart(at) < dayStart(wallet.startAt)) return null;
  const day = new Date(at);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const later = (book.movements.get(walletId) ?? []).filter((movement) => movement.at >= end).reduce((sum, movement) => sum + movement.amountMga, 0);
  return (book.balances.get(walletId) ?? 0) - later;
}

/**
 * "Set your MVola pocket to 230,000 Ar?": when the statement gives its final
 * balance and the pocket held something else on its last day. The
 * difference is the correction to write now (what moved since is the same).
 */
export function balanceProposal(book: WalletBook, walletId: string | undefined, statement: Statement, lines: StatementLine[]) {
  if (!walletId || statement.closingBalance === null || !Number.isFinite(statement.closingBalance)) return null;
  const at = parseDay(statement.periodEnd) ?? (lines.length ? Math.max(...lines.map((line) => line.at)) : null);
  if (at === null) return null;
  const held = balanceOn(book, walletId, at);
  if (held === null) return null;
  const actual = Math.round(statement.closingBalance);
  const difference = correctionFor(held, actual);
  return difference === 0 ? null : { at, actual, held, difference };
}
