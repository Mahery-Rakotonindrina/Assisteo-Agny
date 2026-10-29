import type { MobileMoneyOperator, OwnKind, ReceiptPayment } from "@/lib/ai/schema";
import {
  arrivalKey,
  byKind,
  dayStart,
  keepKey,
  linkedKeys,
  monthExpenses,
  monthIncomes,
  monthKey,
  shiftMonth,
  type ExpenseOrigin,
  type ExpenseRecord,
  type IncomeOrigin,
  type PaymentMethod,
  type SourceItem,
  type Transfer,
  type Wallet,
  type WalletType,
} from "@/lib/expenses";
import { savedTotal, savingsMoves } from "@/lib/savings";

// "Mes poches": where the money really is (cash, MVola, the bank…). Pure, so
// it can be tested. A pocket starts from what it held on a day; every line
// counted after that (expenses, incomes), the moves between pockets (by hand
// or read from a scanned withdrawal) and the corrections move it. "Il te
// reste" (the month's incomes minus its expenses) doesn't change: a move
// between pockets is neither spent nor earned, only its fees are.

export const mobileMoneyTypes: readonly WalletType[] = ["mvola", "orange_money", "airtel_money"];

/** The pockets offered the first time. */
export const commonWalletTypes = ["cash", "mvola", "orange_money", "airtel_money", "bank"] as const satisfies readonly WalletType[];

export const walletColors: Record<WalletType, string> = {
  cash: "#2e9e5b",
  mvola: "#d4a400",
  orange_money: "#f07800",
  airtel_money: "#d63a3a",
  bank: "#2f80c8",
  other: "#8a8f98",
};

/** Every pocket (archived ones included), the oldest first. */
export const walletsOf = (records: ExpenseRecord[]) => byKind(records, "wallet").sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

export const activeWallets = (wallets: Wallet[]) => wallets.filter((wallet) => !wallet.archived);

/** The pocket used when nothing says otherwise: the one marked, else cash, else the first. */
export function primaryWallet(wallets: Wallet[]) {
  const active = activeWallets(wallets);
  return active.filter((wallet) => wallet.primary).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? active.find((wallet) => wallet.type === "cash") ?? active[0];
}

/** A pocket of that type: the default one if it is, else the first. */
function ofType(wallets: Wallet[], type: WalletType) {
  const matching = activeWallets(wallets).filter((wallet) => wallet.type === type);
  const primary = primaryWallet(wallets);
  return matching.find((wallet) => wallet.id === primary?.id) ?? matching[0];
}

/** The Mobile Money pocket: the default one if it is, else the first; with `onlyOne`, none when there are several. */
function mobileWallet(wallets: Wallet[], onlyOne = false) {
  const matching = activeWallets(wallets).filter((wallet) => mobileMoneyTypes.includes(wallet.type));
  if (onlyOne) return matching.length === 1 ? matching[0] : undefined;
  const primary = primaryWallet(wallets);
  return matching.find((wallet) => wallet.id === primary?.id) ?? matching[0];
}

/** The pocket a payment method stands for: cash, the Mobile Money pocket, the bank (card). */
export function walletForPayment(wallets: Wallet[], payment: PaymentMethod | undefined) {
  if (payment === "cash") return ofType(wallets, "cash");
  if (payment === "mobile") return mobileWallet(wallets);
  if (payment === "card") return ofType(wallets, "bank");
  return undefined;
}

/** The payment method a pocket stands for, kept on the expense for older apps. */
export function paymentForWallet(wallet: Pick<Wallet, "type"> | undefined): PaymentMethod | undefined {
  if (!wallet) return undefined;
  if (wallet.type === "cash") return "cash";
  if (wallet.type === "bank") return "card";
  return mobileMoneyTypes.includes(wallet.type) ? "mobile" : undefined;
}

type ReceiptHint = { paidWith?: ReceiptPayment; operator?: MobileMoneyOperator };

/** Where a receipt's money went through: its operator's pocket, else the only Mobile Money one, cash, the bank. */
function receiptWallet(wallets: Wallet[], { paidWith, operator }: ReceiptHint) {
  if (operator) {
    const own = ofType(wallets, operator);
    if (own) return own;
  }
  if (paidWith === "mobile_money" || operator) return mobileWallet(wallets, true);
  if (paidWith === "cash") return ofType(wallets, "cash");
  if (paidWith === "card") return ofType(wallets, "bank");
  return undefined;
}

export type WalletContext = { wallets: Wallet[]; byId: Map<string, Wallet>; picks: Map<string, string>; primary?: Wallet };

export function walletContext(records: ExpenseRecord[]): WalletContext {
  const wallets = walletsOf(records);
  return {
    wallets,
    byId: new Map(wallets.map((wallet) => [wallet.id, wallet])),
    picks: new Map(byKind(records, "walletPick").map((pick) => [pick.sourceKey, pick.wallet])),
    primary: primaryWallet(wallets),
  };
}

