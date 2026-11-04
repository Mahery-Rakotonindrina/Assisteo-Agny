// Turbopack's production pages start with an inline script per page: it queues
// the page's chunk list for the runtime (`globalThis.TURBOPACK.push(…)`). The
// site's CSP runs no inline script, so pages/_document.tsx writes that list as
// JSON (never run) and public/next-boot.js queues it, before the chunks, which
// are deferred too. Next's own inline script stays when it is not the expected
// one (a Next update): the CSP test (tests/e2e/csp.spec.ts) then fails.

/** The external script that queues the list, and the id of its JSON. */
export const BOOT_SCRIPT_SRC = "/next-boot.js";
export const BOOT_DATA_ID = "__NEXT_BOOT__";

type BootManifest = { pagesChunkGroupBootstrapParams?: Record<string, unknown>; chunkLoadingGlobal?: string };

/** What the queue receives for a page: its global's name and the params of `_app` then the page. */
export function bootData(manifest: BootManifest, page: string) {
  const byPage = manifest.pagesChunkGroupBootstrapParams;
  const global = manifest.chunkLoadingGlobal;
  if (!byPage || !global) return null;
  const params = ["/_app", page].map((name) => byPage[name]).filter(Boolean);
  return params.length > 0 ? { global, params } : null;
}

// As Next's htmlEscapeJsonString: a JSON text safe inside a <script>.
const escapes: Record<string, string> = { "&": "\\u0026", ">": "\\u003e", "<": "\\u003c", "\u2028": "\\u2028", "\u2029": "\\u2029" };
export const escapeJson = (json: string) => json.replace(/[&><\u2028\u2029]/g, (char) => escapes[char]);

/** Next's inline script for the same data (next/dist/server/get-page-files.js), to check it is the one replaced. */
export function inlineBootstrap({ global, params }: { global: string; params: unknown[] }) {
  const name = JSON.stringify(global);
  return escapeJson(params.map((value) => `(globalThis[${name}] || (globalThis[${name}] = [])).push(${JSON.stringify(value)});`).join("\n"));
}
