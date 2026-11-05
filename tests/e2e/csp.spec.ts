import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// The site's CSP (next.config.ts) runs no inline script but the one allowed by
// its hash: no main page, nor the offline page, may break a rule of it.

test.describe.configure({ timeout: 120_000 });

const pages = ["/", "/history", "/parcels", "/lists", "/expenses", "/pockets", "/loans", "/plans", "/settings", "/decouvrir", "/aide", "/pret", "/privacy", "/auth-callback", "/offline.html"];

/** Every CSP violation of the page: the browser's event, and its console message. */
async function watchViolations(page: Page) {
  const found: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on("console", (message) => {
    if (/Content Security Policy|CSP violation/i.test(message.text())) found.push(message.text());
  });
  return found;
}

test("CSP: no inline script allowed but the hashed one", async ({ request }) => {
  const response = await request.get("/");
  const policy = response.headers()["content-security-policy"] ?? "";
  const scriptSrc = policy.split(";").find((directive) => directive.trim().startsWith("script-src")) ?? "";
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).toMatch(/'sha256-[A-Za-z0-9+/]{43}='/);
});

test("CSP: the main pages open without a violation", async ({ page }) => {
  await prepare(page);
  const violations = await watchViolations(page);
  for (const path of pages) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(violations, `${path}: ${violations.join(" | ")}`).toEqual([]);
  }
  // The boot script ran (allowed by its hash): it put the kept text size on the
  // page before any other script (the settings may change it afterwards).
  await page.addInitScript(() => {
    localStorage.setItem("text-size", "xlarge");
    const seen = window as unknown as { firstTextSize?: string };
    new MutationObserver(() => {
      seen.firstTextSize ??= document.documentElement.dataset.textSize;
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-text-size"] });
  });
  await page.goto("/");
  expect(await page.evaluate(() => (window as unknown as { firstTextSize?: string }).firstTextSize)).toBe("xlarge");
  expect(violations).toEqual([]);
});

test.describe("with the service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("CSP: the worker registers without a violation", async ({ page }) => {
    await prepare(page);
    const violations = await watchViolations(page);
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 }).catch(() => undefined);
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
  });
});