/** A month's line, as far as its pocket goes. */
export type WalletLine = ReceiptHint & {
  key: string;
  /** A withdrawal's fees: they follow the pocket picked for the withdrawal. */
  feesOf?: string;
  wallet?: string;
  record?: { wallet?: string; payment?: PaymentMethod };
  recurring?: { payment?: PaymentMethod };
};

const known = (context: WalletContext, id: string | undefined) => (id && context.byId.has(id) ? id : undefined);

/**
 * The pocket a line is counted in: the one picked (computed lines) or typed
 * in, else what its payment says (a receipt: its operator), else the default
 * pocket. A line from before the pockets has none: the default one.
 */
export function lineWallet(context: WalletContext, line: WalletLine): string | undefined {
  return (
    known(context, context.picks.get(line.feesOf ?? line.key)) ??
    known(context, line.record?.wallet) ??
    known(context, line.wallet) ??
    walletForPayment(context.wallets, line.record?.payment ?? line.recurring?.payment)?.id ??
    receiptWallet(context.wallets, line)?.id ??
    context.primary?.id
  );
}

// ---- Moves between pockets ------------------------------------------------------------

/** Money moved between one's own pockets: typed in, or read from a scanned receipt. */
export type PocketMove = {
  key: string;
  at: number;
  /** What arrives (the fees apart: they are an expense). */
  amountMga: number;
  from?: string;
  to?: string;
  enteredAt?: number;
  label?: string;
  href?: string;
  ownKind?: OwnKind;
  /** Read from a scan: the pockets follow its operator until the user picks them. */
  auto: boolean;
  transfer?: Transfer;
};

/** A move whose arrival (or start) is still to choose: only the side known counts. */
export const isPending = (move: Pick<PocketMove, "from" | "to">) => !move.from || !move.to;

/**
 * The scanned moves between one's own pockets (receipts "own" of the AI),
 * computed, never copied: a withdrawal goes from the operator's pocket to
 * cash, a deposit the other way, a transfer from the operator's pocket to
 * the one the user picks. The fees stay the expense line of the receipt. A
 * receipt counted as an expense ("it's an expense", or typed in) moves
 * nothing.
 */
export function scannedMoves(records: ExpenseRecord[], sources: SourceItem[], context = walletContext(records)): PocketMove[] {
  const linked = linkedKeys(records);
  const marks = new Set(byKind(records, "exclusion").map((record) => record.sourceKey));
  const manual = byKind(records, "expense");
  const transfers = byKind(records, "transfer");
  const moves: PocketMove[] = [];
  for (const source of sources) {
    if (!source.own || source.sameAs || linked.has(source.key) || marks.has(keepKey(source.key))) continue;
    if (source.scanId && (manual.some((record) => record.scanId === source.scanId) || transfers.some((transfer) => transfer.scanId === source.scanId))) continue;
    const fees = sources.find((other) => other.feesOf === source.key)?.amountMga ?? 0;
    const amountMga = source.amountMga - fees;
    if (amountMga <= 0) continue;
    const start = known(context, context.picks.get(source.key));
    const arrival = known(context, context.picks.get(arrivalKey(source.key)));
    const account = receiptWallet(context.wallets, source)?.id;
    const cash = ofType(context.wallets, "cash")?.id;
    const [from, to] = source.ownKind === "withdrawal" ? [start ?? account, arrival ?? cash] : source.ownKind === "deposit" ? [start ?? cash, arrival ?? account] : [start ?? account, arrival];
    moves.push({
      key: source.key,
      at: source.at,
      amountMga,
      ...(from && { from }),
      ...(to && { to }),
      enteredAt: source.scannedAt,
      label: source.label,
      href: source.href,
      ownKind: source.ownKind,
      auto: true,
    });
  }
  return moves;
}

/** The moves typed in. */
export const typedMoves = (records: ExpenseRecord[]): PocketMove[] =>
  byKind(records, "transfer").map((transfer) => ({
    key: `transfer:${transfer.id}`,
    at: transfer.at,
    amountMga: transfer.amountMga,
    from: transfer.from,
    to: transfer.to,
    enteredAt: transfer.createdAt,
    label: transfer.note,
    auto: false,
    transfer,
  }));

// ---- Balances -------------------------------------------------------------------------

/** "saved": put aside (a goal, a tontine payment); "unsaved": taken back; "pot": the tontine's pot received. */
export type MovementType = "expense" | "income" | "move_in" | "move_out" | "correction" | "saved" | "unsaved" | "pot";

/** One change to a pocket, signed (negative: money out). */
export type Movement = {
  key: string;
  type: MovementType;
  at: number;
  amountMga: number;
  label?: string;
  category?: string;
  origin?: ExpenseOrigin | IncomeOrigin;
  /** A move whose other side is still to choose. */
  pending?: boolean;
};

export type WalletBook = {
  context: WalletContext;
  /** What each pocket holds now (archived ones included). */
  balances: Map<string, number>;
  /** Each pocket's movements, the latest first. */
  movements: Map<string, Movement[]>;
  /** Every move between pockets, the latest first. */
  moves: PocketMove[];
  /** Everything in the pockets shown (archived ones left out). */
  total: number;
  /** Money set aside (goals, tontines): out of the pockets, so out of the total. */
  saved: number;
};

