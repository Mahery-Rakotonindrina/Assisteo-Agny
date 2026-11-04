import { describe, expect, it } from "vitest";
import { getTurbopackChunkGroupBootstrap } from "next/dist/server/get-page-files";
import { htmlEscapeJsonString } from "next/dist/shared/lib/htmlescape";
import { bootData, escapeJson, inlineBootstrap } from "@/lib/turbopackBoot";

// Turbopack's inline chunk list, moved to JSON for the CSP (pages/_document.tsx).

const manifest = {
  chunkLoadingGlobal: "TURBOPACK",
  pagesChunkGroupBootstrapParams: {
    "/_app": { otherChunks: ["static/chunks/a.js", "static/chunks/a.css"], runtimeModuleIds: [1, 2] },
    "/pret": { otherChunks: ["static/chunks/p.js"], runtimeModuleIds: [1, 3] },
  },
};

describe("Turbopack's chunk list", () => {
  it("is the app's params then the page's", () => {
    expect(bootData(manifest, "/pret")).toEqual({ global: "TURBOPACK", params: [manifest.pagesChunkGroupBootstrapParams["/_app"], manifest.pagesChunkGroupBootstrapParams["/pret"]] });
    expect(bootData(manifest, "/other")?.params).toHaveLength(1);
    expect(bootData({}, "/pret")).toBeNull();
  });

  it("matches the inline script of the installed Next, so only that one is replaced", () => {
    const data = bootData(manifest, "/pret")!;
    const next = getTurbopackChunkGroupBootstrap(manifest.pagesChunkGroupBootstrapParams, "TURBOPACK", ["/_app", "/pret"]);
    expect(inlineBootstrap(data)).toBe(htmlEscapeJsonString(next!));
  });

  it("writes JSON that can never close its <script>", () => {
    expect(escapeJson(JSON.stringify({ a: "</script><b>&" }))).not.toMatch(/[<>&]/);
    expect(JSON.parse(escapeJson(JSON.stringify({ a: "</script>" })))).toEqual({ a: "</script>" });
  });
});
