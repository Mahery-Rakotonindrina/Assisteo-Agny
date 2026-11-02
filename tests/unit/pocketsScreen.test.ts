import { describe, expect, it } from "vitest";
import { monthKey } from "@/lib/expenses";
import { correctionId, movementTarget, pocketPreview, type Movement } from "@/lib/wallets";

// "Mes poches", the screen: the summary under "Il te reste" and what a statement line opens.

describe("pocketPreview", () => {
  it("shows up to 4 pockets, then counts the others", () => {
    expect(pocketPreview(["a", "b", "c"])).toEqual({ shown: ["a", "b", "c"], more: 0 });
    expect(pocketPreview(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b", "c", "d"], more: 0 });
    expect(pocketPreview(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c", "d"], more: 1 });
    expect(pocketPreview(["a", "b", "c", "d", "e", "f", "g"], 2)).toEqual({ shown: ["a", "b"], more: 5 });
    expect(pocketPreview([])).toEqual({ shown: [], more: 0 });
  });
});

describe("correctionId", () => {
  it("names a correction's record, nothing else", () => {
    expect(correctionId({ type: "correction", key: "correction:c1" })).toBe("c1");
    expect(correctionId({ type: "expense", key: "correction:c1" })).toBeUndefined();
    expect(correctionId({ type: "correction", key: "other" })).toBeUndefined();
  });
});

describe("movementTarget", () => {
  const at = new Date(2026, 9, 14, 10).getTime();
  const base: Movement = { key: "k1", type: "expense", at, amountMga: -5000 };

  it("opens a typed-in expense in its form", () => {
    expect(movementTarget({ ...base, recordId: "e1" })).toEqual({ pathname: "/expenses", query: { open: "e1" } });
  });

  it("shows any other expense or income in its month and tab", () => {
    expect(movementTarget(base)).toEqual({ pathname: "/expenses", query: { month: monthKey(at), tab: "month", focus: "k1" } });
    expect(movementTarget({ ...base, type: "income", amountMga: 5000, recordId: "i1" })).toEqual({
      pathname: "/expenses",
      query: { month: "2026-10", tab: "income", focus: "k1" },
    });
  });

  it("opens a loan's person in Prêts, the borrowed side named", () => {
    expect(movementTarget({ ...base, type: "loan", loan: { type: "lent", personKey: "rakoto", direction: "lent" } })).toEqual({ pathname: "/loans", query: { person: "rakoto" } });
    expect(movementTarget({ ...base, type: "loan", loan: { type: "borrowed", personKey: "rabe", direction: "borrowed" } })).toEqual({
      pathname: "/loans",
      query: { dir: "borrowed", person: "rabe" },
    });
  });

  it("opens a scanned move in its result, nothing for a correction or a move by hand", () => {
    expect(movementTarget({ ...base, type: "move_out", href: "/result?id=s1" })).toBe("/result?id=s1");
    expect(movementTarget({ ...base, type: "move_in" })).toBeNull();
    expect(movementTarget({ ...base, type: "correction" })).toBeNull();
    expect(movementTarget({ ...base, type: "saved" })).toBeNull();
  });
});
