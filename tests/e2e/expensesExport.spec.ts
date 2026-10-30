import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Mes dépenses": the pockets and the money set aside, in the export and in the month's review (demo).

async function withPocketAndGoal(page: Page) {
  await prepare(page);
  // Admin has "expenses".
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/expenses");
  await page.getByRole("button", { name: /Où est ton argent \?/ }).click();
  const setup = page.getByRole("dialog", { name: "Où est ton argent ?" });
  await setup.getByLabel(/^Espèces : combien/).fill("45000");
  await setup.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("pockets-total")).toHaveText(/^45\s000 Ar$/);

  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("pockets-total")).toHaveText(/^40\s000 Ar$/);

  await page.getByRole("button", { name: /Mettre de l’argent de côté/ }).click();
  await page.getByRole("dialog", { name: "Épargne et tontines" }).getByRole("button", { name: "Objectif", exact: true }).click();
  const goal = page.getByRole("dialog", { name: "Objectif d’épargne" });
  await goal.getByLabel("Nom", { exact: true }).fill("Rentrée scolaire");
  await goal.getByLabel("Montant visé").fill("300000");
  await goal.getByRole("button", { name: "Enregistrer" }).click();
  const list = page.getByRole("dialog", { name: "Épargne et tontines" });
  await list.getByRole("button", { name: "Mettre de côté" }).click();
  const deposit = page.getByRole("dialog", { name: "Mettre de côté" });
  await deposit.getByLabel("Montant", { exact: true }).fill("20000");
  await deposit.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("savings-total")).toHaveText(/^20\s000 Ar$/);
  await page.keyboard.press("Escape");
}

test("the month's Excel export has the pockets, the savings and the Pocket column", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "canShare", { value: () => false }); }); // phones open the share sheet for the PDF: force the download
  await withPocketAndGoal(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Excel", exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/^depenses-\d{4}-\d{2}\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Dépenses", "Par catégorie", "Mes poches", "Épargne et tontines"]);
  expect(workbook.getWorksheet("Dépenses")!.getRow(4).values).toContain("Poche");
  const pockets = workbook.getWorksheet("Mes poches")!;
  expect(pockets.getCell("A5").value).toBe("Espèces");
  expect([pockets.getCell("B5").value, pockets.getCell("F5").value]).toEqual([45000, 20000]);
  expect(workbook.getWorksheet("Épargne et tontines")!.getCell("A6").value).toBe("Rentrée scolaire");

  // The PDF too gives a file.
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF", exact: true }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^depenses-\d{4}-\d{2}\.pdf$/);
});

test("the month's review (demo) speaks of the money set aside", async ({ page }) => {
  await withPocketAndGoal(page);
  await page.getByRole("button", { name: "Bilan du mois" }).click();
  const review = page.getByTestId("month-review");
  await expect(review.getByText(/^Tu as dépensé 5\s000 Ar ce mois-ci\.$/)).toBeVisible({ timeout: 15_000 });
  await expect(review.getByText(/^Tu as mis 20\s000 Ar de côté ce mois-ci, bravo\.$/)).toBeVisible();
  await expect(review.getByText(/^Dans tes poches : 45\s000 Ar au début du mois, 20\s000 Ar aujourd'hui\.$/)).toBeVisible();
});
