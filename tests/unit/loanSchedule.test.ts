import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { amountInWords, numberInWords } from "@/lib/amountWords";
import { loanRows, loanSides, loanStats, personLoans, personSummaries } from "@/lib/loanReport";
import { loadExcel } from "@/lib/excel";
import { loansWorkbook } from "@/lib/loanExport";
import {
  cappedRepayment,
  dayFromInput,
  installmentDay,
  loanInterest,
  loanLateAmount,
  loanNextDue,
  loanPaid,
  loanRemaining,
  loansByPerson,
  loanStatus,
  loanTotal,
  loanTotals,
  scheduleFrequency,
  scheduleState,
  splitSchedule,
  type Loan,
} from "@/lib/loans";
import { loanStore } from "@/services/loanStore";
import { acknowledgment } from "@/services/loanPdf";

const day = (text: string) => dayFromInput(text)!;
const NOW = day("2026-10-29") + 10 * 60 * 60 * 1000;

/** Each sheet's totals row: its label, the "Montant" (or "Total à rendre") and the "Reste". */
async function loanExcelTotals(bytes: ArrayBuffer) {
  const Excel = await loadExcel();
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook.worksheets.map((sheet) => {
    const header = sheet.getRow(4).values as unknown[];
    const last = sheet.lastRow!;
    const column = (name: string) => header.indexOf(name);
    const value = (index: number) => {
      const cell = last.getCell(index).value as { result?: number } | number;
      return typeof cell === "number" ? cell : cell?.result;
    };
    const amount = column("Montant") > 0 ? column("Montant") : column("Total à rendre");
    return { sheet: sheet.name, label: last.getCell(1).value, amount: value(amount), remaining: value(column("Reste")) };
  });
}

function loan(overrides: Partial<Loan> = {}): Loan {
  return { id: "l1", direction: "lent", person: "Rakoto", amountMga: 100_000, at: day("2026-10-01"), repayments: [], updatedAt: 0, ...overrides };
}
const paid = (amountMga: number, at = day("2026-10-10"), id = `r${amountMga}`) => ({ id, at, amountMga });

// The French texts, as the app shows them.
const fr = JSON.parse(readFileSync(join(process.cwd(), "locales/fr.json"), "utf8"));
const t = (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce((node, part) => node?.[part], fr) as unknown as string;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};

describe("the schedule", () => {
  it("splits in equal parts, the rounding on the last one", () => {
    const parts = splitSchedule(100_000, 3, "month", day("2026-11-05"));
    expect(parts.map((item) => item.amountMga)).toEqual([33_333, 33_333, 33_334]);
    expect(parts.map((item) => item.dueAt)).toEqual([day("2026-11-05"), day("2026-12-05"), day("2027-01-05")]);
    expect(new Set(parts.map((item) => item.id)).size).toBe(3);
  });

  it("goes week by week, and keeps the month's last day when shorter", () => {
    expect(installmentDay(day("2026-10-28"), "week", 1)).toBe(day("2026-11-04"));
    expect(installmentDay(day("2027-01-31"), "month", 1)).toBe(day("2027-02-28"));
    expect(installmentDay(day("2027-01-31"), "month", 2)).toBe(day("2027-03-31"));
    expect(scheduleFrequency(splitSchedule(9_000, 3, "week", day("2026-11-01")))).toBe("week");
    expect(scheduleFrequency(splitSchedule(9_000, 3, "month", day("2026-11-01")))).toBe("month");
  });

  it("pays the installments in order: paid, partly paid, coming", () => {
    const schedule = splitSchedule(60_000, 3, "month", day("2026-11-05"));
    const states = scheduleState(loan({ amountMga: 60_000, schedule, repayments: [paid(30_000)] }), NOW);
    expect(states.map((item) => item.status)).toEqual(["paid", "partial", "upcoming"]);
    expect(states[1]).toMatchObject({ paidMga: 10_000, leftMga: 10_000 });
  });

  it("is late on an installment whose day is past, not on the whole loan's last day", () => {
    const schedule = splitSchedule(60_000, 3, "month", day("2026-10-05"));
    const late = loan({ amountMga: 60_000, schedule, dueAt: schedule[2].dueAt });
    expect(scheduleState(late, NOW)[0].status).toBe("late");
    expect(loanStatus(late, NOW)).toBe("late");
    // The first part paid: on time again until the next one.
    expect(loanStatus({ ...late, repayments: [paid(20_000)] }, NOW)).toBe("open");
  });

  it("gives the next payment, with what is left on it", () => {
    const schedule = splitSchedule(60_000, 3, "month", day("2026-11-05"));
    expect(loanNextDue(loan({ amountMga: 60_000, schedule, repayments: [paid(25_000)] }), NOW)).toEqual({ dueAt: day("2026-12-05"), amountMga: 15_000, scheduled: true });
    expect(loanNextDue(loan({ amountMga: 60_000, schedule, repayments: [paid(60_000)] }), NOW)).toBeUndefined();
    const person = loansByPerson([loan({ amountMga: 60_000, schedule })], "lent", NOW)[0];
    expect(person.nextDue).toBe(day("2026-11-05"));
    expect(person.next).toEqual({ dueAt: day("2026-11-05"), amountMga: 20_000, scheduled: true });
  });
});

