import { describe, expect, it } from "vitest";
import { bootScript, scriptHash } from "@/lib/bootScript";

// The CSP allows the page's one inline script by its hash (next.config.ts).

describe("boot script hash", () => {
  it("is the CSP source of the script's exact text", () => {
    // The value a browser reports in its CSP error for <script>alert(1)</script>.
    expect(scriptHash("alert(1)")).toBe("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='");
  });

  it("changes with the script, so an edit can never run under an old hash", () => {
    expect(scriptHash(bootScript)).not.toBe(scriptHash(`${bootScript};`));
    expect(scriptHash(bootScript)).toMatch(/^'sha256-[A-Za-z0-9+/]{43}='$/);
  });
});
