import { expect, test } from "@playwright/test";
import { mockReceipt } from "../../lib/ai/mock";
import { prepare } from "./helpers";

/** The demo server answers "free": pretend the account has `plan`. */
async function pretendPlan(page: import("@playwright/test").Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
}

/** Any photo comes back as the demo MVola receipt (money paid, or received). */
async function serveReceipt(page: import("@playwright/test").Page, direction: "out" | "in" | "own" = "out") {
  await page.route("**/api/analyze", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), analysis: mockReceipt("fr", direction) } });
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

  test("a scanned MVola receipt counts on its own in an Admin's expenses, once", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    await serveReceipt(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });

    await expect(page.getByTestId("receipt-status")).toContainText("Compté dans Mes dépenses");
    await expect(page.getByRole("button", { name: "Ajouter à mes dépenses" })).toHaveCount(0);
    // Corrected by hand: the typed-in expense stands for it.
    await page.getByRole("button", { name: "Corriger" }).click();
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

  test("a scanned withdrawal moves the money from MVola to cash in My pockets, its fees spent once", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    // Dated today: a pocket counts what happens after its starting balance.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await page.route("**/api/analyze", async (route) => {
      const response = await route.fetch();
      const analysis = mockReceipt("fr", "own");
      analysis.document!.receipt!.date = today;
      await route.fulfill({ response, json: { ...(await response.json()), analysis } });
    });
    await page.goto("/expenses");
    await page.getByRole("button", { name: /Où est ton argent \?/ }).click();
    const setup = page.getByRole("dialog", { name: "Où est ton argent ?" });
    await setup.getByLabel(/^Espèces : combien/).fill("10000");
    await setup.getByRole("checkbox", { name: "MVola" }).check();
    await setup.getByLabel(/^MVola : combien/).fill("300000");
    await setup.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByTestId("pockets")).toHaveText(/^Espèces 10\s000 Ar · MVola 300\s000 Ar$/);

    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
    await page.goto("/expenses");
    // 200 000 Ar moved, 2 600 Ar of fees from MVola: spent once, never the withdrawal itself.
    await expect(page.getByTestId("pockets")).toHaveText(/^Espèces 210\s000 Ar · MVola 97\s400 Ar$/);
    await expect(page.getByTestId("pockets-total")).toHaveText(/^307\s400 Ar$/);
    await expect(page.getByTestId("expenses-total")).toHaveText(/^2\s600 Ar$/);
  });

  test("a withdrawal is not an expense: only its fees count, until it is called an expense", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    await serveReceipt(page, "own");
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/,{ timeout: 20_000 });
    await expect(page.getByTestId("receipt-status")).toContainText("pas compté dans tes dépenses");
    await expect(page.getByText(/Frais comptés dans tes dépenses : 2\s600 Ar/)).toBeVisible();
    const result = page.url();
    await page.getByRole("button", { name: "C’est une dépense" }).click();
    await expect(page.getByTestId("receipt-status")).toContainText("Compté dans Mes dépenses");
    await page.goto("/expenses");
    await expect(page.getByTestId("expenses-total")).toHaveText(/^202\s600 Ar$/);
    await expect(page.getByText("Frais de retrait ou de transfert")).toHaveCount(0);
    await page.goto(result);
    await page.getByRole("button", { name: "C’est un mouvement entre mes comptes" }).click();
    await page.goto("/expenses");
    await expect(page.getByTestId("expenses-total")).toHaveText(/^2\s600 Ar$/);
    await expect(page.getByText("Frais de retrait ou de transfert")).toBeVisible();
  });

  async function scanTwice(page: import("@playwright/test").Page, direction: "out" | "in", dates: [string, string] | null) {
    let n = 0;
    await page.route("**/api/analyze", async (route) => {
      const response = await route.fetch();
      const analysis = mockReceipt("fr", direction);
      if (dates) {
        const receipt = analysis.document!.receipt!;
        receipt.reference = null;
        receipt.date = dates[n++ % 2];
      }
      await route.fulfill({ response, json: { ...(await response.json()), analysis } });
    });
    for (let i = 0; i < 2; i++) {
      await page.goto("/");
      await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
      await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
      await expect(page.getByTestId("receipt-status")).toBeVisible();
    }
  }

  test("the same receipt scanned twice (same reference) counts once", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    await scanTwice(page, "out", null);
    await expect(page.getByTestId("receipt-status")).toContainText("Déjà compté (scanné une première fois)");
    await page.goto("/expenses");
    await expect(page.getByTestId("expenses-total")).toHaveText(/^15\s000 Ar$/);
  });

  test("two receipts without a reference, 3 days apart: only the newer one is in doubt", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    await scanTwice(page, "out", ["2026-10-20", "2026-10-22"]);
    await expect(page.getByTestId("receipt-status")).toContainText("déjà compté");
    await page.goto("/expenses");
    await expect(page.getByTestId("expenses-total")).toHaveText(/^15\s000 Ar$/);
    await page.goBack();
    await page.getByRole("button", { name: "Compter quand même" }).click();
    await page.goto("/expenses");
    await expect(page.getByTestId("expenses-total")).toHaveText(/^30\s000 Ar$/);
  });

  test("a received money without a reference, 3 days apart: in doubt in Revenus, counted anyway on demand", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    await scanTwice(page, "in", ["2026-10-20", "2026-10-22"]);
    await page.goto("/expenses?tab=income");
    await expect(page.getByTestId("expenses-in")).toHaveText(/^80\s000 Ar$/);
    await page.getByRole("button", { name: /déjà compté/ }).click();
    await page.getByRole("button", { name: "Compter quand même" }).click();
    await expect(page.getByTestId("expenses-in")).toHaveText(/^160\s000 Ar$/);
  });

  test("a received money scanned twice counts once", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    await scanTwice(page, "in", null);
    await expect(page.getByTestId("receipt-status")).toContainText("Déjà compté");
    await page.goto("/expenses");
    await expect(page.getByTestId("expenses-in")).toHaveText(/^80\s000 Ar$/);
  });

  test("Mobile Money received counts as income", async ({ page }) => {
    await prepare(page);
    await pretendPlan(page, "unlimited");
    await serveReceipt(page, "in");
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
    await expect(page.getByTestId("receipt-status")).toContainText("Compté dans tes revenus");
    await page.getByTestId("receipt-status").getByRole("link", { name: "Voir" }).click();
    await expect(page).toHaveURL(/\/expenses/);
    await expect(page.getByTestId("expenses-in")).toHaveText(/^80\s000 Ar$/);
    await expect(page.getByText("Reçu de Rasoa Hery")).toBeVisible();
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
