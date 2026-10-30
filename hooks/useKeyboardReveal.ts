import { useEffect } from "react";
import { hiddenByKeyboard, opensKeyboard } from "@/lib/keyboardReveal";

/**
 * Scrolls the focused field back into view once the keyboard has opened over
 * it (bottom sheets on iOS Safari). Touch screens only; a field that is
 * already visible never moves, so Android keeps its own behaviour.
 */
export function useKeyboardReveal() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !window.matchMedia("(pointer: coarse)").matches) return;

    let timer: number | undefined;
    const reveal = () => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement)) return;
      if (!opensKeyboard(field.tagName, field.getAttribute("type"))) return;
      const rect = field.getBoundingClientRect();
      if (hiddenByKeyboard(rect, viewport)) field.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    // The keyboard opens after the focus: wait for the viewport to settle.
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reveal, 150);
    };

    document.addEventListener("focusin", later);
    viewport.addEventListener("resize", later);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", later);
      viewport.removeEventListener("resize", later);
    };
  }, []);
}
