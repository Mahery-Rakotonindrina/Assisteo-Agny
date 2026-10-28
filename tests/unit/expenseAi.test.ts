import "fake-indexeddb/auto";
import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";
import { mockAnalysis, mockExpenseSummary, mockReceipt } from "@/lib/ai/mock";
import { AnalysisSchema, ExpenseSummaryRequestSchema, normalizeStoredAnalysis, type Analysis } from "@/lib/ai/schema";
import { usageRows } from "@/lib/aiCost";
import { receiptDraft, receiptDuplicate, sameReference, summaryRequest } from "@/lib/expenseAi";
import { BUDGET_ID, monthKey, type Budget, type ExpenseRecord, type Income, type ManualExpense } from "@/lib/expenses";

// The route's dependencies: an AI engine that answers, and the plan of the account.
const state = vi.hoisted(() => ({ provider: "gemini", plan: "unlimited" as string, account: true as boolean, accountId: "user-1", fail: false, calls: 0 }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/ai/provider", () => ({
  get activeProvider() {
    return state.provider;
  },
  summarizeExpenses: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("The AI is down.");
    return { summary: { findings: ["+30 % en transport"], tips: ["Prends le taxi-be."] }, model: "gemini-flash-lite-latest", usage: { inputTokens: 600, outputTokens: 300 } };
  },
}));
vi.mock("@/lib/server/plan", () => ({
  resolvePlan: async () => {
    const { defaultPlansConfig, effectiveFeatures } = await import("@/lib/plans");
    type PlanId = Parameters<typeof effectiveFeatures>[0]["plan"];
    return {
      account: state.account ? { id: state.accountId, email: "a@example.com" } : null,
      current: { plan: state.plan, endsAt: null },
      features: effectiveFeatures({ plan: state.plan as PlanId, email: "a@example.com", config: defaultPlansConfig }),
    };
  },
}));

const { default: summaryRoute } = await import("@/pages/api/expenses/summary");

const scanOf = (analysis: Analysis, id = "scan-1") => ({ id, createdAt: new Date(2026, 9, 25, 15).getTime(), analysis });
const withReceipt = (receipt: Partial<NonNullable<NonNullable<Analysis["document"]>["receipt"]>>, bill = false): Analysis => {
  const base = mockReceipt("fr");
  return {
    ...base,
    document: {
      ...base.document!,
      receipt: { ...base.document!.receipt!, ...receipt },
      bill: bill ? { issuer: "JIRAMA", kind: "electricity_water", amount: 52000, currency: "MGA", period: null, dueDate: null } : null,
    },
  };
};

const base = { createdAt: 1, updatedAt: 1 };
const expense = (id: string, fields: Partial<ManualExpense>): ManualExpense => ({ ...base, id, kind: "expense", at: new Date(2026, 9, 5).getTime(), amountMga: 1000, category: "market", ...fields });

describe("receipt in the analysis", () => {
  it("defaults to null on older scans and validates the demo receipts", () => {
    const old = mockAnalysis("document", "fr");
    const { receipt: _receipt, ...document } = old.document!;
    const parsed = AnalysisSchema.parse(normalizeStoredAnalysis({ ...old, document }));
    expect(parsed.document?.receipt).toBeNull();
    for (const locale of ["fr", "en"] as const) {
      const receipt = AnalysisSchema.parse(mockReceipt(locale)).document?.receipt;
      expect(receipt).toMatchObject({ total: 15000, currency: "MGA", payment: "mobile_money", operator: "mvola", category: "transport" });
    }
  });

  it("rejects an unknown payment or category", () => {
    expect(AnalysisSchema.safeParse(withReceipt({ payment: "cheque" as never })).success).toBe(false);
    expect(AnalysisSchema.safeParse(withReceipt({ category: "food" as never })).success).toBe(false);
  });
});

