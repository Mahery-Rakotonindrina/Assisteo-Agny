import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { pocketMonths } from "@/lib/expenseExport";
import { byKind, exclusionId, monthBalance, monthExpenses, monthIncomes, receiptKey, sourceItems, type Exclusion, type ExpenseRecord, type ReceiptScan, type Wallet } from "@/lib/expenses";
import { mockReceipt } from "@/lib/ai/mock";
import { linkedRepayment, loanMoves, namesMatch, repaymentKeys, repaymentProposal, repaymentSurplus, surplusDraft, surplusId } from "@/lib/loanLink";
import { loanEntryId, loanReminders, loanTapTarget, upcomingDue, LOAN_DAY_HOUR, LOAN_EVE_HOUR } from "@/lib/loanReminders";
import { loanRemaining, type Loan } from "@/lib/loans";
import { walletBook } from "@/lib/wallets";
import { expenseStore } from "@/services/expenseStore";
import { linkSameRepayment, recordRepayment, removeRepayment, undoRepayment } from "@/services/loanLink";
import { reconcileLoanReminderState, type LoanReminderDeps, type ScheduledLoanReminders } from "@/services/loanReminders";
import { loanStore } from "@/services/loanStore";
import { handleNotificationTap, tapTarget } from "@/services/notificationTap";

const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const midnight = (year: number, month: number, date: number) => new Date(year, month - 1, date).getTime();
const start = day(2026, 10, 1, 8);
const now = day(2026, 10, 29, 18);
const base = { createdAt: start, updatedAt: start };

const wallet = (id: string, type: Wallet["type"], startMga: number): Wallet => ({ ...base, kind: "wallet", id, name: id, type, startMga, startAt: start });
const pockets = [wallet("cash", "cash", 45000), wallet("mvola", "mvola", 230000)];
const loan = (id: string, patch: Partial<Loan> = {}): Loan => ({ id, direction: "lent", person: "Rakoto", amountMga: 50000, at: day(2026, 10, 5), repayments: [], updatedAt: start, ...patch });
const repayment = (id: string, at: number, amountMga: number, patch: Partial<Loan["repayments"][number]> = {}) => ({ id, at, amountMga, ...patch });

const scan = (id: string, merchant: string, total: number, direction: "in" | "out" = "in", date = "2026-10-22"): ReceiptScan => {
  const demo = mockReceipt("fr", direction);
  return { id, createdAt: day(2026, 10, 22), analysis: { document: { ...demo.document!, receipt: { ...demo.document!.receipt!, merchant, total, date, reference: `REF-${id}` } } } };
};

