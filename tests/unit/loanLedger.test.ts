import { describe, expect, it } from "vitest";
import { gatherHouseholdLoans } from "@/lib/householdLoans";
import { ledgerMonths, personBadge, personLedger, spreadRepayment } from "@/lib/loanLedger";
import { loansByPerson, splitSchedule, type Loan } from "@/lib/loans";

// "Compte avec Rakoto": the statement with "Reste" after each line, and the pill of a person's card.

const DAY = 24 * 60 * 60 * 1000;
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const now = day(2026, 10, 30, 10);

function loan(fields: Partial<Loan>): Loan {
  return { id: "l1", direction: "lent", person: "Rakoto", amountMga: 50_000, at: day(2026, 9, 1), repayments: [], updatedAt: 0, ...fields };
}

describe("personLedger", () => {
  it("lists loans and repayments oldest first, with what is left after each line", () => {
    const lines = personLedger([
      loan({ id: "a", amountMga: 50_000, at: day(2026, 9, 1), note: "Écolage", repayments: [{ id: "r1", at: day(2026, 9, 20), amountMga: 20_000 }] }),
      loan({ id: "b", amountMga: 100_000, at: day(2026, 10, 5), repayments: [] }),
    ]);
    expect(lines.map((line) => [line.kind, line.amountMga, line.balanceMga])).toEqual([
      ["loan", 50_000, 50_000],
      ["repayment", 20_000, 30_000],
      ["loan", 100_000, 130_000],
    ]);
    expect(lines[1].loan.id).toBe("a");
    expect(lines[1].repayment?.id).toBe("r1");
  });

  it("shows the interest as a line of its own, tied to its loan, and ends on what is left", () => {
    const lent = loan({ amountMga: 100_000, interest: { kind: "percent", value: 10 }, repayments: [{ id: "r1", at: day(2026, 9, 10), amountMga: 30_000 }] });
    const lines = personLedger([lent]);
    expect(lines.map((line) => [line.kind, line.amountMga, line.balanceMga])).toEqual([
      ["loan", 100_000, 100_000],
      ["interest", 10_000, 110_000],
      ["repayment", 30_000, 80_000],
    ]);
    expect(lines[1].loan).toBe(lent);
  });

  it("caps a repayment to what was left on its loan, and skips removed loans", () => {
    const lines = personLedger([
      loan({ id: "a", amountMga: 10_000, repayments: [{ id: "r1", at: day(2026, 9, 2), amountMga: 6_000 }, { id: "r2", at: day(2026, 9, 3), amountMga: 9_000 }] }),
      loan({ id: "gone", deletedAt: 1 }),
    ]);
    expect(lines.map((line) => line.amountMga)).toEqual([10_000, 6_000, 4_000]);
    expect(lines.at(-1)?.balanceMga).toBe(0);
  });

  it("agrees with the person's total left, with a schedule and several loans", () => {
    const first = day(2026, 9, 15, 0);
    const loans = [
      loan({ id: "a", amountMga: 60_000, schedule: splitSchedule(60_000, 3, "month", first), repayments: [{ id: "r1", at: day(2026, 9, 16), amountMga: 25_000 }] }),
      loan({ id: "b", amountMga: 40_000, at: day(2026, 10, 1), dueAt: day(2026, 11, 1, 0), repayments: [{ id: "r2", at: day(2026, 10, 2), amountMga: 5_000 }] }),
    ];
    const [person] = loansByPerson(loans, "lent", now);
    expect(personLedger(person.loans).at(-1)?.balanceMga).toBe(person.remaining);
    expect(person.remaining).toBe(70_000);
  });

  it("works on the household's loans, repayments by any member", () => {
    const loans = gatherHouseholdLoans([
      { kind: "loan", id: "h1", userId: "u1", direction: "lent", person: "Voisin", amountMga: 30_000, at: day(2026, 9, 1), createdAt: 0, updatedAt: 0 },
      { kind: "repayment", id: "p1", loanId: "h1", userId: "u2", authorName: "Ben", amountMga: 10_000, at: day(2026, 9, 5), updatedAt: 0 },
    ]) as unknown as Loan[];
    const lines = personLedger(loans);
    expect(lines.map((line) => line.balanceMga)).toEqual([30_000, 20_000]);
    expect((lines[1].repayment as { userId?: string }).userId).toBe("u2");
  });
});

