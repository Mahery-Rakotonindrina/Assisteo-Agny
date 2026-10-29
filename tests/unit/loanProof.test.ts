import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockLoanReading } from "@/lib/ai/loanScanDemo";
import { LoanReadingSchema, LoanScanRequestSchema, type LoanReading } from "@/lib/ai/schema";
import { annexProofs, canAddProof, hasProofs, loanProofs, MAX_PROOFS, proofPaths, proofsToUpload, remoteFiles, thumbnailPath, withoutProof, withProof } from "@/lib/loanProof";
import { guessDirection, isSameName, loanScanDraft, otherParty } from "@/lib/loanScan";
import type { Loan, LoanProof } from "@/lib/loans";

// The route's dependencies: an AI engine that reads, and the plan of the account.
const state = vi.hoisted(() => ({ provider: "gemini", plan: "unlimited" as string, account: true as boolean, accountId: "user-1", fail: false, calls: 0 }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/ai/provider", () => ({
  get activeProvider() {
    return state.provider;
  },
  readLoanDocument: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("The AI is down.");
    return { reading: mockLoanReading("fr"), model: "gemini-flash-latest", usage: { inputTokens: 1200, outputTokens: 200 } };
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
      quotas: null,
    };
  },
}));
// Canvas is not there in tests: an image is "encoded" as itself.
vi.mock("@/lib/image", () => ({
  encodeImage: async (src: string, edge: number) => ({ dataUrl: `${src}#${edge}`, base64: "", mediaType: "image/jpeg", width: edge, height: edge }),
}));

const { default: scanRoute } = await import("@/pages/api/loans/scan");
const { getPlanUsage } = await import("@/lib/server/trialStore");
const { loanStore } = await import("@/services/loanStore");
const { loanProofStore } = await import("@/services/loanProofStore");
const { acknowledgment } = await import("@/services/loanPdf");

const photo = (id: string, addedAt = 1, remote?: string): LoanProof => ({ id, kind: "photo", addedAt, ...(remote && { remote }) });
const scan = (id: string, scanId: string, addedAt = 1): LoanProof => ({ id, kind: "scan", scanId, addedAt });

const fr = JSON.parse(readFileSync(join(process.cwd(), "locales/fr.json"), "utf8"));
const t = (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce((node, part) => node?.[part], fr) as unknown as string;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};
const loan = (overrides: Partial<Loan> = {}): Loan => ({ id: "l1", direction: "lent", person: "Rakoto", amountMga: 100_000, at: new Date(2026, 9, 1).getTime(), repayments: [], updatedAt: 0, ...overrides });

describe("the proofs of a loan", () => {
  it("a loan without proofs works as before", () => {
    expect(loanProofs(loan())).toEqual([]);
    expect(hasProofs(loan())).toBe(false);
    expect(canAddProof(loan())).toBe(true);
    expect(remoteFiles(undefined)).toEqual([]);
    expect(acknowledgment(loan(), { me: "Hery", place: "" }, 0, t, "fr").annexes).toEqual([]);
  });

  it("adds up to 5, never the same scan twice", () => {
    let proofs: LoanProof[] | undefined = undefined;
    for (let index = 0; index < MAX_PROOFS; index += 1) proofs = withProof(proofs, photo(`p${index}`, index + 1)) ?? proofs;
    expect(proofs).toHaveLength(5);
    expect(withProof(proofs, photo("p9", 10))).toBeNull();
    expect(canAddProof({ proofs })).toBe(false);
    const one = withProof(undefined, scan("s1", "scan-1"))!;
    expect(withProof(one, scan("s2", "scan-1"))).toBeNull();
    expect(withProof(one, scan("s3", "scan-2"))).toHaveLength(2);
  });

  it("removes one, keeps the others in order, and drops what is broken", () => {
    const proofs = [photo("b", 2), photo("a", 1), { id: "x", kind: "scan", addedAt: 3 } as LoanProof];
    expect(loanProofs({ proofs }).map((proof) => proof.id)).toEqual(["a", "b"]);
    expect(withoutProof(proofs, "a").map((proof) => proof.id)).toEqual(["b"]);
    expect(withoutProof(proofs, "zz")).toHaveLength(2);
    expect(annexProofs({ proofs }).map((proof) => proof.id)).toEqual(["a", "b"]);
  });

  it("stores the photos under the user's folder, in loans/", () => {
    expect(proofPaths("u1", "l1", "p1")).toEqual({ preview: "u1/loans/l1/p1.jpg", thumbnail: "u1/loans/l1/p1.thumb.jpg" });
    expect(thumbnailPath("u1/loans/l1/p1.jpg")).toBe("u1/loans/l1/p1.thumb.jpg");
    const proofs = [photo("p1", 1, "u1/loans/l1/p1.jpg"), photo("p2", 2), scan("s1", "scan-1", 3)];
    // Only photos synced have files; a scan's photo belongs to the history.
    expect(remoteFiles(proofs)).toEqual(["u1/loans/l1/p1.jpg", "u1/loans/l1/p1.thumb.jpg"]);
    expect(proofsToUpload({ proofs }).map((proof) => proof.id)).toEqual(["p2"]);
  });

  it("joins the proofs in annex of the debt acknowledgment, one page each", () => {
    const text = acknowledgment(loan(), { me: "Hery", place: "" }, 0, t, "fr", 2);
    expect(text.annexes).toEqual(["Annexe 1 : preuve jointe", "Annexe 2 : preuve jointe"]);
  });
});

