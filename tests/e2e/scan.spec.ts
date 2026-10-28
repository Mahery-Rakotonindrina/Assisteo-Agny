import { expect, test } from "@playwright/test";
import { mockReceipt } from "../../lib/ai/mock";
import { prepare } from "./helpers";

/** The demo server answers "free": pretend the account has `plan`. */
async function pretendPlan(page: import("@playwright/test").Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan } });
  });
}

/** Any photo comes back as the demo MVola receipt. */
async function serveReceipt(page: import("@playwright/test").Page) {
  await page.route("**/api/analyze", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), analysis: mockReceipt("fr") } });
  });
}

test.describe("scan", () => {
  test.skip(({ isMobile }) => isMobile, "The desktop drop zone exposes a plain file input.");

  test("analyses an imported photo, shows the result and keeps it in history", async ({ page }) => {
    await prepare(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");

    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    // The analysis is split into tabs, starting on the summary.
    await expect(page.getByRole("tab", { name: "Résumé" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Question" }).click();
    await expect(page.getByRole("heading", { name: /Une question/ })).toBeVisible();

    await page.goto("/history");
    await expect(page.locator('a[href*="/result?id="]')).toHaveCount(1);
  });

  test("answers a follow-up question about the scan (demo answer)", async ({ page }) => {
    await prepare(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });

    // "Ask a question" opens the question tab with the composer focused.
    await page.getByRole("button", { name: "Poser une question" }).first().click();
    await expect(page.getByPlaceholder(/question/i)).toBeFocused();
    await page.getByPlaceholder(/question/i).fill("Ça se garde combien de temps ?");
    await page.getByRole("button", { name: /envoyer/i }).click();
    // The demo answer (the page also shows a "mode démo" note).
    await expect(page.getByText(/Je suis en mode démo/)).toBeVisible({ timeout: 15_000 });
  });

  test("collects a thumbs-down with a reason", async ({ page }) => {
    await prepare(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });

    await page.getByRole("button", { name: "Non" }).click();
    await page.getByRole("button", { name: "Ce n’est pas le bon sujet" }).click();
    await expect(page.getByText(/Merci ! Ton avis/)).toBeVisible();
    // Remembered on the scan.
    await page.reload();
    await expect(page.getByText(/Merci ! Ton avis/)).toBeVisible();
  });

  test("an Admin adds a scanned MVola receipt to their expenses, once", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    await serveReceipt(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });

    await page.getByRole("button", { name: "Ajouter à mes dépenses" }).click();
    await expect(page.getByLabel("Montant", { exact: true })).toHaveValue("15000");
    await expect(page.getByLabel("Note", { exact: true })).toHaveValue("Taxi Be Express");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    // The same transaction is not offered again: open the one saved instead.
    await expect(page.getByText(/Déjà dans tes dépenses/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ajouter à mes dépenses" })).toHaveCount(0);
    await page.getByRole("link", { name: "Ouvrir" }).click();
    await expect(page).toHaveURL(/\/expenses/);
    await expect(page.getByLabel("Montant", { exact: true })).toHaveValue("15000");
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(page.getByTestId("expenses-total")).toHaveText(/^15\s000 Ar$/);
  });

  test("without the Admin plan, a scanned receipt has no expenses button", async ({ page }) => {
    await prepare(page);
    await serveReceipt(page);
    const plan = page.waitForResponse("**/api/plan");
    await page.goto("/");
    await plan;
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("MVola");
    await expect(page.getByRole("button", { name: "Ajouter à mes dépenses" })).toHaveCount(0);
  });
});
