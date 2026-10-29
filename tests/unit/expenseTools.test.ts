import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { eveningTimes, parseEveningTime, type EveningSetting } from "@/lib/eveningReminder";
import { askedAmount, fold, searchExpenses } from "@/lib/expenseSearch";
import {
  byKind,
  hasOwnExpenses,
  monthExpenses,
  monthForecast,
  monthIncomes,
  sourceItems,
  type ExpenseRecord,
  type Income,
  type ManualExpense,
  type Recurring,
  type SavingsGoal,
  type Tontine,
  type Wallet,
} from "@/lib/expenses";
import { goalPerMonth, goalSaved, nextPaymentKey, nextTontineReminder, roundDay, savedTotal, tontineStatus } from "@/lib/savings";
import { walletBook } from "@/lib/wallets";
import { EVENING_ENTRY_ID, reconcileEveningState, type ScheduledEvenings } from "@/services/eveningReminder";
import { plannedExpenseReminders } from "@/services/expenseReminders";
import { expenseStore } from "@/services/expenseStore";
import { tapTarget } from "@/services/notificationTap";

const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime();
const midnight = (year: number, month: number, date: number) => new Date(year, month - 1, date).getTime();
const base = { createdAt: day(2026, 10, 1, 8), updatedAt: day(2026, 10, 1, 8) };

const expense = (id: string, at: number, amountMga: number, patch: Partial<ManualExpense> = {}): ManualExpense => ({ ...base, createdAt: at, kind: "expense", id, at, amountMga, category: "market", ...patch });
const income = (id: string, at: number, amountMga: number, patch: Partial<Income> = {}): Income => ({ ...base, createdAt: at, kind: "income", id, at, amountMga, income: "salary", ...patch });
const recurring = (id: string, flow: Recurring["flow"], amountMga: number, dayOfMonth: number, patch: Partial<Recurring> = {}): Recurring => ({
  ...base,
  kind: "recurring",
  id,
  flow,
  label: id,
  amountMga,
  category: flow === "income" ? "salary" : "rent",
  day: dayOfMonth,
  startMonth: "2026-01",
  remind: "none",
  skipped: [],
  ...patch,
});

describe("the end-of-month forecast", () => {
  const now = day(2026, 10, 15, 18);
  const month = (records: ExpenseRecord[]) => [monthExpenses(records, [], "2026-10"), monthIncomes(records, "2026-10")] as const;
  const everyday = [2, 5, 8, 12].map((date) => expense(`m${date}`, day(2026, 10, date), 10_000));
  const fixed = [recurring("rent", "expense", 200_000, 25), recurring("bonus", "income", 100_000, 28)];

  it("counts the fixed ones to come and leaves the large rare expense out of the pace", () => {
    const records = [income("salary", day(2026, 10, 1), 500_000), ...everyday, expense("fridge", day(2026, 10, 10), 300_000), ...fixed];
    const forecast = monthForecast(...month(records), "2026-10", now)!;
    expect(forecast.leftNow).toBe(160_000);
    expect(forecast.upcomingOut).toBe(200_000);
    expect(forecast.upcomingIn).toBe(100_000);
    // 40 000 Ar over 15 days, for 16 more days (October has 31).
    expect(forecast.dailyAverage).toBe(2667);
    expect(forecast.daysLeft).toBe(16);
    expect(forecast.amount).toBe(17_000);
    expect(new Date(forecast.lastDay).getDate()).toBe(31);
  });

  it("says what will be missing", () => {
    const records = [income("salary", day(2026, 10, 1), 500_000), ...everyday, expense("fridge", day(2026, 10, 10), 400_000), ...fixed];
    expect(monthForecast(...month(records), "2026-10", now)!.amount).toBe(-83_000);
  });

  it("waits for the 3rd day, the current month and something counted", () => {
    const records = [income("salary", day(2026, 10, 1), 500_000)];
    expect(monthForecast(...month(records), "2026-10", day(2026, 10, 2, 20))).toBeNull();
    expect(monthForecast(...month(records), "2026-10", day(2026, 10, 3, 9))).not.toBeNull();
    expect(monthForecast(...month(records), "2026-10", day(2026, 11, 5))).toBeNull();
    expect(monthForecast(...month([]), "2026-10", now)).toBeNull();
  });

  it("leaves out the lines kept out of the budget", () => {
    const items = [{ at: day(2026, 10, 4), amountMga: 50_000, excluded: true, origin: "bill" as const }];
    expect(monthForecast(items, [{ at: day(2026, 10, 1), amountMga: 100_000, excluded: false }], "2026-10", now)!.amount).toBe(100_000);
  });
});

