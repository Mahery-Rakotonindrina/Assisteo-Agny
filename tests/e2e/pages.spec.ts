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
