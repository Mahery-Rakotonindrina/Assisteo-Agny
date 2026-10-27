import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

test("settings link to the privacy policy and the terms", async ({ page }) => {
  await prepare(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: "Politique de confidentialité" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeVisible();
  await page.getByRole("link", { name: "Conditions d’utilisation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Conditions d’utilisation" })).toBeVisible();
});

test("the chosen text size applies to the whole app and is kept", async ({ page }) => {
  await prepare(page);
  await page.goto("/settings");
  const root = page.locator("html");
  const sizes = page.getByRole("radiogroup", { name: "Taille du texte" });
  // A click before the page is interactive does nothing: try again until it takes.
  await expect(async () => {
    await sizes.getByRole("radio", { name: "Très grand" }).click();
    await expect(root).toHaveAttribute("data-text-size", "xlarge", { timeout: 1000 });
  }).toPass();
  // Applied before the first paint on the next start, and never dropped while the app starts.
  await page.addInitScript(() => {
    new MutationObserver((records) => {
      if (records.some((record) => record.oldValue && !document.documentElement.dataset.textSize)) Object.assign(window, { textSizeDropped: true });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-size"], attributeOldValue: true });
  });
  await page.goto("/");
  await expect(root).toHaveAttribute("data-text-size", "xlarge");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("20px");
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => "textSizeDropped" in window)).toBe(false);
  await page.goto("/settings");
  await expect(async () => {
    await sizes.getByRole("radio", { name: "Normal" }).click();
    await expect(root).not.toHaveAttribute("data-text-size", { timeout: 1000 });
  }).toPass();
});

test("the onboarding never covers the legal pages", async ({ page }) => {
  await prepare(page, { onboardingDone: false });
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeVisible();
  await expect(page.getByText("Bienvenue")).toHaveCount(0);
});

test("the admin page asks for the token", async ({ page }) => {
  await prepare(page);
  await page.goto("/admin");
  await expect(page.locator("#admin-token")).toBeVisible();
});

test("new users can open example results before their first scan", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Un repas" }).click();
  await expect(page).toHaveURL(/\/result\?example=food/);
  await expect(page.getByText("Exemple d’analyse")).toBeVisible();
  // Read-only: no question tab, and the call to action leads to the scanner.
  await expect(page.getByRole("tab", { name: "Question" })).toHaveCount(0);
  await page.getByRole("link", { name: "Faire mon premier scan" }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test("the scanned photo opens full screen and closes with Escape or back", async ({ page }) => {
  await prepare(page);
  await page.goto("/result?example=food");
  await page.getByRole("button", { name: "Agrandir la photo" }).click();
  const viewer = page.getByRole("dialog", { name: "Bol de salade composée" });
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/photo=1/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(/\/result\?example=food$/);

  await page.getByRole("button", { name: "Agrandir la photo" }).click();
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(/\/result\?example=food$/);
});

test("the discover page shows its title and opens a question", async ({ page }) => {
  await prepare(page);
  await page.goto("/decouvrir");
  await expect(page.getByRole("heading", { level: 1, name: /L’IA qui t’explique/ })).toBeVisible();
  const question = page.getByText("Faut-il créer un compte ?");
  await expect(async () => {
    await question.click();
    await expect(page.locator("details[open]").filter({ hasText: "Faut-il créer un compte ?" })).toHaveCount(1);
  }).toPass();
});

test("a newcomer finds the discover page from the home screen", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  // Under the intro on a computer, under the examples on a phone: only one shows.
  const link = page.getByRole("link", { name: "Découvrir tout ce que fait l’app" });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/decouvrir$/);
});
