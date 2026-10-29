import "fake-indexeddb/auto";
import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";
import { DEMO_RECEIPT_REFERENCE, mockReceipt, mockStatement } from "@/lib/ai/mock";
import { MAX_STATEMENT_PAGES, StatementRequestSchema, StatementSchema, type Statement, type StatementOperation } from "@/lib/ai/schema";
import { usageRows } from "@/lib/aiCost";
import { receiptIncomeDuplicate } from "@/lib/expenseAi";
import { monthExpenses, monthIncomes, moveKeepKey, ownReceiptState, sourceItems, type ExpenseRecord, type Income, type ManualExpense, type Transfer, type Wallet } from "@/lib/expenses";
import {
  balanceOn,
  balanceProposal,
  findDuplicate,
  importDrafts,
  isAriaryStatement,
  knownOperations,
  markDuplicates,
  operationKey,
  otherWallet,
  statementLines,
  statementTag,
  statementTotals,
  suggestedWallet,
} from "@/lib/statement";
import { scannedMoves, walletBook } from "@/lib/wallets";

// The route's dependencies: an AI engine that answers, and the plan of the account.
const state = vi.hoisted(() => ({ provider: "gemini", plan: "unlimited" as string, account: true as boolean, accountId: "reader-1", fail: false, calls: 0 }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/ai/provider", () => ({
  get activeProvider() {
    return state.provider;
  },
  readStatement: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("The AI is down.");
    const { mockStatement } = await import("@/lib/ai/mock");
    return { statement: mockStatement(Date.now()), model: "gemini-flash-latest", usage: { inputTokens: 5000, outputTokens: 900 } };
  },
}));
vi.mock("@/lib/server/plan", () => ({
  limitsFor: async () => ({ scans: 0, questionsPerDay: 0, parcels: 0, deepPerMonth: 0 }),
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

const { default: statementRoute } = await import("@/pages/api/expenses/statement");
const { getPlanUsage } = await import("@/lib/server/trialStore");
const { pdfPageCount } = await import("@/lib/server/pdfPages");

const day = (month: number, date: number) => new Date(2026, month - 1, date).getTime();
const base = { createdAt: 1, updatedAt: 1 };
const expense = (id: string, fields: Partial<ManualExpense>): ManualExpense => ({ ...base, id, kind: "expense", at: day(10, 5), amountMga: 1000, category: "market", ...fields });
const income = (id: string, fields: Partial<Income>): Income => ({ ...base, id, kind: "income", at: day(10, 5), amountMga: 1000, income: "other", ...fields });
const wallet = (id: string, type: Wallet["type"], startMga: number, startAt = day(10, 1)): Wallet => ({ ...base, kind: "wallet", id, name: id, type, startMga, startAt });

const operation = (fields: Partial<StatementOperation>): StatementOperation => ({
  date: "2026-10-10",
  amount: 10000,
  direction: "out",
  side: "debit",
  ownKind: null,
  counterparty: "Épicerie Soa",
  reference: null,
  fees: null,
  category: "market",
  incomeKind: null,
  balanceAfter: null,
  ...fields,
});
const statementOf = (operations: StatementOperation[], fields: Partial<Statement> = {}): Statement => ({
  institution: "MVola",
  kind: "mobile_money",
  operator: "mvola",
  currency: "MGA",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  closingBalance: null,
  operations,
  ...fields,
});

describe("statement contract", () => {
  it("validates the demo statement and refuses an unknown way", () => {
    expect(StatementSchema.safeParse(mockStatement(day(10, 29))).success).toBe(true);
    const bad = { ...mockStatement(day(10, 29)), operations: [{ ...mockStatement(day(10, 29)).operations[0], direction: "sideways" }] };
    expect(StatementSchema.safeParse(bad).success).toBe(false);
  });

  it("takes up to 10 screenshots, or one PDF, never both", () => {
    const page = { image: "aGVsbG8=", mediaType: "image/jpeg" as const };
    expect(StatementRequestSchema.safeParse({ locale: "fr", pages: [page] }).success).toBe(true);
    expect(StatementRequestSchema.safeParse({ locale: "fr", pages: Array(MAX_STATEMENT_PAGES + 1).fill(page) }).success).toBe(false);
    expect(StatementRequestSchema.safeParse({ locale: "fr", pdf: "JVBERi0=" }).success).toBe(true);
    expect(StatementRequestSchema.safeParse({ locale: "fr", pdf: "JVBERi0=", pages: [page] }).success).toBe(false);
    expect(StatementRequestSchema.safeParse({ locale: "fr" }).success).toBe(false);
  });

  it("counts a PDF's pages", () => {
    const pdf = (pages: number) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages /Count ${pages} >>\n${"2 0 obj << /Type /Page >>\n".repeat(pages)}`).toString("base64");
    expect(pdfPageCount(pdf(3))).toBe(3);
    expect(pdfPageCount(Buffer.from("%PDF-1.7 compressed").toString("base64"))).toBe(1);
  });

  it("imports ariary only", () => {
    expect(isAriaryStatement({ currency: "MGA" })).toBe(true);
    expect(isAriaryStatement({ currency: null })).toBe(true);
    expect(isAriaryStatement({ currency: "EUR" })).toBe(false);
  });
});

describe("stable key", () => {
  it("is the reference, case and spaces left out", () => {
    expect(operationKey(operation({ reference: "mp 2610.01" }))).toBe("statement:MP2610.01");
  });

  it("is a fingerprint of day, way, amount and name without one, the same however the name is written", () => {
    const key = operationKey(operation({}));
    expect(key).toMatch(/^statement:2026-10-10:out:10000:[0-9a-f]{8}$/);
    expect(key).not.toContain("Soa");
    expect(operationKey(operation({ counterparty: "EPICERIE  soa" }))).toBe(key);
    expect(operationKey(operation({ amount: 10001 }))).not.toBe(key);
  });

  it("tells two equal operations of one statement apart, the same way every time", () => {
    const twice = statementOf([operation({}), operation({})]);
    const keys = statementLines(twice, day(10, 31)).map((line) => line.key);
    expect(new Set(keys).size).toBe(2);
    expect(statementLines(twice, day(10, 31)).map((line) => line.key)).toEqual(keys);
  });

  it("dates an operation without a day on the statement's last day, and drops empty amounts", () => {
    const lines = statementLines(statementOf([operation({ date: null }), operation({ amount: 0 })]), day(11, 3));
    expect(lines).toHaveLength(1);
    expect(lines[0].at).toBe(day(10, 31));
  });
});

describe("already there", () => {
  const [line] = statementLines(statementOf([operation({ reference: "MP-1", amount: 15000, date: "2026-10-20" })]), day(10, 31));

  it("finds a line imported before, by its key", () => {
    expect(findDuplicate(line, knownOperations([income("i", { sourceKey: "statement:MP-1", amountMga: 1 })], []))).toBe("imported");
  });

  it("finds a scanned receipt or a typed-in expense with the same reference", () => {
    const scan = { id: "scan-1", createdAt: day(10, 20), analysis: { ...mockReceipt("fr"), document: { ...mockReceipt("fr").document!, receipt: { ...mockReceipt("fr").document!.receipt!, reference: "mp-1" } } } };
    expect(findDuplicate(line, knownOperations([], sourceItems({ receipts: [scan] })))).toBe("reference");
    expect(findDuplicate(line, knownOperations([expense("e", { reference: "MP-1", amountMga: 99 })], []))).toBe("reference");
  });

  it("else the same amount, the same way and the same day, one day apart at most", () => {
    const [plain] = statementLines(statementOf([operation({ amount: 15000, date: "2026-10-20" })]), day(10, 31));
    expect(findDuplicate(plain, knownOperations([expense("e", { amountMga: 15000, at: day(10, 21) })], []))).toBe("similar");
    expect(findDuplicate(plain, knownOperations([expense("e", { amountMga: 15000, at: day(10, 23) })], []))).toBeUndefined();
    expect(findDuplicate(plain, knownOperations([income("i", { amountMga: 15000, at: day(10, 20) })], []))).toBeUndefined();
  });

  it("finds the demo receipt in the demo statement", () => {
    const scan = { id: "scan-1", createdAt: day(10, 20), analysis: mockReceipt("fr") };
    const lines = markDuplicates(statementLines(mockStatement(Date.now()), Date.now()), knownOperations([], sourceItems({ receipts: [scan] })));
    expect(lines.filter((item) => item.duplicate).map((item) => item.reference)).toEqual([DEMO_RECEIPT_REFERENCE]);
  });
});

describe("import", () => {
  const pockets = [wallet("cash", "cash", 20000), wallet("mvola", "mvola", 100000), wallet("bank", "bank", 0)];
  const statement = statementOf(
    [
      operation({ reference: "A", amount: 15000, category: "transport" }),
      operation({ reference: "B", amount: 80000, direction: "in", side: "credit", incomeKind: "family", counterparty: "Rasoa", category: null }),
      operation({ reference: "C", amount: 50000, direction: "own", side: "debit", ownKind: "withdrawal", fees: 1200, counterparty: null, category: null }),
      operation({ reference: "D", amount: 30000, direction: "own", side: "credit", ownKind: "transfer", counterparty: null, category: null }),
      operation({ reference: "E", amount: 5000, fees: 100 }),
    ],
    { closingBalance: 64000 },
  );
  const lines = statementLines(statement, day(10, 31));
  const mvola = pockets[1];
  const tag = statementTag(statement, lines, "Relevé");
  const others = Object.fromEntries(lines.map((line) => [line.key, otherWallet(pockets, mvola.id, line)]));
  const drafts = importDrafts(lines, { wallet: mvola, tag, others, feesNote: "Frais MVola" });

  it("offers the operator's pocket, and cash for a withdrawal, another account for a transfer", () => {
    expect(suggestedWallet(pockets, statement)?.id).toBe("mvola");
    expect(suggestedWallet(pockets, { operator: null, kind: "bank" })?.id).toBe("bank");
    expect(otherWallet(pockets, "mvola", { ownKind: "withdrawal" })).toBe("cash");
    expect(otherWallet(pockets, "mvola", { ownKind: "transfer" })).toBe("bank");
  });

  it("makes an expense per payment, an income per money received, a move per own operation, with their fees", () => {
    expect(drafts.expenses.map((item) => [item.sourceKey, item.amountMga, item.category, item.wallet, item.payment])).toEqual([
      ["statement:A", 15000, "transport", "mvola", "mobile"],
      ["statement:E", 5000, "market", "mvola", "mobile"],
      ["statement:E:fees", 100, "phone", "mvola", "mobile"],
    ]);
    expect(drafts.incomes).toEqual([expect.objectContaining({ sourceKey: "statement:B", amountMga: 80000, income: "other", from: "family", note: "Rasoa", wallet: "mvola" })]);
    expect(drafts.transfers).toEqual([
      expect.objectContaining({ sourceKey: "statement:C", from: "mvola", to: "cash", amountMga: 50000, feesMga: 1200 }),
      expect.objectContaining({ sourceKey: "statement:D", from: "bank", to: "mvola", amountMga: 30000 }),
    ]);
    expect(drafts.expenses[0].statement).toEqual({ name: "MVola", from: day(10, 1), to: day(10, 31) });
  });

  it("keeps a move out without a second pocket, and counts what left and what came in", () => {
    expect(importDrafts(lines, { wallet: undefined, tag, others: {}, feesNote: "" }).transfers).toEqual([]);
    expect(statementTotals(lines)).toEqual({ count: 5, out: 15000 + 51200 + 5100, in: 80000 + 30000 });
  });

  it("adds nothing the second time: every line is then already there", () => {
    const records: ExpenseRecord[] = [
      ...pockets,
      ...drafts.expenses.map((item, index): ManualExpense => ({ ...base, id: `e${index}`, kind: "expense", ...item })),
      ...drafts.incomes.map((item, index): Income => ({ ...base, id: `i${index}`, kind: "income", ...item })),
      ...drafts.transfers.map((item, index): Transfer => ({ ...base, id: `t${index}`, kind: "transfer", ...item })),
    ];
    expect(markDuplicates(lines, knownOperations(records, [])).every((line) => line.duplicate === "imported")).toBe(true);
  });

  it("proposes the statement's final balance when the pocket says otherwise on its last day", () => {
    const now = day(11, 2);
    const later = expense("later", { at: day(11, 1), amountMga: 4000, wallet: "mvola" });
    const book = walletBook([...pockets, later], [], now);
    expect(balanceOn(book, "mvola", day(10, 31))).toBe(100000);
    expect(balanceProposal(book, "mvola", statement, lines)).toEqual({ at: day(10, 31), actual: 64000, held: 100000, difference: -36000 });
    expect(balanceProposal(book, "mvola", { ...statement, closingBalance: 100000 }, lines)).toBeNull();
    expect(balanceProposal(book, "mvola", { ...statement, closingBalance: null }, lines)).toBeNull();
    // Before the pocket was set: nothing to compare.
    expect(balanceProposal(walletBook([wallet("mvola", "mvola", 0, day(11, 1))], [], now), "mvola", statement, lines)).toBeNull();
  });
});

describe("a receipt scanned after the import", () => {
  const received = (reference: string | null) => {
    const analysis = mockReceipt("fr", "in");
    return { id: "scan-in", createdAt: day(10, 25), analysis: { ...analysis, document: { ...analysis.document!, receipt: { ...analysis.document!.receipt!, reference } } } };
  };
  const [line] = statementLines(statementOf([operation({ reference: "MP261022.0915.B77310", amount: 80000, date: "2026-10-22", direction: "in", side: "credit", category: null })]), day(10, 31));
  const [drafted] = importDrafts([line], { tag: { name: "MVola" }, others: {}, feesNote: "" }).incomes;
  const importedIncome: Income = { ...base, id: "imp", kind: "income", ...drafted };

  it("is not counted again when the imported income has its reference: it shows as counted already", () => {
    expect(importedIncome.reference).toBe("MP261022.0915.B77310");
    const scan = received("MP261022.0915.B77310");
    const incomes = monthIncomes([importedIncome], "2026-10", sourceItems({ receipts: [scan] }));
    expect(incomes.map((item) => item.key)).toEqual(["manual:imp"]);
    expect(receiptIncomeDuplicate([importedIncome], scan)?.id).toBe("imp");
  });

  it("without a reference, is in doubt when an imported income has the same amount within 3 days (a typed-in one is not compared)", () => {
    const withoutReference = { ...importedIncome, reference: undefined };
    const sources = sourceItems({ receipts: [received(null)] });
    const receipt = monthIncomes([withoutReference], "2026-10", sources).find((item) => item.key === "receipt:scan-in");
    expect(receipt).toMatchObject({ doubt: true, excluded: true });
    const typed = { ...withoutReference, sourceKey: undefined };
    expect(monthIncomes([typed], "2026-10", sources).find((item) => item.key === "receipt:scan-in")?.doubt).toBeUndefined();
  });
});

describe("a withdrawal scanned after the import", () => {
  const pockets = [wallet("cash", "cash", 0), wallet("mvola", "mvola", 500000)];
  const scan = (reference: string | null) => {
    const analysis = mockReceipt("fr", "own");
    return { id: "scan-own", createdAt: day(10, 25), analysis: { ...analysis, document: { ...analysis.document!, receipt: { ...analysis.document!.receipt!, reference } } } };
  };
  const importWithdrawal = (reference: string | null) => {
    const [line] = statementLines(
      statementOf([operation({ reference, amount: 200000, fees: 2600, date: "2026-10-21", direction: "own", side: "debit", ownKind: "withdrawal", counterparty: null, category: null })]),
      day(10, 31),
    );
    const [drafted] = importDrafts([line], { wallet: pockets[1], tag: { name: "MVola" }, others: { [line.key]: "cash" }, feesNote: "" }).transfers;
    return { ...base, id: "t1", kind: "transfer", ...drafted } as Transfer;
  };
  const counted = (records: ExpenseRecord[], sources: ReturnType<typeof sourceItems>) => ({
    moves: scannedMoves(records, sources).map((move) => move.key),
    fees: monthExpenses(records, sources, "2026-10").filter((item) => item.key.startsWith("receipt:")).map((item) => item.key),
  });

  it("with the same reference: neither a second move nor its fees, shown as imported already", () => {
    const transfer = importWithdrawal("MP261021.1710.C40027");
    expect(transfer.reference).toBe("MP261021.1710.C40027");
    const sources = sourceItems({ receipts: [scan("MP261021.1710.C40027")] });
    const records = [...pockets, transfer];
    expect(ownReceiptState(sources.find((item) => item.key === "receipt:scan-own")!, records, 2600)).toBe("imported");
    expect(counted(records, sources)).toEqual({ moves: [], fees: [] });
    // Without the import, the receipt moves the money and counts its fees, as before.
    expect(counted(pockets, sources)).toEqual({ moves: ["receipt:scan-own"], fees: ["receipt:scan-own:fees"] });
  });

  it("without a reference, the same amount within 3 days: in doubt until counted anyway", () => {
    const records: ExpenseRecord[] = [...pockets, importWithdrawal(null)];
    const sources = sourceItems({ receipts: [scan(null)] });
    expect(ownReceiptState(sources.find((item) => item.key === "receipt:scan-own")!, records, 2600)).toBe("doubt");
    expect(counted(records, sources)).toEqual({ moves: [], fees: [] });
    const anyway = [...records, { ...base, kind: "exclusion" as const, id: "keep", sourceKey: moveKeepKey("receipt:scan-own") }];
    expect(counted(anyway, sources)).toEqual({ moves: ["receipt:scan-own"], fees: ["receipt:scan-own:fees"] });
  });
});

describe("statement route", () => {
  const body = { locale: "fr", pages: [{ image: "aGVsbG8=", mediaType: "image/jpeg" }, { image: "aGVsbG8=", mediaType: "image/jpeg" }] };

  async function call(payload: unknown, method = "POST") {
    const req = { method, headers: {}, body: payload, socket: { remoteAddress: `10.2.0.${Math.floor(Math.random() * 250)}` } } as unknown as NextApiRequest;
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
    await statementRoute(req, res as unknown as NextApiResponse);
    return res as { statusCode: number; body: { error?: { code: string }; statement?: Statement; demo?: boolean; pages?: number } };
  }

  it("needs an account (401) with the expenses (403)", async () => {
    state.account = false;
    const signedOut = await call(body);
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.body.error?.code).toBe("sign_in_required");
    state.account = true;
    state.plan = "pro";
    const other = await call(body);
    expect(other.statusCode).toBe(403);
    expect(other.body.error?.code).toBe("plan_required");
    state.plan = "unlimited";
    expect(state.calls).toBe(0);
  });

  it("validates the request", async () => {
    expect((await call({ locale: "fr" })).statusCode).toBe(400);
    expect((await call({ locale: "fr", pdf: Buffer.from("not a pdf").toString("base64") })).statusCode).toBe(400);
    expect((await call(body, "GET")).statusCode).toBe(405);
  });

  it("reads the statement, each page counted as a scan", async () => {
    const response = await call(body);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ demo: false, pages: 2 });
    expect(response.body.statement?.operations).toHaveLength(6);
    expect((await getPlanUsage("reader-1")).scans).toBe(2);
  });

  it("gives the scans and the day's count back when the reading fails", async () => {
    state.accountId = "reader-2";
    state.fail = true;
    for (let index = 0; index < 12; index += 1) expect((await call(body)).statusCode).toBe(500);
    expect((await getPlanUsage("reader-2")).scans).toBe(0);
    state.fail = false;
    for (let index = 0; index < 10; index += 1) expect((await call(body)).statusCode).toBe(200);
    expect((await call(body)).body.error?.code).toBe("rate_limited");
    expect((await getPlanUsage("reader-2")).scans).toBe(20);
    state.accountId = "reader-1";
  });

  it("serves the demo statement without an AI key", async () => {
    state.provider = "demo";
    state.account = false;
    const response = await call(body);
    expect(response.statusCode).toBe(200);
    expect(response.body.demo).toBe(true);
    expect(response.body.statement?.operations.some((item) => item.reference === DEMO_RECEIPT_REFERENCE)).toBe(true);
    state.provider = "gemini";
    state.account = true;
  });

  it("prices the statements apart in Admin, AI cost", () => {
    expect(usageRows([{ "ai:statement:gemini-flash-latest:calls": 1, "ai:statement:gemini-flash-latest:in": 5000, "ai:statement:gemini-flash-latest:out": 900 }])).toEqual([
      { kind: "statement", model: "gemini-flash-latest", calls: 1, inputTokens: 5000, outputTokens: 900 },
    ]);
  });
});