describe("the search", () => {
  const now = day(2026, 10, 29, 18);
  const names = { category: (key: string) => ({ jirama: "JIRAMA (eau, électricité)", market: "Marché", rent: "Loyer" })[key] ?? key, income: (kind: string) => kind };
  const records: ExpenseRecord[] = [
    expense("e1", day(2026, 9, 12), 45_000, { category: "jirama", note: "Électricité maison" }),
    expense("e2", day(2026, 10, 2), 8_000, { note: "Pain" }),
    income("i1", day(2026, 10, 5), 12_000, { income: "sales", note: "Vente gâteaux" }),
  ];
  const sources = sourceItems({ bills: [{ kind: "electricity_water", issuer: "JIRAMA", amountMga: 52_000, paidAt: day(2026, 10, 3), entry: { id: "b1" } }] });

  it("ignores accents and case", () => {
    expect(fold("  Électricité  MAISON ")).toBe("electricite maison");
    const result = searchExpenses(records, sources, "electricite", now, names);
    expect(result.groups.map((group) => group.month)).toEqual(["2026-10", "2026-09"]);
    expect(result.count).toBe(2);
  });

  it("finds the lines computed from the app, every month, the latest first, with the total", () => {
    const result = searchExpenses(records, sources, "jirama", now, names);
    expect(result.groups.map((group) => group.hits.map((hit) => hit.key))).toEqual([["bill:b1"], ["manual:e1"]]);
    expect(result.groups[1].hits[0].recordId).toBe("e1");
    expect(result).toMatchObject({ count: 2, total: 97_000 });
  });

  it("finds an amount however it is typed, and the incomes", () => {
    expect(askedAmount("12 000 Ar")).toBe(12_000);
    expect(askedAmount("12.000")).toBe(12_000);
    expect(askedAmount("loyer")).toBeNull();
    const hits = searchExpenses(records, sources, "12000", now, names).groups.flatMap((group) => group.hits);
    expect(hits.map((hit) => [hit.key, hit.flow])).toEqual([["manual:i1", "income"]]);
    expect(searchExpenses(records, sources, "gateaux", now, names).count).toBe(1);
  });

  it("finds the fixed ones in each month they count, and nothing for an empty query", () => {
    const rent = recurring("rent", "expense", 200_000, 5, { label: "Loyer appartement", startMonth: "2026-09" });
    expect(searchExpenses([rent], [], "appartement", now, names).groups.map((group) => group.month)).toEqual(["2026-10", "2026-09"]);
    expect(searchExpenses(records, sources, "   ", now, names)).toEqual({ groups: [], count: 0, total: 0 });
  });
});