describe("the proofs on the device", () => {
  beforeEach(async () => {
    await loanStore.wipe();
  });

  it("adds a photo and a scan, removes them with their files", async () => {
    const created = (await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 50_000, at: 1 }))!;
    const added = (await loanStore.addPhotoProof(created.id, "data:image/jpeg;base64,AAA"))!;
    expect((await loanProofStore.get(added.id))?.thumbnail).toBe("data:image/jpeg;base64,AAA#320");
    expect(await loanStore.addScanProof(created.id, "scan-1")).not.toBeNull();
    expect(await loanStore.addScanProof(created.id, "scan-1")).toBeNull();
    expect(loanProofs((await loanStore.get(created.id))!)).toHaveLength(2);

    await loanStore.setProofRemote(created.id, added.id, "u1/loans/x/p.jpg");
    await loanStore.removeProof(created.id, added.id);
    expect(await loanProofStore.get(added.id)).toBeUndefined();
    expect((await loanProofStore.pendingRemovals()).sort()).toEqual(["u1/loans/x/p.jpg", "u1/loans/x/p.thumb.jpg"]);
    expect(loanProofs((await loanStore.get(created.id))!).map((proof) => proof.kind)).toEqual(["scan"]);
  });

  it("removing a loan removes its photos too", async () => {
    const created = (await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 50_000, at: 1 }))!;
    const added = (await loanStore.addPhotoProof(created.id, "data:image/jpeg;base64,BBB"))!;
    await loanStore.setProofRemote(created.id, added.id, "u1/loans/y/p.jpg");
    await loanStore.remove(created.id);
    expect(await loanProofStore.get(added.id)).toBeUndefined();
    expect(await loanProofStore.pendingRemovals()).toContain("u1/loans/y/p.jpg");
  });

  it("an edit keeps the proofs", async () => {
    const created = (await loanStore.create({ direction: "lent", person: "Rakoto", amountMga: 50_000, at: 1 }))!;
    await loanStore.addScanProof(created.id, "scan-1");
    await loanStore.edit(created.id, { direction: "lent", person: "Rakoto", amountMga: 60_000, at: 1 });
    expect(loanProofs((await loanStore.get(created.id))!)).toHaveLength(1);
  });
});