describe("interest or fees agreed", () => {
  it("adds a fixed amount or a share to what is to be paid back", () => {
    expect(loanInterest(loan({ interest: { kind: "fixed", value: 10_000 } }))).toBe(10_000);
    expect(loanTotal(loan({ interest: { kind: "fixed", value: 10_000 } }))).toBe(110_000);
    expect(loanTotal(loan({ interest: { kind: "percent", value: 5 } }))).toBe(105_000);
    expect(loanTotal(loan({ amountMga: 33_333, interest: { kind: "percent", value: 10 } }))).toBe(36_666);
    expect(loanInterest(loan({ interest: { kind: "fixed", value: -5 } }))).toBe(0);
  });

  it("follows the total for what is left and the cap", () => {
    const withFees = loan({ interest: { kind: "fixed", value: 10_000 }, repayments: [paid(100_000)] });
    expect(loanRemaining(withFees)).toBe(10_000);
    expect(loanStatus(withFees, NOW)).toBe("open");
    expect(cappedRepayment(withFees, 50_000)).toBe(10_000);
    expect(loanPaid({ ...withFees, repayments: [paid(200_000)] })).toBe(110_000);
  });

  it("« Marquer comme remboursé » pays the interest too", async () => {
    await loanStore.wipe();
    const created = await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 100_000, at: day("2026-10-01"), interest: { kind: "percent", value: 10 } });
    expect(created).not.toBeNull();
    expect(await loanStore.markRepaid(created!.id)).toBe(110_000);
    const saved = (await loanStore.get(created!.id))!;
    expect(loanStatus(saved, NOW)).toBe("repaid");
  });

  it("keeps a schedule of two or more, due on its last day", async () => {
    await loanStore.wipe();
    const schedule = splitSchedule(100_000, 2, "week", day("2026-11-01"));
    const created = (await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 100_000, at: day("2026-10-01"), dueAt: day("2026-10-15"), schedule }))!;
    expect(created.schedule).toHaveLength(2);
    expect(created.dueAt).toBe(day("2026-11-08"));
    await loanStore.edit(created.id, { direction: "lent", person: "Rakoto", amountMga: 100_000, at: day("2026-10-01"), schedule: schedule.slice(0, 1) });
    expect((await loanStore.get(created.id))!.schedule).toBeUndefined();
  });
});

describe("what is late", () => {
  it("counts only the unpaid part of the past installments", () => {
    // 1 200 000 Ar in 12 times from 2026-10-05: only the first one is past.
    const schedule = splitSchedule(1_200_000, 12, "month", day("2026-10-05"));
    const big = loan({ amountMga: 1_200_000, schedule, dueAt: schedule[11].dueAt });
    expect(loanLateAmount(big, NOW)).toBe(100_000);
    expect(loanLateAmount({ ...big, repayments: [paid(40_000)] }, NOW)).toBe(60_000);
    expect(loanLateAmount({ ...big, repayments: [paid(100_000)] }, NOW)).toBe(0);
    const people = loansByPerson([big], "lent", NOW);
    expect(people[0]).toMatchObject({ late: true, lateAmount: 100_000, remaining: 1_200_000 });
    // The top card and the home shortcut.
    expect(loanTotals(people)).toEqual({ total: 1_200_000, people: 1, late: 100_000 });
    // The Excel's "En retard" and the top 3 of « En chiffres ».
    expect(personSummaries([big], NOW)[0].lateMga).toBe(100_000);
    expect(loanStats([big], "lent", NOW).late).toEqual([{ name: "Rakoto", lateMga: 100_000 }]);
  });

  it("counts all that is left without a schedule, as before", () => {
    expect(loanLateAmount(loan({ dueAt: day("2026-10-20"), repayments: [paid(30_000)] }), NOW)).toBe(70_000);
    expect(loanLateAmount(loan({ dueAt: day("2026-11-20") }), NOW)).toBe(0);
    expect(loanLateAmount(loan(), NOW)).toBe(0);
  });
});

