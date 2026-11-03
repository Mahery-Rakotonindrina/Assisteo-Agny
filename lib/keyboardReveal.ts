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

/**
 * Where a sheet's backdrop goes: over the visible part of the screen only.
 * iOS (and Chrome on Android, by default) keeps the page's height when the
 * keyboard opens and only shrinks the visual viewport, so a sheet pinned to
 * the bottom of the page ends up under the keyboard, with a blank gap above
 * it. Pinch zoom also shrinks the visual viewport: the page is kept then.
 * `keyboard` is true when a keyboard (not a toolbar) takes the bottom.
 */
export function sheetFrame(
  viewport: { offsetTop: number; height: number; scale: number },
  innerHeight: number,
): { top: number; height: number; keyboard: boolean } {
  if (viewport.scale > 1.01) return { top: 0, height: innerHeight, keyboard: false };
  const top = Math.max(0, Math.round(viewport.offsetTop));
  const height = Math.round(Math.min(viewport.height, innerHeight - top));
  return { top, height, keyboard: innerHeight - viewport.height > 120 };
}

/**
 * How far a sheet must scroll (positive: down) for its focused field to be
 * whole between `area.top` and `area.bottom`: the sheet's visible part, above
 * its sticky buttons and the keyboard. 0 when it already is. A field taller
 * than the area shows its top.
 */
export function revealDelta(field: { top: number; bottom: number }, area: { top: number; bottom: number }, margin = 12): number {
  const top = area.top + margin;
  const bottom = area.bottom - margin;
  if (field.top < top) return Math.round(field.top - top);
  if (field.bottom > bottom) return Math.round(Math.min(field.bottom - bottom, field.top - top));
  return 0;
}