describe("expense from a receipt", () => {
  it("fills in amount, day, category, payment, shop and reference", () => {
    expect(receiptDraft(scanOf(mockReceipt("fr")))).toEqual({
      at: new Date(2026, 9, 20).getTime(),
      amountMga: 15000,
      category: "transport",
      payment: "mobile",
      note: "Taxi Be Express",
      reference: "MP261020.1432.A51234",
      scanId: "scan-1",
    });
  });

  it("rounds ariary, keeps yuan, dollars and euros for the rate, and falls back to the scan's day", () => {
    expect(receiptDraft(scanOf(withReceipt({ total: 12500.4, currency: "Ar" })))?.amountMga).toBe(12500);
    const dollars = receiptDraft(scanOf(withReceipt({ total: 12.5, currency: "usd", date: null })));
    expect(dollars).toMatchObject({ currency: "USD", originalAmount: 12.5, at: new Date(2026, 9, 25).getTime() });
    expect(dollars?.amountMga).toBeUndefined();
    // An unknown currency: the amount is left for the user to type.
    const other = receiptDraft(scanOf(withReceipt({ total: 30, currency: "GBP" })));
    expect(other?.amountMga).toBeUndefined();
    expect(other?.originalAmount).toBeUndefined();
    expect(receiptDraft(scanOf(withReceipt({ total: null })))?.amountMga).toBeUndefined();
  });

  it("links a receipt that pays a bill to that bill, and takes its category when none is proposed", () => {
    expect(receiptDraft(scanOf(withReceipt({ category: null }, true)))).toMatchObject({ sourceKey: "bill:scan-1", category: "jirama" });
    expect(receiptDraft(scanOf(withReceipt({ category: null, payment: null })))).toMatchObject({ category: "other", payment: undefined });
  });

  it("is null for a scan that is not a receipt", () => {
    expect(receiptDraft(scanOf(mockAnalysis("document", "fr")))).toBeNull();
    expect(receiptDraft(scanOf(mockAnalysis("food", "fr")))).toBeNull();
  });
});

describe("no duplicate receipt", () => {
  const scan = scanOf(mockReceipt("fr"), "scan-2");

  it("finds the expense with the same reference, ignoring case and spaces", () => {
    expect(sameReference(" mp261020.1432.a51234 ", "MP261020.1432.A51234")).toBe(true);
    expect(sameReference(undefined, undefined)).toBe(false);
    const records = [expense("a", { reference: "OTHER" }), expense("b", { reference: "mp261020.1432.a51234" })];
    expect(receiptDuplicate(records, scan)?.id).toBe("b");
  });

  it("finds the expense added from the same scan, never a deleted one", () => {
    expect(receiptDuplicate([expense("c", { scanId: "scan-2" })], scan)?.id).toBe("c");
    expect(receiptDuplicate([expense("d", { reference: "MP261020.1432.A51234", deletedAt: 5 })], scan)).toBeUndefined();
    // Without a reference, another receipt's expense is not a duplicate.
    expect(receiptDuplicate([expense("e", {})], scanOf(withReceipt({ reference: null }), "scan-3"))).toBeUndefined();
  });
});

describe("totals sent to the month's review", () => {
  const records: ExpenseRecord[] = [
    expense("1", { at: new Date(2026, 9, 3).getTime(), amountMga: 30000, category: "transport", note: "Secret shop", reference: "REF-123", scanId: "scan-9" }),
    expense("2", { at: new Date(2026, 9, 4).getTime(), amountMga: 100000, category: "market", note: "Leader Price" }),
    expense("3", { at: new Date(2026, 8, 10).getTime(), amountMga: 20000, category: "transport", note: "Taxi" }),
    expense("4", { at: new Date(2026, 3, 10).getTime(), amountMga: 60000, category: "health" }),
    { ...base, id: "i", kind: "income", at: new Date(2026, 9, 1).getTime(), amountMga: 400000, income: "salary", note: "Boss" } satisfies Income,
    { ...base, id: BUDGET_ID, kind: "budget", total: 300000, categories: { transport: 25000 } } satisfies Budget,
  ];
  const input = summaryRequest(records, [], "2026-10", { locale: "fr", now: new Date(2026, 9, 27).getTime(), categoryName: (id) => `cat:${id}` });

  it("holds the month, the one before and the 6-month average, per category", () => {
    expect(input).toMatchObject({ locale: "fr", month: "2026-10", dayOfMonth: 27, daysInMonth: 31, total: 130000, previousTotal: 20000, income: 400000, budget: 300000 });
    // 20 000 in September, 60 000 in April, over the 6 months before October.
    expect(input.averageTotal).toBe(Math.round(80000 / 6));
    expect(input.categories).toEqual([
      { name: "cat:market", amount: 100000, previous: 0, average: 0, cap: null },
      { name: "cat:transport", amount: 30000, previous: 20000, average: Math.round(20000 / 6), cap: 25000 },
      { name: "cat:health", amount: 0, previous: 0, average: 10000, cap: null },
    ]);
    expect(ExpenseSummaryRequestSchema.safeParse(input).success).toBe(true);
  });

  it("sends no note, shop, reference or scan", () => {
    const sent = JSON.stringify(input);
    for (const secret of ["Secret shop", "Leader Price", "Taxi", "Boss", "REF-123", "scan-9"]) expect(sent).not.toContain(secret);
  });

  it("is refused by the server with anything more than totals", () => {
    expect(ExpenseSummaryRequestSchema.safeParse({ ...input, notes: ["Secret shop"] }).success).toBe(false);
    expect(ExpenseSummaryRequestSchema.safeParse({ ...input, categories: [{ ...input.categories[0], merchant: "Leader Price" }] }).success).toBe(false);
  });

  it("says when the month is over", () => {
    const past = summaryRequest(records, [], "2026-09", { locale: "en", now: new Date(2026, 9, 27).getTime(), categoryName: String });
    expect(past).toMatchObject({ dayOfMonth: null, daysInMonth: 30, total: 20000, income: null });
    expect(monthKey(new Date(2026, 8, 30).getTime())).toBe("2026-09");
  });

  it("has a demo review built from those totals", () => {
    const demo = mockExpenseSummary(input);
    expect(demo.findings[0]).toContain("130");
    expect(demo.findings[1]).toBe("+550 % par rapport au mois dernier.");
    expect(demo.tips.length).toBeGreaterThanOrEqual(2);
  });
});

