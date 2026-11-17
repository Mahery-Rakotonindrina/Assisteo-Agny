import { describe, expect, it } from "vitest";
import type { PlanFeature } from "@/lib/plans";
import {
  arrangeShortcuts,
  availableShortcuts,
  defaultShortcuts,
  homeShortcutKeys,
  isDefaultShortcuts,
  moveShortcut,
  normalizeShortcuts,
  setShortcutHidden,
  type ShortcutContext,
} from "@/lib/homeShortcuts";

const context = (features: PlanFeature[], rest: Partial<ShortcutContext> = {}): ShortcutContext => ({
  has: (feature) => features.includes(feature),
  hasBills: false,
  inHousehold: false,
  keptExpenses: false,
  keptLoans: false,
  ...rest,
});

describe("home shortcuts: what the plan offers", () => {
  it("never offers what the plan does not give", () => {
    const free = availableShortcuts(context([]));
    expect(free).not.toContain("shop");
    expect(free).not.toContain("expenses");
    expect(free).not.toContain("pockets");
    expect(free).not.toContain("loans");
    expect(free).toContain("health");
  });

  it("offers a feature's shortcuts when the plan gives it", () => {
    const all = availableShortcuts(context(["shop", "expenses", "loans"], { hasBills: true }));
    expect(all).toEqual([...homeShortcutKeys]);
  });

  it("keeps kept expenses and loans reachable, but not the pockets", () => {
    const kept = availableShortcuts(context([], { keptExpenses: true, keptLoans: true }));
    expect(kept).toContain("expenses");
    expect(kept).toContain("loans");
    expect(kept).not.toContain("pockets");
    expect(availableShortcuts(context([], { inHousehold: true }))).toContain("expenses");
  });

  it("offers the agenda to every plan, first by default", () => {
    expect(availableShortcuts(context([]))[0]).toBe("agenda");
    expect(homeShortcutKeys[0]).toBe("agenda");
    expect(availableShortcuts(context(["shop", "expenses", "loans"], { hasBills: true }))).toContain("agenda");
  });

  it("lets the agenda be hidden and moved like the others", () => {
    const available = availableShortcuts(context([]));
    const hidden = setShortcutHidden(defaultShortcuts, "agenda", true);
    expect(arrangeShortcuts(available, hidden).visible).not.toContain("agenda");
    const down = moveShortcut(defaultShortcuts, available, "agenda", 1);
    expect(arrangeShortcuts(available, down).all.slice(0, 2)).toEqual(["food", "agenda"]);
  });

  it("shows bills only when there are some", () => {
    expect(availableShortcuts(context([]))).not.toContain("bills");
    expect(availableShortcuts(context([], { hasBills: true }))).toContain("bills");
  });
});

describe("home shortcuts: order and hidden", () => {
  const available = ["food", "papers", "garage", "health", "loans"];

  it("keeps the default order without a setting", () => {
    expect(arrangeShortcuts(available, defaultShortcuts)).toEqual({ all: available, visible: available });
  });

  it("follows the saved order, the others after in the default order", () => {
    const { all } = arrangeShortcuts(available, { hidden: [], order: ["loans", "food"] });
    expect(all).toEqual(["loans", "food", "papers", "garage", "health"]);
  });

  it("puts a shortcut added later at the end", () => {
    // The saved order was written before "plants" existed.
    const { all } = arrangeShortcuts([...available, "plants"], { hidden: [], order: ["health", "loans", "food", "papers", "garage"] });
    expect(all[all.length - 1]).toBe("plants");
  });

  it("ignores unknown or removed keys without failing", () => {
    const pref = { hidden: ["gone", "papers"], order: ["gone", "loans", "alsoGone"] };
    const { all, visible } = arrangeShortcuts(available, pref);
    expect(all).toEqual(["loans", "food", "papers", "garage", "health"]);
    expect(visible).toEqual(["loans", "food", "garage", "health"]);
  });

  it("never shows a hidden one nor one the plan does not give, whatever the setting", () => {
    // "shop" is named in the order but not available (plan): it does not appear.
    const { all, visible } = arrangeShortcuts(available, { hidden: ["food"], order: ["shop", "food"] });
    expect(all).not.toContain("shop");
    expect(visible).not.toContain("food");
  });

  it("can hide everything: the list is then empty (the home says so)", () => {
    expect(arrangeShortcuts(available, { hidden: available, order: [] }).visible).toEqual([]);
  });

  it("returns nothing from nothing", () => {
    expect(arrangeShortcuts([], { hidden: ["a"], order: ["a"] })).toEqual({ all: [], visible: [] });
  });
});

describe("home shortcuts: editing", () => {
  const available = ["food", "papers", "garage"];

  it("moves one up and down", () => {
    const up = moveShortcut(defaultShortcuts, available, "garage", -1);
    expect(arrangeShortcuts(available, up).all).toEqual(["food", "garage", "papers"]);
    const down = moveShortcut(up, available, "food", 1);
    expect(arrangeShortcuts(available, down).all).toEqual(["garage", "food", "papers"]);
  });

  it("does not move past the ends", () => {
    expect(moveShortcut(defaultShortcuts, available, "food", -1)).toBe(defaultShortcuts);
    expect(moveShortcut(defaultShortcuts, available, "garage", 1)).toBe(defaultShortcuts);
    expect(moveShortcut(defaultShortcuts, available, "nope", 1)).toBe(defaultShortcuts);
  });

  it("keeps a shortcut not available now (plan lapsed) in the saved order, for when it comes back (after the others)", () => {
    const moved = moveShortcut({ hidden: [], order: ["loans", "food"] }, available, "papers", -1);
    expect(moved.order).toContain("loans");
    expect(arrangeShortcuts([...available, "loans"], moved).all).toEqual(["papers", "food", "garage", "loans"]);
  });

  it("hides and shows without duplicates", () => {
    const hidden = setShortcutHidden(setShortcutHidden(defaultShortcuts, "papers", true), "papers", true);
    expect(hidden.hidden).toEqual(["papers"]);
    expect(setShortcutHidden(hidden, "papers", false).hidden).toEqual([]);
  });

  it("is back to default when emptied", () => {
    expect(isDefaultShortcuts(defaultShortcuts)).toBe(true);
    expect(isDefaultShortcuts({ hidden: ["food"], order: [] })).toBe(false);
  });
});

describe("home shortcuts: what was stored", () => {
  it("reads a damaged value as the default", () => {
    for (const value of [null, undefined, "x", 3, [], { hidden: "food", order: 4 }]) expect(normalizeShortcuts(value)).toEqual(defaultShortcuts);
  });

  it("keeps only strings, once each", () => {
    expect(normalizeShortcuts({ hidden: ["food", 3, "food", null], order: ["papers", {}, "garage"] })).toEqual({ hidden: ["food"], order: ["papers", "garage"] });
  });
});
