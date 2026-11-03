import { describe, expect, it } from "vitest";
import { areAllHidden, BALANCE_MASK, isHidden, isTotalHidden, noMask, normalizeMask, toggleAll, toggleOne } from "@/lib/balanceMask";

const ids = ["cash", "mvola", "bank"];

describe("hidden pocket balances", () => {
  it("shows the exact stars the owner asked for", () => {
    expect(BALANCE_MASK).toBe("************");
  });

  it("hides nothing by default, and an older or bad stored value hides nothing", () => {
    expect(isHidden(noMask, "cash")).toBe(false);
    expect(normalizeMask(undefined)).toEqual(noMask);
    expect(normalizeMask("x")).toEqual(noMask);
    expect(normalizeMask({ all: "yes", ids: ["a", 3] })).toEqual({ all: false, ids: ["a"] });
  });

  it("hides one pocket only, and shows it again", () => {
    const hidden = toggleOne(noMask, "mvola", ids);
    expect(ids.filter((id) => isHidden(hidden, id))).toEqual(["mvola"]);
    expect(toggleOne(hidden, "mvola", ids)).toEqual(noMask);
  });

  it("keeps the total hidden while any pocket in it is hidden", () => {
    expect(isTotalHidden(noMask, ids)).toBe(false);
    expect(isTotalHidden(toggleOne(noMask, "bank", ids), ids)).toBe(true);
    // A hidden pocket outside the total (an archived one) does not hide it.
    expect(isTotalHidden({ all: false, ids: ["old"] }, ids)).toBe(false);
    expect(isTotalHidden({ all: true, ids: [] }, ids)).toBe(true);
  });

  it("the eye hides every balance, and shows them all again", () => {
    const closed = toggleAll(noMask, ids);
    expect(ids.every((id) => isHidden(closed, id))).toBe(true);
    expect(areAllHidden(closed, ids)).toBe(true);
    expect(toggleAll(closed, ids)).toEqual(noMask);
    // Every pocket hidden one by one reads as closed too: the next tap opens them all.
    const each = ids.reduce((mask, id) => toggleOne(mask, id, ids), noMask);
    expect(areAllHidden(each, ids)).toBe(true);
    expect(toggleAll(each, ids)).toEqual(noMask);
  });

  it("shows one pocket under the eye without showing the others", () => {
    const shown = toggleOne(toggleAll(noMask, ids), "cash", ids);
    expect(ids.map((id) => isHidden(shown, id))).toEqual([false, true, true]);
    expect(isTotalHidden(shown, ids)).toBe(true);
  });
});