/** At most 20 years of months are read back, from the oldest pocket. */
const MAX_MONTHS = 240;

/**
 * Counts on a pocket what happens after its starting balance: a line dated
 * by its day only, on that same day, counts when typed in (or scanned) after
 * the pocket was set. Nothing of a day to come counts yet.
 */
export function countsOn(wallet: Pick<Wallet, "startAt"> | undefined, at: number, enteredAt: number | undefined, now: number) {
  if (!wallet || dayStart(at) > dayStart(now)) return false;
  const when = enteredAt !== undefined && dayStart(at) === dayStart(wallet.startAt) ? Math.max(at, enteredAt) : at;
  return when >= wallet.startAt;
}

/**
 * Every pocket's balance: what it held at the start, plus the incomes, minus
 * the expenses (counted lines only), plus the moves in, minus the moves out,
 * plus the corrections.
 */
export function walletBook(records: ExpenseRecord[], sources: SourceItem[], now: number): WalletBook {
  const context = walletContext(records);
  const balances = new Map(context.wallets.map((wallet) => [wallet.id, wallet.startMga]));
  const movements = new Map<string, Movement[]>(context.wallets.map((wallet) => [wallet.id, []]));
  const add = (walletId: string | undefined, at: number, enteredAt: number | undefined, movement: Omit<Movement, "at">) => {
    const wallet = walletId ? context.byId.get(walletId) : undefined;
    if (!wallet || !countsOn(wallet, at, enteredAt, now)) return;
    balances.set(wallet.id, (balances.get(wallet.id) ?? 0) + movement.amountMga);
    movements.get(wallet.id)!.push({ ...movement, at });
  };
  const moves = [...typedMoves(records), ...scannedMoves(records, sources, context)].sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  const saved = savedTotal(records);
  if (context.wallets.length === 0) return { context, balances, movements, moves, total: 0, saved };

  const first = monthKey(Math.min(...context.wallets.map((wallet) => wallet.startAt)));
  const last = monthKey(now);
  for (let month = first, step = 0; month <= last && step < MAX_MONTHS; month = shiftMonth(month, 1), step += 1) {
    for (const item of monthExpenses(records, sources, month)) {
      if (item.excluded) continue;
      add(lineWallet(context, item), item.at, item.record?.createdAt ?? item.enteredAt ?? (item as SourceItem).scannedAt, {
        key: item.key,
        type: "expense",
        amountMga: -item.amountMga,
        label: item.label,
        category: item.category,
        origin: item.origin,
      });
    }
    for (const item of monthIncomes(records, month, sources)) {
      if (item.excluded) continue;
      add(lineWallet(context, item), item.at, item.record?.createdAt ?? item.scannedAt, { key: item.key, type: "income", amountMga: item.amountMga, label: item.label, origin: item.origin });
    }
  }
  for (const move of moves) {
    const pending = isPending(move);
    add(move.from, move.at, move.enteredAt, { key: move.key, type: "move_out", amountMga: -move.amountMga, label: move.label, pending });
    add(move.to, move.at, move.enteredAt, { key: move.key, type: "move_in", amountMga: move.amountMga, label: move.label, pending });
  }
  for (const correction of byKind(records, "correction"))
    add(correction.wallet, correction.at, correction.createdAt, { key: `correction:${correction.id}`, type: "correction", amountMga: correction.amountMga });
  for (const move of savingsMoves(records)) add(move.wallet, move.at, move.at, { key: move.key, type: move.type, amountMga: move.amountMga, label: move.name });

  for (const list of movements.values()) list.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  const total = activeWallets(context.wallets).reduce((sum, wallet) => sum + (balances.get(wallet.id) ?? 0), 0);
  return { context, balances, movements, moves, total, saved };
}

/** "My balance is really…": the correction to write (0: nothing to do). */
export const correctionFor = (balance: number, actual: number) => Math.round(actual) - balance;

/** The moves read from a scan whose other pocket is still to choose, from when the pockets were set. */
export function pendingMoves(book: WalletBook, now: number) {
  const since = Math.min(...book.context.wallets.map((wallet) => wallet.startAt));
  return book.moves.filter((move) => move.auto && isPending(move) && countsOn({ startAt: since }, move.at, move.enteredAt, now));
}

/** The pocket of the latest expense or income typed in with one: offered first next time. */
export function lastUsedWallet(records: ExpenseRecord[], context: WalletContext) {
  let latest: { at: number; wallet: string } | undefined;
  for (const record of records)
    if ((record.kind === "expense" || record.kind === "income") && !record.deletedAt && record.wallet && context.byId.get(record.wallet) && !context.byId.get(record.wallet)!.archived)
      if (!latest || record.createdAt > latest.at) latest = { at: record.createdAt, wallet: record.wallet };
  return latest?.wallet;
}
