import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Ma boutique" (Pro): Admin sees every feature, so the tests pretend the
// account is Admin (as loans.spec.ts does); the demo server answers "free".

async function asAdmin(page: Page) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
}

test("without the Pro plan, the screen shows the lock and no sale form", async ({ page }) => {
  await prepare(page);
  await page.goto("/boutique");
  await expect(page.getByRole("heading", { level: 1, name: "Ma boutique" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir les offres" })).toBeVisible();
  await expect(page.getByTestId("sale-new")).toHaveCount(0);
});

test("a shopkeeper adds a product, sells it, sells on credit, collects, and sees the totals", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/boutique");

  // Stock: a product with its alert at 3.
  await page.getByRole("radio", { name: "Stock" }).click();
  await page.getByTestId("product-new").click();
  await page.getByTestId("product-name").fill("Riz 5 kg");
  await page.getByTestId("product-stock").fill("5");
  await page.getByTestId("product-price").fill("18000");
  await page.getByTestId("product-save").click();
  await expect(page.getByTestId("product-line")).toContainText("Riz 5 kg");

  // A sale paid in full: 2 × 18 000, the stock goes down to 3 (the alert shows).
  await page.getByRole("radio", { name: "Ventes" }).click();
  await page.getByTestId("sale-new").click();
  await page.getByTestId("sale-product").selectOption({ label: "Riz 5 kg (5)" });
  await expect(page.getByTestId("sale-price")).toHaveValue("18000");
  await page.getByTestId("sale-qty").fill("2");
  await expect(page.getByTestId("sale-total")).toContainText(/36\s000/);
  await page.getByTestId("sale-save").click();
  await expect(page.getByTestId("sale-line")).toHaveCount(1);
  await expect(page.getByTestId("day-sold")).toHaveText(/^36\s000 Ar$/);
  await expect(page.getByTestId("low-stock")).toContainText("Riz 5 kg (3)");

  // A sale on credit needs a customer.
  await page.getByTestId("sale-new").click();
  await page.getByTestId("sale-name").fill("Huile");
  await page.getByTestId("sale-qty").fill("1");
  await page.getByTestId("sale-price").fill("10000");
  await page.getByTestId("sale-mode").selectOption("credit");
  await page.getByTestId("sale-paid").fill("4000");
  await page.getByTestId("sale-customer").fill("Rado");
  await page.getByTestId("sale-save").click();
  await expect(page.getByTestId("sale-line")).toHaveCount(2);
  await expect(page.getByTestId("day-sold")).toHaveText(/^46\s000 Ar$/);
  await expect(page.getByTestId("total-owed")).toHaveText(/^6\s000 Ar$/);

  // Credit: Rado owes 6 000; he pays 2 000.
  await page.getByRole("radio", { name: "Crédit" }).click();
  await expect(page.getByTestId("debt-line")).toContainText("Rado");
  await expect(page.getByTestId("debt-amount")).toHaveText(/^6\s000 Ar$/);
  await expect(page.getByTestId("debt-line").getByTestId("debt-remind")).toBeVisible();
  await page.getByTestId("debt-pay").click();
  await page.getByTestId("payment-amount").fill("2000");
  await page.getByTestId("payment-save").click();
  await expect(page.getByTestId("debt-amount")).toHaveText(/^4\s000 Ar$/);
  // No margin anywhere on the screen.
  await expect(page.getByText(/marge|bénéfice/i)).toHaveCount(0);
});

test("the shop can be erased from Settings, and is in the copy of the data", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/boutique");
  await page.getByTestId("sale-new").click();
  await page.getByTestId("sale-name").fill("Savon");
  await page.getByTestId("sale-price").fill("1500");
  await page.getByTestId("sale-save").click();
  await expect(page.getByTestId("sale-line")).toHaveCount(1);

  await page.goto("/settings");
  const row = page.locator('[data-testid="reset-row"][data-screen="shop"]');
  await row.click();
  await page.getByTestId("reset-confirm").click();
  await page.goto("/boutique");
  await expect(page.getByTestId("sale-line")).toHaveCount(0);
});
