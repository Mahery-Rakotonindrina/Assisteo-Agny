import { byKind, dayStart, DUE_REMINDER_HOUR, type ExpenseRecord, type SavingsDeposit, type SavingsGoal, type Tontine } from "@/lib/expenses";

// Savings goals and tontines: money set aside, neither spent nor earned. Pure,
// so it can be tested. A deposit leaves its pocket (lib/wallets.ts), taking
// it back returns it, and the tontine's pot comes into a pocket. "Il te
// reste" never changes.

const sum = (deposits: SavingsDeposit[]) => deposits.reduce((total, deposit) => total + deposit.amountMga, 0);

export const goalsOf = (records: ExpenseRecord[]) => byKind(records, "savingsGoal").sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
export const tontinesOf = (records: ExpenseRecord[]) => byKind(records, "tontine").sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

/** What a goal holds: what was put in, minus what was taken back (never below 0). */
export const goalSaved = (goal: Pick<SavingsGoal, "deposits">) => Math.max(0, sum(goal.deposits ?? []));

/**
 * "60 000 Ar par mois pour y arriver": what is missing, over the months left
 * (the month of the date counted, at least one). Null without a date, once
 * reached, or once the date has passed.
 */
export function goalPerMonth(goal: Pick<SavingsGoal, "deposits" | "targetMga" | "dueAt">, now: number) {
  const missing = goal.targetMga - goalSaved(goal);
  if (!goal.dueAt || missing <= 0 || dayStart(goal.dueAt) < dayStart(now)) return null;
  const due = new Date(goal.dueAt);
  const today = new Date(now);
  const months = Math.max(1, (due.getFullYear() - today.getFullYear()) * 12 + due.getMonth() - today.getMonth());
  return Math.ceil(missing / months / 1000) * 1000;
}

/** The day of a tontine's round (0 = the first), local midnight. */
export function roundDay(tontine: Pick<Tontine, "startAt" | "frequency">, round: number) {
  const start = new Date(tontine.startAt);
  if (tontine.frequency === "weekly") return new Date(start.getFullYear(), start.getMonth(), start.getDate() + round * 7).getTime();
  // Monthly: the same day, or the month's last when shorter (31 → 30).
  const last = new Date(start.getFullYear(), start.getMonth() + round + 1, 0).getDate();
  return new Date(start.getFullYear(), start.getMonth() + round, Math.min(start.getDate(), last)).getTime();
}

export type TontineStatus = {
  /** What the user paid in so far. */
  paid: number;
  /** What each round's pot holds: every member's payment. */
  pot: number;
  /** When the user gets the pot. */
  turnAt: number;
  received: boolean;
  /** The next payment due (the round after the payments made), or null once all are made. */
  next: { round: number; at: number; late: boolean } | null;
  /** Payments made, out of the rounds. */
  rounds: { done: number; total: number };
};

/** Where a tontine stands: what was paid, the pot, when it comes, the next payment. */
export function tontineStatus(tontine: Pick<Tontine, "amountMga" | "members" | "startAt" | "frequency" | "myTurn" | "deposits" | "received">, now: number): TontineStatus {
  const members = Math.max(1, Math.round(tontine.members));
  const done = (tontine.deposits ?? []).filter((deposit) => deposit.amountMga > 0).length;
  const turn = Math.min(members, Math.max(1, Math.round(tontine.myTurn)));
  const nextAt = done < members ? roundDay(tontine, done) : null;
  return {
    paid: Math.max(0, sum(tontine.deposits ?? [])),
    pot: tontine.amountMga * members,
    turnAt: roundDay(tontine, turn - 1),
    received: Boolean(tontine.received),
    next: nextAt === null ? null : { round: done + 1, at: nextAt, late: nextAt < dayStart(now) },
    rounds: { done, total: members },
  };
}

/**
 * How the next payment reads: late, still to pay once the pot is received
 * (the user pays every round, their own included), or the next one.
 */
export function nextPaymentKey(status: Pick<TontineStatus, "next" | "received">): "late" | "stillToPay" | "next" | "allPaid" {
  if (!status.next) return "allPaid";
  if (status.next.late) return "late";
  return status.received ? "stillToPay" : "next";
}

/** A tontine's set-aside money: what was paid in, until the pot comes back. */
const tontineHeld = (tontine: Tontine) => (tontine.received ? 0 : Math.max(0, sum(tontine.deposits ?? [])));

/** "Mis de côté": every goal's money and what was paid into the tontines not received yet. */
export function savedTotal(records: ExpenseRecord[]) {
  return goalsOf(records).reduce((total, goal) => total + goalSaved(goal), 0) + tontinesOf(records).reduce((total, tontine) => total + tontineHeld(tontine), 0);
}

/** A pocket's change from the money set aside: out when put aside, back when taken back or when the pot comes. */
export type SavingsMove = { key: string; wallet: string; at: number; amountMga: number; name: string; type: "saved" | "unsaved" | "pot" };

export function savingsMoves(records: ExpenseRecord[]): SavingsMove[] {
  const moves: SavingsMove[] = [];
  const add = (key: string, name: string, deposit: SavingsDeposit) => {
    if (!deposit.wallet || !deposit.amountMga) return;
    moves.push({ key, wallet: deposit.wallet, at: deposit.at, amountMga: -deposit.amountMga, name, type: deposit.amountMga > 0 ? "saved" : "unsaved" });
  };
  for (const goal of goalsOf(records)) for (const deposit of goal.deposits ?? []) add(`savings:${goal.id}:${deposit.id}`, goal.name, deposit);
  for (const tontine of tontinesOf(records)) {
    for (const deposit of tontine.deposits ?? []) add(`tontine:${tontine.id}:${deposit.id}`, tontine.name, deposit);
    const pot = tontine.received;
    if (pot?.wallet && pot.amountMga > 0) moves.push({ key: `tontine:${tontine.id}:pot`, wallet: pot.wallet, at: pot.at, amountMga: pot.amountMga, name: tontine.name, type: "pot" });
  }
  return moves;
}

// ---- Tontine reminders ------------------------------------------------------------------

export type TontineAlert = { tontine: Tontine; dueAt: number; at: number };

/** The day before the next payment, at 9:00, when still to come; else null. */
export function nextTontineReminder(tontine: Tontine, now: number): TontineAlert | null {
  if (tontine.deletedAt || !tontine.remind) return null;
  const { next } = tontineStatus(tontine, now);
  if (!next) return null;
  const due = new Date(next.at);
  const at = new Date(due.getFullYear(), due.getMonth(), due.getDate() - 1, DUE_REMINDER_HOUR).getTime();
  return at > now ? { tontine, dueAt: next.at, at } : null;
}
