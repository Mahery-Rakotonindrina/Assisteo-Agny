import { expect, test } from "@playwright/test";
import { mockAnalysis } from "../../lib/ai/mock";
import { prepare } from "./helpers";

// Selling an object: the demo server writes the sample ad (lib/ai/objectAdDemo.ts).

test.describe("selling an object", () => {
  test.skip(({ isMobile }) => isMobile, "The desktop drop zone exposes a plain file input.");

  test("writes the ad of a scanned object, keeps it with the scan, and copies it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await prepare(page);
    // Any photo comes back as an object, already a little worn.
    await page.route("**/api/analyze", async (route) => {
      const response = await route.fetch();
      const analysis = { ...mockAnalysis("object", "fr"), category: "object", title: "Ventilateur Sonashi", summary: "Un ventilateur sur pied, avec quelques rayures.", reminder: null };
      await route.fulfill({ response, json: { ...(await response.json()), analysis } });
    });
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });

    await page.getByRole("button", { name: "Je veux le vendre" }).click();
    const sheet = page.getByRole("dialog", { name: "Vendre cet objet" });
    // The condition is proposed from the analysis (scratches: worn), and can be changed.
    await expect(sheet.getByRole("radio", { name: "Usé" })).toHaveAttribute("aria-checked", "true");
    await sheet.getByRole("radio", { name: "Bon", exact: true }).click();
    await sheet.getByLabel("Lieu (ville), facultatif").fill("Antsirabe");
    await sheet.getByRole("button", { name: "Écrire l’annonce" }).click();

    await expect(sheet.getByText("Annonce d’exemple (mode démo).")).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText(/110\s000 Ar/)).toBeVisible();
    await expect(sheet.getByLabel("Texte de l’annonce")).toHaveValue(/Antsirabe/);
    await sheet.getByRole("button", { name: "Copier" }).click();
    await expect(page.getByText("Annonce copiée.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("#occasion");

    // Kept with the scan: back on the result after a reload.
    await sheet.getByRole("button", { name: "Fermer" }).click();
    await page.reload();
    await expect(page.getByText(/Annonce prête : Ventilateur Sonashi à vendre/)).toBeVisible();
    await page.getByRole("button", { name: "Voir l’annonce" }).click();
    await expect(page.getByRole("dialog", { name: "Vendre cet objet" }).getByLabel("Texte de l’annonce")).toHaveValue(/Antsirabe/);
  });
});
