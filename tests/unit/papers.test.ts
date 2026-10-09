import { describe, expect, it } from "vitest";
import { AnalysisSchema, normalizeStoredAnalysis, type Analysis } from "@/lib/ai/schema";
import { mockAnalysis } from "@/lib/ai/mock";
import { dayString, daysUntil, listPapers, paperExpiry, paperKind, paperStatus, parseDay } from "@/lib/papers";

const bill = mockAnalysis("document", "fr");
const doc = (document: Partial<NonNullable<Analysis["document"]>>, extra: { paper?: "none" | "passport"; expiresOn?: string } = {}, createdAt = 0) => ({
  analysis: { document: { ...bill.document!, ...document } },
  createdAt,
  ...extra,
});
const now = new Date(2026, 9, 9, 15).getTime();

describe("my papers", () => {
  it("files a scan from the AI's kind, insurance, or the user's choice", () => {
    expect(paperKind(doc({ paper: "id_card" }))).toBe("id_card");
    expect(paperKind(doc({ paper: null, isInsurance: true }))).toBe("insurance");
    expect(paperKind(doc({ paper: null }))).toBeNull();
    expect(paperKind(doc({ paper: null }, { paper: "passport" }))).toBe("passport");
    expect(paperKind(doc({ paper: "id_card" }, { paper: "none" }))).toBeNull();
    expect(paperKind({ analysis: { document: null }, createdAt: 0 })).toBeNull();
  });

  it("takes the user's expiry date over the one read", () => {
    expect(paperExpiry(doc({ expiresOn: "2027-01-31" }))).toBe(new Date(2027, 0, 31).getTime());
    expect(paperExpiry(doc({ expiresOn: "2027-01-31" }, { expiresOn: "2028-02-29" }))).toBe(new Date(2028, 1, 29).getTime());
    expect(parseDay("31/01/2027")).toBeNull();
    expect(dayString(new Date(2027, 0, 5).getTime())).toBe("2027-01-05");
  });

  it("tells expired, soon and valid papers apart", () => {
    const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
    expect(paperStatus(day(2026, 10, 8), now)).toBe("expired");
    // Still valid on its last day.
    expect(paperStatus(day(2026, 10, 9), now)).toBe("soon");
    expect(paperStatus(day(2026, 12, 8), now)).toBe("soon");
    expect(paperStatus(day(2027, 1, 9), now)).toBe("valid");
    expect(paperStatus(null, now)).toBe("undated");
    expect(daysUntil(day(2026, 10, 19), now)).toBe(10);
  });

  it("lists the most urgent papers first", () => {
    const entries = [
      { id: "valid", ...doc({ paper: "passport", expiresOn: "2030-01-01" }) },
      { id: "undated-old", ...doc({ paper: "warranty", expiresOn: null }, {}, 1) },
      { id: "expired", ...doc({ paper: "insurance", expiresOn: "2026-01-01" }) },
      { id: "bill", ...doc({ paper: null }) },
      { id: "undated-new", ...doc({ paper: "certificate", expiresOn: null }, {}, 2) },
      { id: "soon", ...doc({ paper: "id_card", expiresOn: "2026-11-01" }) },
    ];
    expect(listPapers(entries, now).map((paper) => paper.entry.id)).toEqual(["expired", "soon", "valid", "undated-new", "undated-old"]);
  });

  it("still reads documents saved before papers existed", () => {
    const old = { ...bill, document: { ...bill.document } as Record<string, unknown> };
    delete old.document.paper;
    expect(AnalysisSchema.safeParse(normalizeStoredAnalysis(old)).success).toBe(true);
  });
});
