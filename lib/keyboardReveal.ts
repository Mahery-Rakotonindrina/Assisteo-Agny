// When the on-screen keyboard opens over a sheet, the focused field can end up
// behind it (iOS Safari only shrinks the visual viewport). Pure helpers for
// hooks/useKeyboardReveal.ts.

// Input types that bring up neither a keyboard nor a picker.
const nonTyping = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "hidden", "image"]);

/** True for a field that brings up the keyboard (or iOS's picker wheel). */
export function opensKeyboard(tagName: string, type?: string | null): boolean {
  const tag = tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !nonTyping.has((type || "text").toLowerCase());
}

/**
 * True when the field is not fully inside the visible part of the page.
 * `field` comes from getBoundingClientRect (layout viewport coordinates);
 * `viewport` is window.visualViewport's offsetTop and height. `margin` keeps a
 * little room above the keyboard.
 */
export function hiddenByKeyboard(
  field: { top: number; bottom: number },
  viewport: { offsetTop: number; height: number },
  margin = 12,
): boolean {
  const visibleTop = viewport.offsetTop;
  const visibleBottom = viewport.offsetTop + viewport.height;
  return field.bottom > visibleBottom - margin || field.top < visibleTop;
}