describe("the evening reminder", () => {
  const on: EveningSetting = { on: true, hour: 20, minute: 0 };

  it("rings the next 7 evenings, tonight included while its time is to come", () => {
    const times = eveningTimes([], on, day(2026, 10, 15, 18));
    expect(times).toHaveLength(7);
    expect(times[0]).toBe(day(2026, 10, 15, 20));
    expect(times[6]).toBe(day(2026, 10, 21, 20));
    expect(eveningTimes([], on, day(2026, 10, 15, 21))[0]).toBe(day(2026, 10, 16, 20));
  });

  it("skips an evening when an expense was noted that day, and rings none when off or without the plan", () => {
    const noted = [expense("e1", day(2026, 10, 15, 13), 5_000), expense("e2", day(2026, 10, 18), 5_000, { createdAt: day(2026, 10, 14) })];
    const times = eveningTimes(noted, on, day(2026, 10, 15, 18));
    expect(times).toHaveLength(5);
    expect(times).not.toContain(day(2026, 10, 15, 20));
    expect(times).not.toContain(day(2026, 10, 18, 20));
    expect(eveningTimes([], { ...on, on: false }, day(2026, 10, 15, 18))).toEqual([]);
    expect(eveningTimes([], on, day(2026, 10, 15, 18), false)).toEqual([]);
  });

  it("reads the time typed in", () => {
    expect(parseEveningTime("21:30")).toEqual({ hour: 21, minute: 30 });
    expect(parseEveningTime("25:00")).toEqual({ hour: 20, minute: 0 });
  });

  it("is scheduled again at each expense, cancelled when switched off, and opens the add form", async () => {
    let saved: ScheduledEvenings = {};
    let nextId = 1;
    const scheduled: number[] = [];
    const cancelled: number[] = [];
    let permission = "granted";
    const deps = {
      permission: async () => permission,
      notify: async (options: { at: Date; entryId: string }) => {
        expect(options.entryId).toBe(EVENING_ENTRY_ID);
        scheduled.push(options.at.getTime());
        return nextId++;
      },
      cancel: async (id: number) => {
        cancelled.push(id);
      },
      pending: async () => null,
      load: () => saved,
      save: (next: ScheduledEvenings) => {
        saved = next;
      },
    };
    const texts = { title: "Tu as dépensé quelque chose aujourd’hui ?", body: "Note-le en 3 secondes." };
    const now = day(2026, 10, 15, 18);
    await reconcileEveningState([], on, texts, deps, { now });
    expect(scheduled).toHaveLength(7);
    expect(Object.keys(saved)).toHaveLength(7);

    // An expense noted today: tonight is cancelled, the other evenings stay.
    await reconcileEveningState([expense("e1", day(2026, 10, 15, 17), 5_000)], on, texts, deps, { now });
    expect(cancelled).toEqual([1]);
    expect(scheduled).toHaveLength(7);
    expect(saved["2026-10-15"]).toBeUndefined();

    // Without the permission, nothing new is scheduled.
    permission = "denied";
    saved = {};
    await reconcileEveningState([], on, texts, deps, { now });
    expect(scheduled).toHaveLength(7);

    // Switched off: everything scheduled is cancelled, permission or not.
    saved = { "2026-10-16": { id: 2, at: day(2026, 10, 16, 20) }, "2026-10-17": { id: 3, at: day(2026, 10, 17, 20) } };
    await reconcileEveningState([], { ...on, on: false }, texts, deps, { now });
    expect(cancelled).toEqual([1, 2, 3]);
    expect(saved).toEqual({});

    expect(tapTarget(EVENING_ENTRY_ID)).toEqual({ pathname: "/expenses", query: { add: "expense" } });
    expect(tapTarget("expense:rent")).toEqual({ pathname: "/expenses" });
  });
});

