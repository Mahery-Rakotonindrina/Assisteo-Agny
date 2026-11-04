import { createHash } from "node:crypto";

/**
 * The only inline script of the pages (pages/_document.tsx), run before first
 * paint: Capacitor injects its bridge before page scripts, so native builds are
 * tagged before desktop styles can flash on tablets, and the chosen text size
 * is applied then too, so the text never jumps.
 *
 * The site's CSP allows it by its hash (next.config.ts), not 'unsafe-inline':
 * any change here changes the hash, computed from this same string.
 */
export const bootScript =
  "if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())document.documentElement.classList.add('native');try{var s=localStorage.getItem('text-size');if(s&&s!=='normal')document.documentElement.dataset.textSize=s}catch(e){}";

/** A CSP source for an inline script: `'sha256-…'` of its exact text. */
export function scriptHash(source: string) {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}
