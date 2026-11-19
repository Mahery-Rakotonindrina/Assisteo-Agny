import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Malagasy: a plan feature. Admin sees it, the free plan does not, a stored "mg"
// falls back to French without the feature; no raw keys or {placeholders} on screen.

test.describe.configure({ timeout: 120_000 });

const rawKey = /\b(?:meta|nav|scan|errors|result|history|settings|common|sidebar|home|health|agenda|search|expenses|shortcuts|pages|plans)\.[a-zA-Z]+(?:\.[a-zA-Z]+)*\b/;
const placeholder = /\{[a-zA-Z]+\}/;

async function start(page: Page, plan: string, opts: { locale?: string; textSize?: string; features?: string[] } = {}) {
  await prepare(page);
  await page.addInitScript(
    ([locale, textSize]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("CapacitorStorage.settings.v1", JSON.stringify({ locale, theme: "dark", textSize, onboardingDone: true, updatedAt: 0 }));
    },
    [opts.locale ?? "fr", opts.textSize ?? "normal"],
  );
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: opts.features } });
  });
}

async function clean(page: Page, label: string) {
  await expect(async () => {
    const text = await page.locator("body").innerText();
    expect(text.match(rawKey)?.[0], `${label}: raw key`).toBeUndefined();
    expect(text.match(placeholder)?.[0], `${label}: placeholder`).toBeUndefined();
  }).toPass({ timeout: 8_000 });
}

test("admin switches to Malagasy and back", async ({ page }) => {
  await start(page, "unlimited");
  await page.goto("/settings");
  await expect(async () => {
    await page.getByText("Malagasy", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "mg", { timeout: 1500 });
  }).toPass();
  await clean(page, "settings");
  for (const path of ["/", "/sante", "/agenda", "/recherche", "/expenses"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveAttribute("lang", "mg");
    await clean(page, path);
  }
  // scan result
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
  await expect(page).toHaveURL(/\/result\?id=/, { timeout: 30_000 });
  await expect(page.getByRole("heading").first()).toBeVisible();
  await clean(page, "result");
  // back to French
  await page.goto("/settings");
  await expect(async () => {
    await page.getByText("Français", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr", { timeout: 1500 });
  }).toPass();
  await clean(page, "settings fr");
});

test("free plan does not see Malagasy", async ({ page }) => {
  await start(page, "free");
  await page.goto("/settings");
  await expect(page.getByText("English", { exact: true })).toBeVisible();
  await expect(page.getByText("Malagasy", { exact: true })).toHaveCount(0);
});

test("a stored mg falls back to French without the feature", async ({ page }) => {
  await start(page, "free", { locale: "mg" });
  await page.goto("/settings");
  await expect(page.getByText("English", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});
