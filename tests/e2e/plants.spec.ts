import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// "Mes plantes" in demo mode: the demo "object" scan is a Monstera with its
// watering (lib/ai/mock.ts), the diagnosis a sample (lib/ai/plantDiagnosisDemo.ts).

/** The demo server answers "free": pretend the account has `plan`. */
async function pretendPlan(page: import("@playwright/test").Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined, featureFrom: undefined } });
  });
}

test("a free account sees My plants with the Lite label", async ({ page }) => {
  await prepare(page);
  await page.goto("/plants");
  await expect(page.getByRole("heading", { level: 1, name: "Mes plantes" })).toBeVisible();
  await expect(page.getByText("Mes plantes est inclus à partir de Lite.")).toBeVisible();
});

test.describe("with Lite", () => {
  test.skip(({ isMobile }) => isMobile, "The desktop drop zone exposes a plain file input.");

  test("adds a scanned plant, waters it, and finds it watered", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "lite");
    await page.goto("/?mode=object");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });

    await page.getByRole("button", { name: "Ajouter à mes plantes" }).click();
    await expect(page).toHaveURL(/\/plants\?open=/);
    await expect(page.getByRole("heading", { level: 2, name: "Monstera deliciosa" })).toBeVisible();
    // Never watered: to water today, then watered.
    await expect(page.getByText("À arroser aujourd’hui")).toBeVisible();
    await page.getByRole("button", { name: "Arrosée aujourd’hui" }).click();
    await expect(page.getByRole("button", { name: "Arrosée aujourd’hui" })).toBeDisabled();

    await page.getByRole("button", { name: "Mes plantes" }).click();
    // Watered today: the list says so (pages/plants.tsx), not "À arroser dans N jours".
    await expect(page.getByRole("button", { name: /Monstera deliciosa Arrosée aujourd’hui/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "À arroser aujourd’hui" })).toHaveCount(0);
  });

  test("adds a plant by hand, listed first while it is to water", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "lite");
    await page.goto("/plants");
    await page.getByRole("button", { name: "Ajouter une plante" }).click();
    await page.getByLabel("Nom").fill("Basilic");
    await page.getByLabel("Arroser tous les (jours)").fill("2");
    await page.getByRole("button", { name: "Ajouter une plante" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Basilic" })).toBeVisible();
    await page.getByRole("button", { name: "Mes plantes" }).click();
    await expect(page.getByRole("heading", { name: "À arroser aujourd’hui" })).toBeVisible();
    await page.getByRole("button", { name: "Basilic arrosée aujourd’hui" }).click();
    await expect(page.getByRole("heading", { name: "À arroser aujourd’hui" })).toHaveCount(0);
  });
});