describe("a debt acknowledgment read by the AI", () => {
  const reading = (overrides: Partial<LoanReading> = {}): LoanReading => ({ ...mockLoanReading("fr"), ...overrides });

  it("checks the demo reading and the request", () => {
    for (const locale of ["fr", "en"] as const) expect(LoanReadingSchema.safeParse(mockLoanReading(locale)).success).toBe(true);
    expect(LoanReadingSchema.safeParse({ ...mockLoanReading("fr"), interest: { kind: "monthly", value: 5 } }).success).toBe(false);
    expect(LoanScanRequestSchema.safeParse({ image: "AAA", mediaType: "image/jpeg", locale: "fr" }).success).toBe(true);
    expect(LoanScanRequestSchema.safeParse({ image: "AAA", mediaType: "image/gif", locale: "fr" }).success).toBe(false);
    expect(LoanScanRequestSchema.safeParse({ image: "AAA", mediaType: "image/jpeg", locale: "fr", keep: true }).success).toBe(false);
  });

  it("tells the user's side from the account's name", () => {
    expect(isSameName("RASOA Marie", "Marie Rasoanirina")).toBe(true);
    expect(isSameName("Rakotó", "rakoto")).toBe(true);
    expect(isSameName("Rakoto", "")).toBe(false);
    expect(guessDirection({ lender: "Rasoa Marie", borrower: "Rakoto Jean" }, "Marie")).toBe("lent");
    expect(guessDirection({ lender: "Rasoa Marie", borrower: "Rakoto Jean" }, "Jean Rakoto")).toBe("borrowed");
    // Nobody, or both (same family name): ask.
    expect(guessDirection({ lender: "Rasoa Marie", borrower: "Rakoto Jean" }, "Hery")).toBeNull();
    expect(guessDirection({ lender: "Rakoto Marie", borrower: "Rakoto Jean" }, "Rakoto")).toBeNull();
  });

  it("the person is the other party", () => {
    const draft = loanScanDraft(reading(), "Rasoa Marie", "2026-10-29");
    expect(draft.direction).toBe("lent");
    expect(otherParty(draft, "lent")).toBe("Rakoto Jean");
    expect(otherParty(draft, "borrowed")).toBe("Rasoa Marie");
    expect(otherParty({ lender: null, borrower: null }, "lent")).toBe("");
  });

  it("prefills amount, days and place", () => {
    expect(loanScanDraft(reading(), null, "2026-10-29")).toMatchObject({
      direction: null,
      amountMga: 150_000,
      amountsDiffer: false,
      day: "2026-10-15",
      dueDay: "2026-12-15",
      installments: [],
      interest: undefined,
      place: "Antananarivo",
    });
  });

  it("flags figures and words that differ, keeps the figures", () => {
    const draft = loanScanDraft(reading({ amountFigures: 150_000, amountWordsValue: 15_000 }), null, "2026-10-29");
    expect(draft).toMatchObject({ amountMga: 150_000, amountsDiffer: true, amountWordsValue: 15_000 });
    expect(loanScanDraft(reading({ amountFigures: null, amountWordsValue: 80_000 }), null, "2026-10-29")).toMatchObject({ amountMga: 80_000, amountsDiffer: false });
  });

  it("drops a day lent in the future or not a real day, keeps a schedule of 2 or more", () => {
    const draft = loanScanDraft(
      reading({
        date: "2026-11-30",
        dueDate: "2026-02-30",
        installments: [
          { dueDate: "2027-01-15", amount: 50_000 },
          { dueDate: "2026-12-15", amount: 100_000 },
          { dueDate: "bad", amount: 1 },
        ],
        interest: { kind: "percent", value: 10 },
      }),
      null,
      "2026-10-29",
    );
    expect(draft.day).toBeNull();
    expect(draft.dueDay).toBeNull();
    expect(draft.installments).toEqual([
      { dueDay: "2026-12-15", amountMga: 100_000 },
      { dueDay: "2027-01-15", amountMga: 50_000 },
    ]);
    expect(draft.interest).toEqual({ kind: "percent", value: 10 });
    expect(loanScanDraft(reading({ installments: [{ dueDate: "2026-12-15", amount: 1 }] }), null, "2026-10-29").installments).toEqual([]);
  });
});

describe("the debt acknowledgment route", () => {
  const body = { image: "AAAA", mediaType: "image/jpeg", locale: "fr" };

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
    await scanRoute(req, res as unknown as NextApiResponse);
    return res as { statusCode: number; body: { error?: { code: string }; reading?: LoanReading; demo?: boolean } };
  }

  it("needs an account (401), then the loans (403)", async () => {
    state.account = false;
    expect((await call(body)).statusCode).toBe(401);
    state.account = true;
    state.plan = "pro";
    const refused = await call(body);
    expect(refused.statusCode).toBe(403);
    expect(refused.body.error?.code).toBe("plan_required");
    state.plan = "unlimited";
    expect(state.calls).toBe(0);
  });

  it("validates the request", async () => {
    expect((await call({ ...body, mediaType: "text/plain" })).statusCode).toBe(400);
    expect((await call(body, "GET")).statusCode).toBe(405);
  });

  it("reads the document and counts one of the month's scans", async () => {
    state.accountId = "user-3";
    const response = await call(body);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ demo: false, reading: { lender: "Rasoa Marie", amountFigures: 150_000 } });
    expect((await getPlanUsage("user-3")).scans).toBe(1);
  });

  it("gives the scan back when the reading fails", async () => {
    state.accountId = "user-4";
    state.fail = true;
    expect((await call(body)).statusCode).toBe(500);
    expect((await getPlanUsage("user-4")).scans).toBe(0);
    state.fail = false;
    state.accountId = "user-1";
  });

  it("serves the demo reading without an AI key, even signed out", async () => {
    state.provider = "demo";
    state.account = false;
    const calls = state.calls;
    const response = await call(body);
    expect(response.statusCode).toBe(200);
    expect(response.body.demo).toBe(true);
    expect(response.body.reading?.borrower).toBe("Rakoto Jean");
    expect(state.calls).toBe(calls);
    state.provider = "gemini";
    state.account = true;
  });
});