describe("loans in the pockets", () => {
  it("lending takes money out of its pocket, a repayment brings it back; borrowing the other way round", () => {
    const loans = [
      loan("l1", { wallet: "mvola", repayments: [repayment("r1", day(2026, 10, 12), 20000, { wallet: "cash" })] }),
      loan("b1", { direction: "borrowed", person: "Épicerie Rabe", amountMga: 30000, wallet: "cash", repayments: [repayment("r2", day(2026, 10, 15), 10000)] }),
    ];
    const book = walletBook(pockets, [], now, loans);
    // MVola: 230 000 − 50 000 lent; cash: 45 000 + 20 000 back + 30 000 borrowed − 10 000 paid back.
    expect(Object.fromEntries(book.balances)).toEqual({ cash: 85000, mvola: 180000 });
    expect(book.movements.get("cash")!.map((movement) => [movement.loan?.type, movement.label, movement.amountMga])).toEqual([
      ["repaid_out", "Épicerie Rabe", -10000],
      ["repaid_in", "Rakoto", 20000],
      ["borrowed", "Épicerie Rabe", 30000],
    ]);
    expect(book.movements.get("cash")![0].loan).toEqual({ type: "repaid_out", personKey: "epicerie rabe", direction: "borrowed" });
  });

  it("is neither an expense nor an income: « Il te reste » doesn't move", () => {
    const loans = [loan("l1", { wallet: "mvola", repayments: [repayment("r1", day(2026, 10, 12), 20000)] })];
    const balance = monthBalance(monthExpenses(pockets, [], "2026-10"), monthIncomes(pockets, "2026-10", []));
    expect(balance).toEqual({ spent: 0, earned: 0, left: 0 });
    expect(walletBook(pockets, [], now, loans).total).toBe(275000 - 50000 + 20000);
  });

  it("a loan without a pocket moves nothing; its repayment in a pocket does", () => {
    expect(loanMoves([loan("l1")])).toEqual([]);
    expect(walletBook(pockets, [], now, [loan("l1")]).total).toBe(275000);
    const back = loan("l1", { repayments: [repayment("r1", day(2026, 10, 12), 20000, { wallet: "cash" })] });
    expect(walletBook(pockets, [], now, [back]).balances.get("cash")).toBe(65000);
  });

  it("never counts more than the total to pay back, nor a deleted loan, nor what came before the pocket", () => {
    const over = loan("l1", { wallet: "cash", repayments: [repayment("r1", day(2026, 10, 10), 40000), repayment("r2", day(2026, 10, 11), 40000)] });
    expect(loanMoves([over]).map((move) => move.amountMga)).toEqual([-50000, 40000, 10000]);
    expect(loanMoves([loan("l2", { wallet: "cash", deletedAt: start })])).toEqual([]);
    const before = loan("l3", { wallet: "cash", at: day(2026, 9, 20) });
    expect(walletBook(pockets, [], now, [before]).balances.get("cash")).toBe(45000);
  });

  it("the pockets' export counts them with the moves, start + in − out + moves = end", () => {
    const loans = [loan("l1", { wallet: "mvola", repayments: [repayment("r1", day(2026, 10, 12), 20000, { wallet: "cash" })] })];
    const rows = pocketMonths(walletBook(pockets, [], now, loans), "2026-10");
    expect(rows.map((row) => [row.name, row.start, row.incomes, row.expenses, row.moves, row.end])).toEqual([
      ["cash", 45000, 0, 0, 20000, 65000],
      ["mvola", 230000, 0, 0, -50000, 180000],
    ]);
    for (const row of rows) expect(row.start + row.incomes - row.expenses + row.moves).toBe(row.end);
  });
});

describe("names", () => {
  it("compares the words, accents and case aside", () => {
    expect(namesMatch("Rakoto", "RAKOTO Jean")).toBe(true);
    expect(namesMatch("Épicerie Rabe", "Chez Rabe")).toBe(true);
    expect(namesMatch("Rakotó", "rakoto")).toBe(true);
    expect(namesMatch("Rasoa", "Rakoto Jean")).toBe(false);
    // Very short words are left out ("de", "l'").
    expect(namesMatch("Fara de Tana", "Jean de Fianar")).toBe(false);
    expect(namesMatch(undefined, "Rakoto")).toBe(false);
  });

  it("titles and shop words alone are not a name in common", () => {
    expect(namesMatch("Mme Rasoa", "Mme Fara")).toBe(false);
    expect(namesMatch("l’épicerie", "Epicerie Chez Rabe")).toBe(false);
    expect(namesMatch("Chez Koto", "Chez Rabe")).toBe(false);
    expect(namesMatch("Boutique SARL Ets", "Magasin SARL Station Pharmacie")).toBe(false);
    expect(namesMatch("Dr Rakoto", "Monsieur RAKOTO")).toBe(true);
  });
});

