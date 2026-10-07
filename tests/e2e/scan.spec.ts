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
    await expect(page.getByRole("heading", { name: /Une question/ })).toBeVisible();

    await page.goto("/history");
    await expect(page.locator('a[href*="/result?id="]')).toHaveCount(1);
  });

  test("answers a follow-up question about the scan (demo answer)", async ({ page }) => {
    await prepare(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });

    await page.getByPlaceholder(/question/i).fill("Ça se garde combien de temps ?");
    await page.getByRole("button", { name: /envoyer/i }).click();
    await expect(page.getByText(/mode démo/)).toBeVisible({ timeout: 15_000 });
  });
});
