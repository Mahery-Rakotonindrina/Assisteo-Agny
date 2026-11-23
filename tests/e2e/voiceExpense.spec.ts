import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

async function open(page: Page) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/expenses");
}

test("a sentence fills the add form, and the expense is saved only after confirming", async ({ page }) => {
  await open(page);
  await expect(async () => {
    await page.getByRole("button", { name: "Dire ou écrire" }).click();
    await expect(page.getByRole("textbox", { name: "Dis ta dépense" })).toBeVisible({ timeout: 1500 });
  }).toPass();
  await page.getByRole("textbox", { name: "Dis ta dépense" }).fill("5 000 Ar de taxi-be hier en MVola");
  await page.getByRole("button", { name: "Remplir la dépense" }).click();
  await expect(page.getByLabel("Montant", { exact: true })).toHaveValue("5000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/5\s000 Ar/).first()).toBeVisible();
});

test("a sentence without amount guesses nothing", async ({ page }) => {
  await open(page);
  await expect(async () => {
    await page.getByRole("button", { name: "Dire ou écrire" }).click();
    await expect(page.getByRole("textbox", { name: "Dis ta dépense" })).toBeVisible({ timeout: 1500 });
  }).toPass();
  await page.getByRole("textbox", { name: "Dis ta dépense" }).fill("taxi-be hier");
  await page.getByRole("button", { name: "Remplir la dépense" }).click();
  await expect(page.getByLabel("Montant", { exact: true })).toHaveValue("");
});