describe("« C'est un remboursement de… ? »", () => {
  const source = { key: receiptKey("s1"), at: midnight(2026, 10, 22), amountMga: 80000, label: "RAKOTO Jean", flow: "income" as const, scanId: "s1" };

  it("is offered for money received from someone who owes, on the oldest loan, capped to what is left", () => {
    const loans = [loan("new", { at: day(2026, 10, 10) }), loan("old", { at: day(2026, 10, 2) }), loan("other", { person: "Rasoa" })];
    const proposal = repaymentProposal(loans, source)!;
    expect(proposal.loan.id).toBe("old");
    expect(proposal.person).toBe("Rakoto");
    expect(proposal.amountMga).toBe(50000);
    // The 30 000 Ar beyond what was left stay an income.
    expect(proposal.surplusMga).toBe(30000);
    expect(repaymentSurplus(source, 50000)).toBe(30000);
    expect(repaymentSurplus(source, 80000)).toBe(0);
    expect(proposal.same).toBeUndefined();
  });

  it("not when nothing is left, nor without a name, nor for money paid out to a debtor", () => {
    const repaid = loan("l1", { repayments: [repayment("r1", day(2026, 10, 8), 50000)] });
    expect(repaymentProposal([repaid], source)).toBeUndefined();
    expect(repaymentProposal([loan("l1")], { ...source, label: undefined })).toBeUndefined();
    expect(repaymentProposal([loan("l1")], { ...source, flow: undefined })).toBeUndefined();
  });

  it("the other way: a payment to someone owed", () => {
    const owed = loan("b1", { direction: "borrowed", person: "Épicerie Rabe", amountMga: 20000 });
    const proposal = repaymentProposal([owed], { key: receiptKey("s2"), at: midnight(2026, 10, 22), amountMga: 15000, label: "Chez Rabe" })!;
    expect([proposal.loan.id, proposal.amountMga, proposal.surplusMga]).toEqual(["b1", 15000, 0]);
  });

  it("the surplus's record (a receipt or a statement's line): an income for money received, an expense for money paid", () => {
    const line = { key: "statement:abc", at: midnight(2026, 10, 22), amountMga: 25000 };
    expect(surplusDraft(line, 20000, "Surplus à Rabe", "cash")).toEqual({
      kind: "expense",
      draft: { id: surplusId("statement:abc"), at: line.at, amountMga: 5000, note: "Surplus à Rabe", wallet: "cash", category: "other" },
    });
    expect(surplusDraft({ ...line, flow: "income" }, 20000, "Surplus de Rakoto")).toEqual({
      kind: "income",
      draft: { id: surplusId("statement:abc"), at: line.at, amountMga: 5000, note: "Surplus de Rakoto", income: "other" },
    });
    expect(surplusDraft(line, 25000, "x")).toBeNull();
  });

  it("« déjà enregistré ? » with a repayment of the same amount typed in within 3 days", () => {
    const typed = loan("l1", { amountMga: 100000, repayments: [repayment("r1", day(2026, 10, 24), 80000)] });
    expect(repaymentProposal([typed], source)!.same?.repayment.id).toBe("r1");
    const later = loan("l1", { amountMga: 200000, repayments: [repayment("r1", day(2026, 10, 27), 80000)] });
    expect(repaymentProposal([later], source)!.same).toBeUndefined();
  });

  it("is gone once the line is a repayment", () => {
    const linked = loan("l1", { repayments: [repayment("r1", midnight(2026, 10, 22), 50000, { sourceKey: source.key })] });
    expect(linkedRepayment([linked], source.key)?.repayment.id).toBe("r1");
    expect(repaymentProposal([linked, loan("l2")], source)).toBeUndefined();
    expect(repaymentKeys([linked])).toEqual(new Set([source.key]));
  });
});

