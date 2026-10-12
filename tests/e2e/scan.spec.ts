import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

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
});
