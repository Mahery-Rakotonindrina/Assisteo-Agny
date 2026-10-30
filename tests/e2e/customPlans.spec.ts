import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// A plan created from the Admin (Admin → Offers → "Créer une offre"). The
// tests share one server: the save is answered here, and the plan reaches
// the offers page and Discover through a mock of /api/plan.

const TOKEN = "e2e-admin-token-0123456789";

const famille = {
  id: "famille",
  name: { fr: "Famille", en: "Family" },
  color: "teal",
  after: "lite",
  features: ["garage"],
  onSale: true,
  createdAt: 1,
  priceMga: 8000,
  yearPriceMga: 80000,
  scans: 150,
  questionsPerDay: 20,
  parcels: 30,
  deepPerMonth: 0,
};

test("the admin creates « Famille » between Lite and Premium, shown at its rank and on Discover", async ({ page }) => {
  await prepare(page);
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/admin/custom-plans", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { customPlans: [famille] } });
  });

  await page.goto("/admin");
  await page.locator("#admin-token").fill(TOKEN);
  await page.getByRole("button", { name: "Déverrouiller" }).click();
  await page.getByTestId("custom-plan-create").click();
  await page.getByTestId("custom-plan-name-fr").fill("Famille");
  await page.getByTestId("custom-plan-name-en").fill("Family");
  await expect(page.getByTestId("custom-plan-id")).toHaveValue("famille");
  await page.getByTestId("custom-plan-after").selectOption("lite");
  await page.getByTestId("custom-plan-priceMga").fill("8000");
  await page.getByRole("checkbox", { name: "Mon garage", exact: true }).check();
  await page.getByTestId("custom-plan-save").click();
  await expect(page.getByText("Offre enregistrée")).toBeVisible();
  expect(sent).toMatchObject({ id: "famille", after: "lite", priceMga: 8000, features: ["garage"], name: { fr: "Famille", en: "Family" } });

  // The app asks for the created plans: the server adds them to the offers and the labels.
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const { id, priceMga, yearPriceMga, scans, questionsPerDay, parcels, deepPerMonth, name, color, features } = famille;
    await route.fulfill({
      response,
      json: {
        ...json,
        offers: [...json.offers, { id, priceMga, yearPriceMga, scans, questionsPerDay, parcels, deepPerMonth, features, name, color, rank: 1.5 }],
        featureFrom: { ...json.featureFrom, garage: "famille" },
      },
    });
  });
  await page.goto("/plans");
  const offers = page.locator("article[data-plan]");
  await expect(offers).toHaveCount(4);
  await expect(offers.nth(1)).toHaveAttribute("data-plan", "famille");
  await expect(offers.nth(1)).toHaveAttribute("data-plan-color", "teal");
  await expect(offers.nth(1).getByRole("heading", { name: "Famille" })).toBeVisible();
  await expect(offers.nth(1)).toContainText("8 000 Ar");
  await expect(offers.nth(2)).toHaveAttribute("data-plan", "premium");

  await page.goto("/decouvrir");
  const garage = page.locator('li[data-feature="garage"]');
  await expect(garage).toContainText("À partir de");
  await expect(garage.locator('[data-plan="famille"]')).toHaveText("Famille");
});