describe("month's review route", () => {
  const body = summaryRequest([], [], "2026-10", { locale: "fr", now: new Date(2026, 9, 27).getTime(), categoryName: String });

  async function call(payload: unknown, method = "POST") {
    const req = { method, headers: {}, body: payload, socket: { remoteAddress: `10.1.0.${Math.floor(Math.random() * 250)}` } } as unknown as NextApiRequest;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      writableEnded: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: unknown) {
        this.body = value;
        this.writableEnded = true;
        return this;
      },
      setHeader() {},
      end() {},
      on() {},
    };
    await summaryRoute(req, res as unknown as NextApiResponse);
    return res as { statusCode: number; body: { error?: { code: string }; summary?: unknown; demo?: boolean } };
  }

  it("refuses other plans and signed-out users", async () => {
    state.plan = "pro";
    expect((await call(body)).body.error?.code).toBe("plan_required");
    state.plan = "unlimited";
    state.account = false;
    expect((await call(body)).statusCode).toBe(403);
    state.account = true;
    expect(state.calls).toBe(0);
  });

  it("validates the request", async () => {
    expect((await call({ ...body, month: "2026-13" })).statusCode).toBe(400);
    expect((await call({ ...body, note: "x" })).statusCode).toBe(400);
    expect((await call(body, "GET")).statusCode).toBe(405);
  });

  it("answers an Admin, at most 10 times a day", async () => {
    const response = await call(body);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ demo: false, summary: { findings: ["+30 % en transport"] } });
    // 1 call made; 9 more today, then refused.
    for (let index = 0; index < 9; index += 1) expect((await call(body)).statusCode).toBe(200);
    expect((await call(body)).body.error?.code).toBe("rate_limited");
    expect(state.calls).toBe(10);
  });

  it("doesn't count a review that failed in the day's 10", async () => {
    state.accountId = "user-2";
    state.fail = true;
    for (let index = 0; index < 12; index += 1) expect((await call(body)).statusCode).toBe(500);
    state.fail = false;
    for (let index = 0; index < 10; index += 1) expect((await call(body)).statusCode).toBe(200);
    expect((await call(body)).body.error?.code).toBe("rate_limited");
    state.accountId = "user-1";
  });

  it("serves the demo review without an AI key", async () => {
    state.provider = "demo";
    state.plan = "free";
    const response = await call(body);
    expect(response.statusCode).toBe(200);
    expect(response.body.demo).toBe(true);
    state.provider = "gemini";
    state.plan = "unlimited";
  });

  it("prices the reviews apart in Admin, AI cost", () => {
    expect(usageRows([{ "ai:summary:gemini-flash-lite-latest:calls": 2, "ai:summary:gemini-flash-lite-latest:in": 1200, "ai:summary:gemini-flash-lite-latest:out": 600 }])).toEqual([
      { kind: "summary", model: "gemini-flash-lite-latest", calls: 2, inputTokens: 1200, outputTokens: 600 },
    ]);
  });
});
