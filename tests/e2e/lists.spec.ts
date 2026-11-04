import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// Customers' request: editing a line of a list on a phone, the text field was
// a few pixels wide (the quantity, the price and the buttons beside it).

test("editing a line of a shopping list on a phone: the text field takes the card's width", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The phone's layout.");
  await page.setViewportSize({ width: 375, height: 740 });
  await prepare(page);
  await page.goto("/lists");
  await page.getByRole("button", { name: "Nouvelle liste" }).click();
  await page.getByRole("textbox", { name: "Nom de la liste" }).fill("Courses du samedi");
  await page.getByRole("group", { name: "Type de liste" }).getByRole("button", { name: "Courses" }).click();
  await page.getByRole("button", { name: "Créer" }).click();

  const card = page.locator("article").filter({ hasText: "Courses du samedi" });
  const summary = card.locator("button[aria-expanded]").first();
  if ((await summary.getAttribute("aria-expanded")) === "false") await summary.click();
  await card.getByRole("textbox", { name: "Ajouter un élément" }).fill("Riz de Marovoay");
  await card.getByRole("button", { name: "Ajouter l’élément" }).click();
  await card.getByRole("button", { name: "Modifier « Riz de Marovoay »" }).click();

  const field = card.getByRole("textbox", { name: "Élément", exact: true });
  await expect(field).toHaveValue("Riz de Marovoay");
  const [fieldBox, cardBox] = [(await field.boundingBox())!, (await card.boundingBox())!];
  expect(fieldBox.width, "the text field is wide enough to read").toBeGreaterThan(cardBox.width * 0.6);
  // The quantity, the price and the save button are still there, below it.
  await expect(card.getByRole("textbox", { name: "Quantité", exact: true }).first()).toBeVisible();
  await expect(card.getByRole("textbox", { name: "Prix (Ar)" }).first()).toBeVisible();
  await expect(card.getByRole("button", { name: "Enregistrer" })).toBeVisible();
});