describe("ledgerMonths", () => {
  it("groups the lines by month, the newest first", () => {
    const lines = personLedger([
      loan({ id: "a", at: day(2026, 9, 1), repayments: [{ id: "r1", at: day(2026, 10, 3), amountMga: 1_000 }, { id: "r2", at: day(2026, 10, 9), amountMga: 1_000 }] }),
    ]);
    const months = ledgerMonths(lines);
    expect(months.map((group) => new Date(group.month).getMonth() + 1)).toEqual([10, 9]);
    expect(months[0].lines.map((line) => line.repayment?.id)).toEqual(["r2", "r1"]);
  });
});

describe("personBadge", () => {
  it("says how many days late, from the oldest late payment", () => {
    const loans = [loan({ dueAt: startOf(now) - 12 * DAY }), loan({ id: "b", dueAt: startOf(now) - 3 * DAY })];
    expect(personBadge({ loans }, now)).toEqual({ kind: "late", days: 12 });
  });

  it("gives the next due day, else « À jour », else « Remboursé »", () => {
    const due = startOf(now) + 5 * DAY;
    expect(personBadge({ loans: [loan({ dueAt: due }), loan({ id: "b" })] }, now)).toEqual({ kind: "due", at: due });
    expect(personBadge({ loans: [loan({})] }, now)).toEqual({ kind: "upToDate" });
    expect(personBadge({ loans: [loan({ repayments: [{ id: "r", at: now, amountMga: 50_000 }] })] }, now)).toEqual({ kind: "repaid" });
  });

  it("follows the schedule: a late installment makes the person late", () => {
    const schedule = splitSchedule(30_000, 3, "week", startOf(now) - 8 * DAY);
    expect(personBadge({ loans: [loan({ amountMga: 30_000, schedule, repayments: [{ id: "r", at: now, amountMga: 10_000 }] })] }, now)).toEqual({ kind: "late", days: 1 });
  });
});

describe("spreadRepayment", () => {
  it("pays the loans in their order, each up to what is left, the surplus left out", () => {
    const a = loan({ id: "a", amountMga: 20_000 });
    const b = loan({ id: "b", amountMga: 50_000, repayments: [{ id: "r", at: now, amountMga: 45_000 }] });
    const c = loan({ id: "c", amountMga: 10_000 });
    expect(spreadRepayment([a, b, c], 27_000).map((part) => [part.loan.id, part.amountMga])).toEqual([
      ["a", 20_000],
      ["b", 5_000],
      ["c", 2_000],
    ]);
    expect(spreadRepayment([a], 90_000)).toEqual([{ loan: a, amountMga: 20_000 }]);
    expect(spreadRepayment([a], 0)).toEqual([]);
  });
});

function startOf(time: number) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

describe("ledgerLabels", () => {
  it("names the person on a repayment, never « il »", async () => {
    const { ledgerLabels } = await import("@/lib/loanExport");
    const fr = (await import("@/locales/fr.json")).default as unknown as { loans: { line: { repayment: Record<string, string> } } };
    const t = (key: string, params?: Record<string, string | number>) =>
      key === "loans.line.repayment.lent" ? fr.loans.line.repayment.lent.replace("{name}", String(params?.name)) : key;
    const [, repayment] = personLedger([loan({ person: "Épicerie Soa ", repayments: [{ id: "r", at: day(2026, 9, 2), amountMga: 1_000 }] })]);
    expect(ledgerLabels(repayment, t).what).toBe("Épicerie Soa m’a rendu");
  });
});