describe("« Oui », then « Annuler » (on the device)", () => {
  beforeEach(async () => {
    await loanStore.wipe();
    await expenseStore.wipe();
  });

  it("writes the repayment in the receipt's pocket, the line out of the incomes; undone together", async () => {
    const created = (await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 50000, at: day(2026, 10, 5), wallet: "mvola" }))!;
    const receipts = [scan("s1", "RAKOTO Jean", 80000)];
    const sources = sourceItems({ receipts });
    const line = sources.find((item) => item.key === receiptKey("s1"))!;
    const proposal = repaymentProposal(await loanStore.list(), { ...line, scanId: "s1" })!;
    expect(await recordRepayment(proposal, { ...line, scanId: "s1" }, "mvola", "Surplus de Rakoto")).toBe(50000);

    const after = (await loanStore.get(created.id))!;
    expect(loanRemaining(after)).toBe(0);
    expect(after.repayments[0]).toMatchObject({ amountMga: 50000, wallet: "mvola", sourceKey: receiptKey("s1"), scanId: "s1" });
    const records = await expenseStore.list();
    const incomes = monthIncomes(records, "2026-10", sources);
    expect(incomes.find((item) => item.key === receiptKey("s1"))!.excluded).toBe(true);
    // The 30 000 Ar beyond the 50 000 left are still an income, in the same pocket.
    expect(monthBalance([], incomes).earned).toBe(30000);
    expect(byKind(records, "income")).toMatchObject([{ id: surplusId(receiptKey("s1")), amountMga: 30000, note: "Surplus de Rakoto", wallet: "mvola", income: "other" }]);
    // The pocket: 50 000 out, 50 000 back, 30 000 of income: the receipt's 80 000 counted once.
    expect(walletBook([...pockets, ...records], sources, now, await loanStore.list()).balances.get("mvola")).toBe(260000);

    await undoRepayment(created.id, after.repayments[0]);
    expect((await loanStore.get(created.id))!.repayments).toEqual([]);
    const back = await expenseStore.list();
    expect(byKind(back, "exclusion")).toEqual([]);
    expect(byKind(back, "income")).toEqual([]);
    expect(monthBalance([], monthIncomes(back, "2026-10", sources)).earned).toBe(80000);
  });

  it("« C'est le même » links the repayment typed in; « Annuler » keeps it", async () => {
    const created = (await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 100000, at: day(2026, 10, 5) }))!;
    await loanStore.addRepayment(created.id, { amountMga: 80000, at: day(2026, 10, 23) });
    const source = { key: receiptKey("s1"), at: midnight(2026, 10, 22), amountMga: 80000, label: "Rakoto", flow: "income" as const, scanId: "s1" };
    const proposal = repaymentProposal(await loanStore.list(), source)!;
    await linkSameRepayment(proposal.same!, source);
    const linked = (await loanStore.get(created.id))!.repayments;
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ sourceKey: source.key, linked: true });
    expect(byKind(await expenseStore.list(), "exclusion").map((record: Exclusion) => record.id)).toEqual([exclusionId(source.key)]);

    await undoRepayment(created.id, linked[0]);
    const kept = (await loanStore.get(created.id))!.repayments;
    expect(kept).toHaveLength(1);
    expect(kept[0].sourceKey).toBeUndefined();
    expect(byKind(await expenseStore.list(), "exclusion")).toEqual([]);
  });

  it("a repayment removed from the card brings its line back", async () => {
    const created = (await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 50000, at: day(2026, 10, 5) }))!;
    await loanStore.addRepayment(created.id, { amountMga: 20000, at: day(2026, 10, 22), sourceKey: receiptKey("s1") });
    await expenseStore.setExcluded(receiptKey("s1"), true);
    await removeRepayment(created.id, (await loanStore.get(created.id))!.repayments[0]);
    expect(byKind(await expenseStore.list(), "exclusion")).toEqual([]);
  });

  it("an older loan edited without the pockets keeps its pocket", async () => {
    const created = (await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 50000, at: day(2026, 10, 5), wallet: "cash" }))!;
    expect(created.wallet).toBe("cash");
    await loanStore.edit(created.id, { direction: "lent", person: "Rakoto", amountMga: 60000, at: day(2026, 10, 5), wallet: created.wallet });
    expect((await loanStore.get(created.id))!.wallet).toBe("cash");
  });
});

