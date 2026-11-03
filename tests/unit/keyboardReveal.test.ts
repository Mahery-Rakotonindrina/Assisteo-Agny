import { describe, expect, it } from "vitest";
import { hiddenByKeyboard, opensKeyboard, revealDelta, sheetFrame } from "@/lib/keyboardReveal";

describe("opensKeyboard", () => {
  it("accepts text fields, selects and textareas", () => {
    expect(opensKeyboard("INPUT", null)).toBe(true);
    expect(opensKeyboard("input", "number")).toBe(true);
    expect(opensKeyboard("INPUT", "date")).toBe(true);
    expect(opensKeyboard("TEXTAREA")).toBe(true);
    expect(opensKeyboard("SELECT")).toBe(true);
  });

  it("ignores checkboxes, buttons and other elements", () => {
    expect(opensKeyboard("INPUT", "checkbox")).toBe(false);
    expect(opensKeyboard("INPUT", "RADIO")).toBe(false);
    expect(opensKeyboard("INPUT", "file")).toBe(false);
    expect(opensKeyboard("BUTTON")).toBe(false);
    expect(opensKeyboard("DIV")).toBe(false);
  });
});

describe("hiddenByKeyboard", () => {
  // 844 px tall screen, keyboard takes the bottom 336 px.
  const withKeyboard = { offsetTop: 0, height: 508 };

  it("flags a field under the keyboard", () => {
    expect(hiddenByKeyboard({ top: 700, bottom: 744 }, withKeyboard)).toBe(true);
  });

  it("flags a field touching the keyboard's edge", () => {
    expect(hiddenByKeyboard({ top: 460, bottom: 500 }, withKeyboard)).toBe(true);
  });

  it("leaves a visible field alone", () => {
    expect(hiddenByKeyboard({ top: 200, bottom: 244 }, withKeyboard)).toBe(false);
  });

  it("follows a visual viewport scrolled down", () => {
    const scrolled = { offsetTop: 300, height: 508 };
    expect(hiddenByKeyboard({ top: 700, bottom: 744 }, scrolled)).toBe(false);
    expect(hiddenByKeyboard({ top: 250, bottom: 290 }, scrolled)).toBe(true);
  });
});

describe("sheetFrame", () => {
  it("covers the whole page without a keyboard", () => {
    expect(sheetFrame({ offsetTop: 0, height: 844, scale: 1 }, 844)).toEqual({ top: 0, height: 844, keyboard: false });
  });

  it("follows the part above an iOS keyboard, scrolled or not", () => {
    expect(sheetFrame({ offsetTop: 0, height: 420, scale: 1 }, 844)).toEqual({ top: 0, height: 420, keyboard: true });
    expect(sheetFrame({ offsetTop: 210.4, height: 420, scale: 1 }, 844)).toEqual({ top: 210, height: 420, keyboard: true });
  });

  it("keeps the page when it is zoomed, and a toolbar is not a keyboard", () => {
    expect(sheetFrame({ offsetTop: 100, height: 300, scale: 2 }, 844)).toEqual({ top: 0, height: 844, keyboard: false });
    expect(sheetFrame({ offsetTop: 0, height: 790, scale: 1 }, 844).keyboard).toBe(false);
  });
});

describe("revealDelta", () => {
  // The sheet shows 100–400; its buttons start at 330.
  const area = { top: 100, bottom: 330 };

  it("leaves a field in sight", () => {
    expect(revealDelta({ top: 150, bottom: 200 }, area)).toBe(0);
  });

  it("scrolls a field behind the buttons up above them", () => {
    expect(revealDelta({ top: 300, bottom: 352 }, area)).toBe(34);
  });

  it("scrolls back to a field above the sheet's top", () => {
    expect(revealDelta({ top: 60, bottom: 110 }, area)).toBe(-52);
  });

  it("shows the top of a field taller than the room", () => {
    expect(revealDelta({ top: 200, bottom: 600 }, area)).toBe(88);
  });
});
