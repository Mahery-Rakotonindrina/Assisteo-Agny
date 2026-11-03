import { useEffect, useRef } from "react";
import { opensKeyboard, revealDelta, sheetFrame } from "@/lib/keyboardReveal";

/** The element that scrolls the field: the sheet itself in every window. */
function scroller(field: HTMLElement, root: HTMLElement): HTMLElement | null {
  for (let node = field.parentElement; node && node !== root; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** The top of the sheet's sticky buttons ("Enregistrer", "Annuler"), when they are below the field. */
function buttonsTop(sheet: HTMLElement, field: HTMLElement, bottom: number): number {
  let top = bottom;
  for (const node of sheet.querySelectorAll<HTMLElement>("*")) {
    // Only what comes after the field (a sticky title above it is not in the way).
    if (node.contains(field) || !(field.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const style = getComputedStyle(node);
    if (style.position !== "sticky" || style.bottom === "auto") continue;
    top = Math.min(top, node.getBoundingClientRect().top);
  }
  return top;
}

/**
 * A bottom sheet with fields, on a phone: its backdrop (the returned ref)
 * covers the visible part of the screen only, so the sheet sits right on the
 * keyboard (no blank gap, nothing behind the keyboard), and the focused field
 * is scrolled into sight above the sheet's sticky buttons. The keyboard hides
 * the home bar: `--safe-bottom` is 0 meanwhile. Sets `--viewport-height` for
 * the sheet's max-height. Nothing changes without a keyboard.
 */
export function useSheetKeyboard<T extends HTMLElement = HTMLDivElement>(open = true) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    const backdrop = ref.current;
    if (!open || !viewport || !backdrop) return;
    // The page-wide reveal (useKeyboardReveal) leaves these fields to this hook.
    backdrop.dataset.sheetKeyboard = "";

    const fit = () => {
      const frame = sheetFrame(viewport, window.innerHeight);
      const moved = frame.keyboard || frame.top > 0 || frame.height < window.innerHeight - 1;
      const style = backdrop.style;
      if (!moved) {
        for (const name of ["top", "bottom", "height", "--viewport-height", "--safe-bottom"]) style.removeProperty(name);
        return;
      }
      style.setProperty("top", `${frame.top}px`);
      style.setProperty("bottom", "auto");
      style.setProperty("height", `${frame.height}px`);
      style.setProperty("--viewport-height", `${frame.height}px`);
      if (frame.keyboard) style.setProperty("--safe-bottom", "0px");
      else style.removeProperty("--safe-bottom");
    };

    const reveal = () => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !backdrop.contains(field)) return;
      if (!opensKeyboard(field.tagName, field.getAttribute("type"))) return;
      const sheet = scroller(field, backdrop);
      if (!sheet) return;
      const box = sheet.getBoundingClientRect();
      const bottom = Math.min(box.bottom, viewport.offsetTop + viewport.height);
      const delta = revealDelta(field.getBoundingClientRect(), { top: Math.max(box.top, viewport.offsetTop), bottom: buttonsTop(sheet, field, bottom) });
      if (delta !== 0) sheet.scrollTop += delta;
    };

    // The keyboard opens (and iOS scrolls the page) after the focus: again once it has settled.
    let timer: number | undefined;
    const settle = () => {
      fit();
      window.requestAnimationFrame(reveal);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        fit();
        reveal();
      }, 320);
    };

    fit();
    viewport.addEventListener("resize", settle);
    viewport.addEventListener("scroll", fit);
    backdrop.addEventListener("focusin", settle);
    return () => {
      window.clearTimeout(timer);
      viewport.removeEventListener("resize", settle);
      viewport.removeEventListener("scroll", fit);
      backdrop.removeEventListener("focusin", settle);
    };
  }, [open]);

  return ref;
}