describe("a loan without the new fields", () => {
  it("works as before", () => {
    const plain = loan({ dueAt: day("2026-10-20"), repayments: [paid(30_000)] });
    expect(loanTotal(plain)).toBe(100_000);
    expect(loanRemaining(plain)).toBe(70_000);
    expect(loanStatus(plain, NOW)).toBe("late");
    expect(scheduleState(plain, NOW)).toEqual([]);
    expect(loanNextDue(plain, NOW)).toEqual({ dueAt: day("2026-10-20"), amountMga: 70_000, scheduled: false });
    expect(loanStatus(loan(), NOW)).toBe("open");
    expect(loanNextDue(loan(), NOW)).toBeUndefined();
  });
});

describe("amounts in words", () => {
  it("in French", () => {
    const cases: Array<[number, string]> = [
      [0, "zéro"],
      [1, "un"],
      [21, "vingt et un"],
      [71, "soixante et onze"],
      [80, "quatre-vingts"],
      [81, "quatre-vingt-un"],
      [97, "quatre-vingt-dix-sept"],
      [100, "cent"],
      [200, "deux cents"],
      [201, "deux cent un"],
      [1000, "mille"],
      [2000, "deux mille"],
      [80_000, "quatre-vingt mille"],
      [200_000, "deux cent mille"],
      [1_000_000, "un million"],
      [2_000_000, "deux millions"],
      [125_500, "cent vingt-cinq mille cinq cents"],
      [1_250_000, "un million deux cent cinquante mille"],
    ];
    for (const [value, words] of cases) expect(numberInWords(value, "fr")).toBe(words);
    expect(amountInWords(50_000, "fr")).toBe("cinquante mille ariary");
  });

  it("in English", () => {
    const cases: Array<[number, string]> = [
      [0, "zero"],
      [1, "one"],
      [21, "twenty-one"],
      [80, "eighty"],
      [100, "one hundred"],
      [1000, "one thousand"],
      [1_000_000, "one million"],
      [125_500, "one hundred twenty-five thousand five hundred"],
    ];
    for (const [value, words] of cases) expect(numberInWords(value, "en")).toBe(words);
    expect(amountInWords(20_000, "en")).toBe("twenty thousand ariary");
  });
});