describe("savings goals and tontines", () => {
  const now = day(2026, 10, 15, 18);
  const pocket = (id: string, type: Wallet["type"], startMga: number): Wallet => ({ ...base, kind: "wallet", id, name: id, type, startMga, startAt: day(2026, 10, 1, 8) });
  const goal: SavingsGoal = {
    ...base,
    kind: "savingsGoal",
    id: "g1",
    name: "Rentrée scolaire",
    targetMga: 300_000,
    dueAt: midnight(2026, 12, 20),
    deposits: [
      { id: "d1", at: day(2026, 10, 10), amountMga: 30_000, wallet: "cash" },
      { id: "d2", at: day(2026, 10, 12), amountMga: -5_000, wallet: "cash" },
    ],
  };
  const tontine: Tontine = {
    ...base,
    kind: "tontine",
    id: "t1",
    name: "Tontine du quartier",
    amountMga: 20_000,
    frequency: "monthly",
    members: 12,
    startAt: midnight(2026, 10, 5),
    myTurn: 3,
    deposits: [{ id: "p1", at: day(2026, 10, 5), amountMga: 20_000, wallet: "mvola" }],
    remind: true,
  };
  const records: ExpenseRecord[] = [pocket("cash", "cash", 100_000), pocket("mvola", "mvola", 50_000), goal, tontine];

  it("takes the money out of its pocket, out of the total, and never counts it as spent", () => {
    const book = walletBook(records, [], now);
    expect(book.balances.get("cash")).toBe(75_000);
    expect(book.balances.get("mvola")).toBe(30_000);
    expect(book.total).toBe(105_000);
    expect(book.saved).toBe(45_000);
    expect(book.movements.get("cash")!.map((movement) => movement.type)).toEqual(["unsaved", "saved"]);
    expect(monthExpenses(records, [], "2026-10")).toEqual([]);
    expect(monthIncomes(records, "2026-10")).toEqual([]);
  });

  it("says what a goal holds and what is still to put aside each month", () => {
    expect(goalSaved(goal)).toBe(25_000);
    // 275 000 Ar over November and December.
    expect(goalPerMonth(goal, now)).toBe(138_000);
    expect(goalPerMonth({ ...goal, dueAt: undefined }, now)).toBeNull();
    expect(goalPerMonth(goal, day(2027, 1, 2))).toBeNull();
    expect(goalSaved({ deposits: [{ id: "x", at: now, amountMga: -1_000 }] })).toBe(0);
  });

  it("gives the tontine's next payment, the pot and the user's turn", () => {
    const status = tontineStatus(tontine, now);
    expect(status).toMatchObject({ paid: 20_000, pot: 240_000, turnAt: midnight(2026, 12, 5), received: false, rounds: { done: 1, total: 12 } });
    expect(status.next).toEqual({ round: 2, at: midnight(2026, 11, 5), late: false });
    expect(tontineStatus(tontine, day(2026, 11, 10)).next!.late).toBe(true);
    expect(roundDay({ startAt: midnight(2027, 1, 31), frequency: "monthly" }, 1)).toBe(midnight(2027, 2, 28));
    expect(roundDay({ startAt: midnight(2026, 10, 5), frequency: "weekly" }, 2)).toBe(midnight(2026, 10, 19));
  });

  it("brings the pot into its pocket, and the tontine out of the money set aside", () => {
    const got: Tontine = { ...tontine, received: { at: day(2026, 10, 14), amountMga: 240_000, wallet: "cash" } };
    const book = walletBook([pocket("cash", "cash", 100_000), pocket("mvola", "mvola", 50_000), goal, got], [], now);
    expect(book.balances.get("cash")).toBe(315_000);
    expect(book.saved).toBe(25_000);
    expect(savedTotal([got])).toBe(0);
  });

  it("still gives the next payment, with its day, once the pot is received and rounds remain", () => {
    const got: Tontine = { ...tontine, received: { at: day(2026, 10, 14), amountMga: 240_000, wallet: "cash" } };
    const status = tontineStatus(got, now);
    expect(status.received).toBe(true);
    expect(status.next).toEqual({ round: 2, at: midnight(2026, 11, 5), late: false });
    expect(nextPaymentKey(status)).toBe("stillToPay");
    expect(nextPaymentKey(tontineStatus(tontine, now))).toBe("next");
    expect(nextPaymentKey(tontineStatus(got, day(2026, 11, 10)))).toBe("late");
    const paidUp = { ...got, deposits: Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, at: now, amountMga: 20_000 })) };
    expect(nextPaymentKey(tontineStatus(paidUp, now))).toBe("allPaid");
    expect(nextTontineReminder(got, now)?.dueAt).toBe(midnight(2026, 11, 5));
  });

  it("reminds the day before the next payment, with the reminders' plan", () => {
    expect(nextTontineReminder(tontine, now)).toMatchObject({ dueAt: midnight(2026, 11, 5), at: day(2026, 11, 4, 9) });
    expect(nextTontineReminder({ ...tontine, remind: false }, now)).toBeNull();
    expect(plannedExpenseReminders(records, now).get("tontine:t1")?.at).toBe(day(2026, 11, 4, 9));
    expect(plannedExpenseReminders(records, now, false).size).toBe(0);
  });

  it("is left alone by an older app: it reads records by kind, and its sync keeps them", async () => {
    for (const kind of ["expense", "income", "recurring", "budget", "category", "exclusion"] as const) expect(byKind([goal, tontine], kind)).toEqual([]);
    expect(hasOwnExpenses([goal, tontine])).toBe(false);
    for (const record of [goal, tontine]) await expenseStore.rawPut(record);
    const kept = await expenseStore.list();
    expect(kept.filter((record) => record.kind === "savingsGoal" || record.kind === "tontine")).toHaveLength(2);
    await expenseStore.wipe();
  });

  it("puts aside, takes back and receives the pot through the store", async () => {
    const created = (await expenseStore.saveGoal({ name: " Rentrée ", targetMga: 300_000 }))!;
    await expenseStore.addDeposit(created.id, 30_000, "cash");
    await expenseStore.addDeposit(created.id, -10_000, "cash");
    const saved = (await expenseStore.list()).find((record): record is SavingsGoal => record.id === created.id)!;
    expect(saved.name).toBe("Rentrée");
    expect(goalSaved(saved)).toBe(20_000);
    expect(await expenseStore.saveTontine({ name: "T", amountMga: 10_000, frequency: "weekly", members: 1, startAt: now, myTurn: 1, remind: true })).toBeNull();
    const club = (await expenseStore.saveTontine({ name: "T", amountMga: 10_000, frequency: "weekly", members: 4, startAt: now, myTurn: 9, remind: true }))!;
    expect(club.myTurn).toBe(4);
    await expenseStore.setPotReceived(club.id, { amountMga: 40_000, wallet: "cash" });
    const kept = (await expenseStore.list()).find((record): record is Tontine => record.id === club.id)!;
    expect(kept.received).toMatchObject({ amountMga: 40_000, wallet: "cash" });
    await expenseStore.wipe();
  });
});
