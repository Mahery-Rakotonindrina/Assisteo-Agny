import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cappedRepayment,
  dayFromInput,
  dueIn,
  knownPeople,
  knownPhone,
  loanMoney,
  loanPaid,
  loanRemaining,
  loansByPerson,
  loanStatus,
  loanTotals,
  personKey,
  repaidLoans,
  searchPeople,
  whatsappLink,
  whatsappNumber,
  type Loan,
} from "@/lib/loans";
import { defaultFeatureSettings, hasFeature, planFor, withFeatureDefaults, type FeatureSettings } from "@/lib/plans";
import { RESTORE_KEYS } from "@/scripts/lib/backup.mjs";

// A tiny stand-in for Supabase: one table of rows, read whole and upserted.
const server = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, fail: null as Error | null }));
vi.mock("@/lib/supabase", () => ({
  accountsAvailable: true,
  supabase: () => ({
    from: () => ({
      select: () => Promise.resolve(server.fail ? { data: null, error: server.fail } : { data: server.rows.map((row) => ({ ...row })), error: null }),
      upsert: (row: Record<string, unknown>) => {
        if (server.fail) return Promise.resolve({ error: server.fail });
        server.rows = [...server.rows.filter((other) => other.id !== row.id), row];
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const { loanStore } = await import("@/services/loanStore");
const { syncLoans } = await import("@/services/loanSync");

const day = (text: string) => dayFromInput(text)!;
const NOW = day("2026-10-29") + 10 * 60 * 60 * 1000;

function loan(overrides: Partial<Loan> = {}): Loan {
  return { id: "l1", direction: "lent", person: "Rakoto", amountMga: 100_000, at: day("2026-10-01"), repayments: [], updatedAt: 0, ...overrides };
}
const paid = (amountMga: number, at = day("2026-10-10"), id = `r${amountMga}`) => ({ id, at, amountMga });

describe("what is left and the state of a loan", () => {
  it("counts partial repayments, and nothing above the loan", () => {
    const partly = loan({ repayments: [paid(30_000), paid(20_000)] });
    expect(loanPaid(partly)).toBe(50_000);
    expect(loanRemaining(partly)).toBe(50_000);
    expect(loanStatus(partly, NOW)).toBe("open");
    const over = loan({ repayments: [paid(80_000), paid(50_000)] });
    expect(loanPaid(over)).toBe(100_000);
    expect(loanRemaining(over)).toBe(0);
    expect(loanStatus(over, NOW)).toBe("repaid");
  });

  it("is late from the day after the due day, never once repaid", () => {
    expect(loanStatus(loan({ dueAt: day("2026-10-29") }), NOW)).toBe("open");
    expect(loanStatus(loan({ dueAt: day("2026-10-28") }), NOW)).toBe("late");
    expect(loanStatus(loan({ dueAt: day("2026-10-28"), repayments: [paid(100_000)] }), NOW)).toBe("repaid");
  });

  it("caps a repayment to what is left", () => {
    const partly = loan({ repayments: [paid(70_000)] });
    expect(cappedRepayment(partly, 50_000)).toBe(30_000);
    expect(cappedRepayment(partly, 10_000.4)).toBe(10_000);
    expect(cappedRepayment(partly, 0)).toBeNull();
    expect(cappedRepayment(loan({ repayments: [paid(100_000)] }), 5_000)).toBeNull();
    // Correcting a repayment leaves it out of the count.
    expect(cappedRepayment(partly, 90_000, "r70000")).toBe(90_000);
  });
});

describe("people", () => {
  const loans = [
    loan({ id: "a", person: "Rakoto", amountMga: 50_000, dueAt: day("2026-11-15") }),
    loan({ id: "b", person: " rakotó ", amountMga: 30_000, at: day("2026-10-20"), phone: "034 12 345 67", dueAt: day("2026-11-05") }),
    loan({ id: "c", person: "Lalao", amountMga: 200_000, dueAt: day("2026-10-20"), repayments: [paid(50_000)] }),
    loan({ id: "d", person: "Be", amountMga: 500_000 }),
    loan({ id: "e", person: "Soa", amountMga: 10_000, repayments: [paid(10_000, day("2026-10-25"))] }),
    loan({ id: "f", person: "Tante", direction: "borrowed", amountMga: 40_000 }),
    loan({ id: "g", person: "Gone", amountMga: 1_000, deletedAt: 1 }),
  ];

  it("gathers a person's loans, accents and case aside", () => {
    expect(personKey("  Rakotó  Be ")).toBe("rakoto be");
    const rakoto = loansByPerson(loans, "lent", NOW).find((person) => person.key === "rakoto")!;
    expect(rakoto).toMatchObject({ name: "rakotó", phone: "034 12 345 67", remaining: 80_000, open: 2, late: false, nextDue: day("2026-11-05") });
    expect(rakoto.loans.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("puts late people first, then by due day, then by amount", () => {
    const people = loansByPerson(loans, "lent", NOW);
    expect(people.map((person) => person.key)).toEqual(["lalao", "rakoto", "be", "soa"]);
    expect(people[0]).toMatchObject({ late: true, lateAmount: 150_000 });
  });

  it("sorts a person's loans like the list: late, due day, amount, then the repaid ones", () => {
    const hery = [
      loan({ id: "small", person: "Hery", amountMga: 30_000, at: day("2026-10-25") }),
      loan({ id: "done", person: "Hery", amountMga: 5_000, at: day("2026-10-28"), repayments: [paid(5_000, day("2026-10-28"))] }),
      loan({ id: "soon", person: "Hery", amountMga: 10_000, dueAt: day("2026-11-02") }),
      loan({ id: "late", person: "Hery", amountMga: 100_000, at: day("2026-09-01"), dueAt: day("2026-10-15") }),
      loan({ id: "big", person: "Hery", amountMga: 60_000, at: day("2026-10-02") }),
    ];
    const [person] = loansByPerson(hery, "lent", NOW);
    expect(person.loans.map((item) => item.id)).toEqual(["late", "soon", "big", "small", "done"]);
  });

  it("never breaks an amount before « Ar »", () => {
    expect(loanMoney(50_000, "fr")).toMatch(/^50\s000\u00a0Ar$/);
    expect(loanMoney(50_000, "en")).toBe("50,000\u00a0Ar");
  });

  it("sums what is owed, by how many, and the late part", () => {
    expect(loanTotals(loansByPerson(loans, "lent", NOW))).toEqual({ total: 730_000, people: 3, late: 150_000 });
    expect(loanTotals(loansByPerson(loans, "borrowed", NOW))).toEqual({ total: 40_000, people: 1, late: 0 });
  });

  it("folds the repaid loans apart, and finds people by name", () => {
    expect(repaidLoans(loans, "lent", NOW).map((item) => item.id)).toEqual(["e"]);
    expect(searchPeople(loansByPerson(loans, "lent", NOW), "RAKO").map((person) => person.key)).toEqual(["rakoto"]);
    expect(searchPeople(loansByPerson(loans, "lent", NOW), " ")).toHaveLength(4);
  });

  it("offers the names already written, and their last number", () => {
    expect(knownPeople(loans)).toEqual(["rakotó", "Lalao", "Be", "Soa", "Tante"]);
    expect(knownPhone(loans, "RAKOTO")).toBe("034 12 345 67");
    expect(knownPhone(loans, "Lalao")).toBeUndefined();
  });
});

describe("dates", () => {
  it("reads a date input as local midnight", () => {
    expect(new Date(day("2026-10-29")).getHours()).toBe(0);
    expect(dayFromInput("")).toBeUndefined();
    expect(dayFromInput("29/10/2026")).toBeUndefined();
  });

  it("gives the due day in a week, or in a month (the last day when shorter)", () => {
    expect(dueIn("week", NOW)).toBe(day("2026-11-05"));
    expect(dueIn("month", NOW)).toBe(day("2026-11-29"));
    expect(dueIn("month", day("2026-01-31") + 1000)).toBe(day("2026-02-28"));
  });
});

describe("WhatsApp", () => {
  it("writes a Malagasy number with its country code", () => {
    expect(whatsappNumber("034 12 345 67")).toBe("261341234567");
    expect(whatsappNumber("032.12.345.67")).toBe("261321234567");
    expect(whatsappNumber("34 12 345 67")).toBe("261341234567");
    expect(whatsappNumber("+261 34 12 345 67")).toBe("261341234567");
    expect(whatsappNumber("00261341234567")).toBe("261341234567");
    expect(whatsappNumber("+33 6 12 34 56 78")).toBe("33612345678");
    expect(whatsappNumber("12")).toBeNull();
    expect(whatsappNumber(undefined)).toBeNull();
  });

  it("opens the chat with the message written", () => {
    expect(whatsappLink("034 12 345 67", "Bonjour Rakoto, petit rappel : 50 000 Ar ?")).toBe(
      "https://wa.me/261341234567?text=Bonjour%20Rakoto%2C%20petit%20rappel%20%3A%2050%20000%20Ar%20%3F",
    );
    expect(whatsappLink("", "Bonjour")).toBeNull();
  });
});

describe("loan store", () => {
  beforeEach(async () => {
    await loanStore.wipe();
    server.rows = [];
    server.fail = null;
  });

  it("adds a loan, repays it in part, then marks it repaid", async () => {
    expect(await loanStore.create({ direction: "lent", person: " ", amountMga: 10, at: NOW })).toBeNull();
    const created = (await loanStore.create({ direction: "lent", person: "  Rakoto ", phone: " ", amountMga: 100_000.6, at: NOW, note: "pour l’écolage" }))!;
    expect(created).toMatchObject({ person: "Rakoto", amountMga: 100_001, phone: undefined, repayments: [] });
    expect(await loanStore.addRepayment(created.id, { amountMga: 30_000, at: NOW })).toBe(30_000);
    // More than what is left: capped.
    expect(await loanStore.addRepayment(created.id, { amountMga: 500_000, at: NOW })).toBe(70_001);
    expect(await loanStore.markRepaid(created.id)).toBeNull();
    const saved = (await loanStore.get(created.id))!;
    expect(loanStatus(saved, NOW)).toBe("repaid");
    expect(saved.dirty).toBe(true);
    await loanStore.removeRepayment(created.id, saved.repayments[1].id);
    expect(await loanStore.markRepaid(created.id)).toBe(70_001);
  });

  it("reads a loan saved without its repayments", async () => {
    await loanStore.rawPut({ id: "old", direction: "lent", person: "Be", amountMga: 5_000, at: NOW, updatedAt: 1 } as Loan);
    expect((await loanStore.get("old"))?.repayments).toEqual([]);
  });
});

describe("loan sync", () => {
  beforeEach(async () => {
    await loanStore.wipe();
    server.rows = [];
    server.fail = null;
  });

  it("pushes local loans, then pulls the other device's", async () => {
    const created = (await loanStore.create({ direction: "borrowed", person: "Tante", amountMga: 40_000, at: NOW }))!;
    await syncLoans("user-1");
    expect(server.rows).toHaveLength(1);
    expect(server.rows[0]).toMatchObject({ user_id: "user-1", id: created.id, deleted_at: null });
    expect(server.rows[0].data).not.toHaveProperty("dirty");
    expect((await loanStore.rawGet(created.id))?.dirty).toBe(false);

    server.rows.push({ id: "other", data: { direction: "lent", person: "Soa", amountMga: 9_000, at: NOW, repayments: [] }, updated_at: new Date(NOW).toISOString(), deleted_at: null });
    await syncLoans("user-1");
    expect((await loanStore.list()).map((item) => item.person).sort()).toEqual(["Soa", "Tante"]);
  });

  it("sends a removal as a tombstone while signed in", async () => {
    const created = (await loanStore.create({ direction: "lent", person: "Be", amountMga: 1_000, at: NOW }))!;
    await syncLoans("user-1");
    loanStore.setKeepTombstones(true);
    await loanStore.remove(created.id);
    await syncLoans("user-1");
    loanStore.setKeepTombstones(false);
    expect(server.rows[0].deleted_at).not.toBeNull();
    expect(await loanStore.rawGet(created.id)).toBeUndefined();
  });

  it("keeps the loans on the device while the table is missing", async () => {
    server.fail = Object.assign(new Error('relation "public.loans" does not exist'), { code: "42P01" });
    await loanStore.create({ direction: "lent", person: "Be", amountMga: 1_000, at: NOW });
    await expect(syncLoans("user-1")).rejects.toThrow(/does not exist/);
    expect(await loanStore.list()).toHaveLength(1);
  });
});

describe("plan and backups", () => {
  it("is for the administrators only while tested", () => {
    expect(planFor("loans")).toBe("unlimited");
    expect(hasFeature("pro", "loans")).toBe(false);
    expect(hasFeature("unlimited", "loans")).toBe(true);
  });

  it("is given to the Admin by a record saved before it existed", () => {
    const old = JSON.parse(JSON.stringify(defaultFeatureSettings)) as FeatureSettings;
    for (const plan of Object.keys(old.features) as Array<keyof FeatureSettings["features"]>) old.features[plan] = old.features[plan].filter((feature) => feature !== "loans");
    delete (old.featureStatus as Partial<FeatureSettings["featureStatus"]>).loans;
    const merged = withFeatureDefaults(old);
    expect(merged.features.unlimited).toContain("loans");
    expect(merged.features.pro).not.toContain("loans");
    expect(merged.featureStatus.loans).toEqual({ mode: "on", testers: [] });
    // Once the Admin saved it unticked, it stays unticked.
    const saved = withFeatureDefaults({ ...old, featureStatus: { ...old.featureStatus, loans: { mode: "on", testers: [] } } });
    expect(saved.features.unlimited).not.toContain("loans");
  });

  it("is backed up, and its migration keeps each one to their own rows", () => {
    expect(RESTORE_KEYS.loans).toEqual(["user_id", "id"]);
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0010_loans.sql"), "utf8");
    expect(sql).toMatch(/create table if not exists public\.loans/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/using \(user_id = auth\.uid\(\)\)/);
  });
});
