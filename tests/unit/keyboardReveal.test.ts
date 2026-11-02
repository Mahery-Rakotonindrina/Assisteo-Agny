import { describe, expect, it } from "vitest";
import { hiddenByKeyboard, opensKeyboard } from "@/lib/keyboardReveal";

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