describe("the exports", () => {
  const loans = [
    loan({ id: "a", interest: { kind: "fixed", value: 10_000 }, repayments: [paid(40_000)], dueAt: day("2026-10-20") }),
    loan({ id: "b", person: " rakoto ", amountMga: 20_000, at: day("2026-09-01"), repayments: [paid(20_000, day("2026-09-11"))] }),
    loan({ id: "c", person: "Lalao", direction: "borrowed", amountMga: 50_000 }),
    loan({ id: "d", person: "Gone", deletedAt: 1 }),
  ];

  it("gives one row per loan, by person then oldest first", () => {
    const rows = loanRows(loans, NOW);
    expect(rows.map((row) => row.person)).toEqual(["Lalao", "rakoto", "Rakoto"]);
    expect(rows[2]).toMatchObject({ amountMga: 100_000, interestMga: 10_000, totalMga: 110_000, paidMga: 40_000, remainingMga: 70_000, status: "late", dueAt: day("2026-10-20") });
    expect(rows[1]).toMatchObject({ status: "repaid", remainingMga: 0, dueAt: null });
  });

  it("never adds what is owed to me to what I owe", async () => {
    const sides = loanSides(loans, NOW);
    expect(sides.map((side) => side.direction)).toEqual(["lent", "borrowed"]);
    expect(sides[0].totals).toEqual({ amountMga: 120_000, totalMga: 130_000, paidMga: 60_000, remainingMga: 70_000, lateMga: 70_000 });
    expect(sides[1].totals).toEqual({ amountMga: 50_000, totalMga: 50_000, paidMga: 0, remainingMga: 50_000, lateMga: 0 });
    expect(sides[1].rows.map((row) => row.person)).toEqual(["Lalao"]);
    expect(sides[1].people.map((person) => person.name)).toEqual(["Lalao"]);
    // Only one way: the other is left out.
    expect(loanSides(loans.slice(0, 2), NOW).map((side) => side.direction)).toEqual(["lent"]);

    // The workbook: a loans sheet and a per person sheet for each way, each with its own total.
    const bytes = await loansWorkbook(loans, NOW, t, { title: "Mes prêts", subtitle: "" });
    expect(await loanExcelTotals(bytes)).toEqual([
      { sheet: "On me doit", label: "Total on me doit", amount: 120_000, remaining: 70_000 },
      { sheet: "Par personne (on me doit)", label: "Total on me doit", amount: 130_000, remaining: 70_000 },
      { sheet: "Je dois", label: "Total je dois", amount: 50_000, remaining: 50_000 },
      { sheet: "Par personne (je dois)", label: "Total je dois", amount: 50_000, remaining: 50_000 },
    ]);
  });

  it("sums up each person, both ways", () => {
    const people = personSummaries(loans, NOW);
    expect(people).toEqual([
      { name: "Rakoto", direction: "lent", loans: 2, totalMga: 130_000, paidMga: 60_000, remainingMga: 70_000, lateMga: 70_000 },
      { name: "Lalao", direction: "borrowed", loans: 1, totalMga: 50_000, paidMga: 0, remainingMga: 50_000, lateMga: 0 },
    ]);
    expect(personLoans(loans, "RAKOTO").map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("writes the debt acknowledgment with the amount in words", () => {
    const schedule = splitSchedule(110_000, 2, "month", day("2026-11-05"));
    const text = acknowledgment(loan({ interest: { kind: "fixed", value: 10_000 }, schedule }), { me: "Hery", place: "" }, NOW, t, "fr");
    expect(text.title).toBe("Reconnaissance de dette");
    expect(text.paragraphs[0]).toMatch(/^Je soussigné\(e\) Rakoto, reconnais devoir à Hery la somme de cent dix mille ariary \(110\s000\sAr\)\.$/);
    expect(text.paragraphs[1]).toContain("d’intérêts");
    expect(text.installments).toHaveLength(2);
    expect(text.signedAt).toMatch(/^Fait à _+, le /);
    // Borrowed: the user owes.
    expect(acknowledgment(loan({ direction: "borrowed" }), { me: "Hery", place: "Toamasina" }, NOW, t, "fr").paragraphs[0]).toMatch(/^Je soussigné\(e\) Hery, reconnais devoir à Rakoto /);
  });
});

describe("« En chiffres »", () => {
  it("counts this year's loans of one way", () => {
    const loans = [
      loan({ id: "a", repayments: [paid(30_000)], dueAt: day("2026-10-20") }),
      loan({ id: "b", person: "Lalao", amountMga: 20_000, at: day("2026-09-01"), repayments: [paid(20_000, day("2026-09-11"))] }),
      loan({ id: "c", person: "Koto", amountMga: 10_000, at: day("2026-08-01"), dueAt: day("2026-08-15") }),
      loan({ id: "old", at: day("2025-05-01") }),
      loan({ id: "mine", direction: "borrowed" }),
    ];
    expect(loanStats(loans, "lent", NOW)).toEqual({
      totalMga: 130_000,
      paidMga: 50_000,
      remainingMga: 80_000,
      count: 3,
      averageDays: 10,
      late: [
        { name: "Rakoto", lateMga: 70_000 },
        { name: "Koto", lateMga: 10_000 },
      ],
    });
    expect(loanStats(loans, "borrowed", NOW)).toMatchObject({ totalMga: 100_000, count: 1, averageDays: null, late: [] });
  });
});