describe("due-day reminders", () => {
  const due = midnight(2026, 11, 5);

  it("the day before at 9 h, and for money lent the day itself to chase it up", () => {
    const reminders = loanReminders([loan("l1", { dueAt: due }), loan("b1", { direction: "borrowed", person: "l’épicerie", amountMga: 20000, dueAt: due })], now);
    expect(reminders.map((item) => [item.kind, item.direction, new Date(item.at).getDate(), new Date(item.at).getHours(), item.amountMga])).toEqual([
      ["eve", "borrowed", 4, LOAN_EVE_HOUR, 20000],
      ["eve", "lent", 4, LOAN_EVE_HOUR, 50000],
      ["day", "lent", 5, LOAN_DAY_HOUR, 50000],
    ]);
    expect(reminders.map((item) => item.entryId)).toEqual(["loan:borrowed:l’epicerie", "loan:lent:rakoto", "loan:nudge:rakoto"]);
  });

  it("an installment past and unpaid doesn't hide the next one", () => {
    const schedule = [
      { id: "e1", dueAt: midnight(2026, 10, 20), amountMga: 25000 },
      { id: "e2", dueAt: midnight(2026, 11, 20), amountMga: 25000 },
    ];
    const late = loan("l1", { schedule, dueAt: schedule[1].dueAt });
    expect(upcomingDue(late, now)).toEqual({ dueAt: schedule[1].dueAt, amountMga: 25000, scheduled: true });
    expect(loanReminders([late], now).map((item) => [item.kind, new Date(item.at).getMonth() + 1, new Date(item.at).getDate()])).toEqual([
      ["eve", 11, 19],
      ["day", 11, 20],
    ]);
    // Every installment past: nothing to remind any more.
    expect(loanReminders([late], day(2026, 11, 21))).toEqual([]);
  });

  it("follow the schedule's next installment (loanNextDue), not the last day", () => {
    const schedule = [
      { id: "e1", dueAt: midnight(2026, 10, 20), amountMga: 25000 },
      { id: "e2", dueAt: midnight(2026, 11, 20), amountMga: 25000 },
    ];
    const reminders = loanReminders([loan("l1", { schedule, dueAt: schedule[1].dueAt, repayments: [repayment("r1", day(2026, 10, 20), 25000)] })], now);
    expect(reminders.map((item) => [item.kind, new Date(item.at).getMonth() + 1, new Date(item.at).getDate(), item.amountMga])).toEqual([
      ["eve", 11, 19, 25000],
      ["day", 11, 20, 25000],
    ]);
  });

  it("none for a repaid loan, one without a due day, one past, or switched off", () => {
    const repaid = loan("l1", { dueAt: due, repayments: [repayment("r1", day(2026, 10, 20), 50000)] });
    expect(loanReminders([repaid, loan("l2"), loan("l3", { dueAt: midnight(2026, 10, 20) })], now)).toEqual([]);
    expect(loanReminders([loan("l1", { dueAt: due })], now, false)).toEqual([]);
    // Tomorrow's: the eve's time is past, the day's still to come.
    expect(loanReminders([loan("l1", { dueAt: midnight(2026, 10, 30) })], now).map((item) => item.kind)).toEqual(["day"]);
  });

  it("tapped, opens the person; the day's one with « Relancer sur WhatsApp » in sight", () => {
    expect(loanTapTarget(loanEntryId("day", "lent", "rakoto"))).toEqual({ pathname: "/loans", query: { person: "rakoto", nudge: "1" } });
    expect(tapTarget(loanEntryId("eve", "borrowed", "l’epicerie"))).toEqual({ pathname: "/loans", query: { dir: "borrowed", person: "l’epicerie" } });
    expect(tapTarget("loan:lent:rakoto")).toEqual({ pathname: "/loans", query: { person: "rakoto" } });
  });

  it("a snooze button on a loan's notification just opens it", async () => {
    const opened: unknown[] = [];
    await handleNotificationTap("loan:nudge:rakoto", "snooze-1h", 7, { snooze: async () => 1, open: (target) => opened.push(target) });
    expect(opened).toEqual([{ pathname: "/loans", query: { person: "rakoto", nudge: "1" } }]);
  });

  it("are scheduled once, rescheduled when the amount changes, cancelled when switched off", async () => {
    let saved: ScheduledLoanReminders = {};
    let nextId = 1;
    const notified: string[] = [];
    const cancelled: number[] = [];
    const deps: LoanReminderDeps = {
      permission: async () => "granted",
      notify: async ({ body }) => {
        notified.push(body);
        return nextId++;
      },
      cancel: async (id) => {
        cancelled.push(id);
      },
      pending: async () => null,
      load: () => saved,
      save: (value) => {
        saved = value;
      },
    };
    const texts = (item: { person: string; amountMga: number; kind: string }) => ({ title: item.kind, body: `${item.person} ${item.amountMga}` });
    const loans = [loan("l1", { dueAt: due })];
    await reconcileLoanReminderState(loans, texts, deps, { now });
    await reconcileLoanReminderState(loans, texts, deps, { now });
    expect(notified).toEqual(["Rakoto 50000", "Rakoto 50000"]);
    expect(Object.keys(saved)).toHaveLength(2);

    const partly = [loan("l1", { dueAt: due, repayments: [repayment("r1", day(2026, 10, 29, 10), 20000)] })];
    await reconcileLoanReminderState(partly, texts, deps, { now });
    expect(cancelled).toEqual([1, 2]);
    expect(notified.slice(2)).toEqual(["Rakoto 30000", "Rakoto 30000"]);

    await reconcileLoanReminderState(partly, texts, { ...deps, permission: async () => "denied" }, { now, enabled: false });
    expect(saved).toEqual({});
    expect(cancelled).toEqual([1, 2, 3, 4]);
  });
});

describe("the income line", () => {
  it("a received receipt kept out as a repayment is no income any more", () => {
    const sources = sourceItems({ receipts: [scan("s1", "Rakoto", 80000)] });
    const records: ExpenseRecord[] = [{ ...base, kind: "exclusion", id: exclusionId(receiptKey("s1")), sourceKey: receiptKey("s1") }];
    expect(monthBalance([], monthIncomes(records, "2026-10", sources)).earned).toBe(0);
    expect(monthBalance([], monthIncomes([], "2026-10", sources)).earned).toBe(80000);
  });
});
