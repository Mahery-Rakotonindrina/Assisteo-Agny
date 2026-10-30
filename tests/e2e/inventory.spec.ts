import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Ma maison": Premium and up. The demo server answers "free": the tests that
// need the screen pretend the account is Premium (the built-in ladder).

async function asPlan(page: Page, plan: "free" | "premium") {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined, featureFrom: undefined } });
  });
}

test("below Premium, Ma maison is locked and says from which plan", async ({ page }) => {
  await asPlan(page, "free");
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { level: 1, name: "Ma maison" })).toBeVisible();
  await expect(page.getByText("Ma maison est inclus à partir de Premium.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un objet" })).toHaveCount(0);
});

test("a Premium account adds a thing with its warranty, sees the total and the pill", async ({ page }) => {
  await asPlan(page, "premium");
  await page.goto("/inventory");
  await expect(page.getByText("Ta maison est vide")).toBeVisible();

  await page.getByRole("button", { name: "Ajouter un objet" }).click();
  const form = page.getByTestId("inventory-form");
  await form.getByLabel("Nom").fill("Frigo Samsung");
  await form.getByLabel("Pièce").selectOption("kitchen");
  await form.getByLabel("Prix (Ar)").fill("1 850 000");
  await form.getByLabel("Magasin").fill("Jumbo Score");
  const nextYear = new Date().getFullYear() + 1;
  await form.getByLabel("Garantie jusqu’au").fill(`${nextYear}-03-12`);
  // The fields stay at 16 px at least: iOS Safari would zoom in otherwise.
  expect(await form.getByLabel("Nom").evaluate((input) => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
  await form.getByRole("button", { name: "Ajouter", exact: true }).click();

  // The detail opens: the pill, the facts, no paper yet.
  const detail = page.getByTestId("inventory-detail");
  await expect(detail.getByRole("heading", { level: 2, name: "Frigo Samsung" })).toBeVisible();
  await expect(detail.getByText("Sous garantie")).toBeVisible();
  await expect(detail.getByText("Jumbo Score")).toBeVisible();
  await expect(detail.getByText(/Aucun papier lié/)).toBeVisible();

  // Back to the list: by room, with the total value and the export.
  await detail.getByRole("button", { name: "Ma maison" }).click();
  await expect(page.getByTestId("inventory-totals")).toContainText(/1\s850\s000\sAr/);
  await expect(page.getByRole("heading", { level: 2, name: /Cuisine/ })).toBeVisible();
  await expect(page.getByTestId("inventory-export-pdf")).toBeVisible();
  await expect(page.getByTestId("inventory-export-xlsx")).toBeVisible();
});

test("an ended warranty shows « Garantie finie », and the thing can be deleted", async ({ page }) => {
  await asPlan(page, "premium");
  await page.goto("/inventory?new=1");
  const form = page.getByTestId("inventory-form");
  await form.getByLabel("Nom").fill("Vieille télé");
  await form.getByLabel("Garantie jusqu’au").fill("2020-01-01");
  await form.getByRole("button", { name: "Ajouter", exact: true }).click();
  const detail = page.getByTestId("inventory-detail");
  await expect(detail.getByText("Garantie finie")).toBeVisible();
  await detail.getByRole("button", { name: "Supprimer" }).click();
  await detail.getByRole("button", { name: "Oui, supprimer cet objet" }).click();
  await expect(page.getByText("Ta maison est vide")).toBeVisible();
});
