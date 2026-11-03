import { expect, type Locator, type Page } from "@playwright/test";
import { prepare, setUpPockets } from "./helpers";

// A phone's keyboard, simulated: Playwright cannot open iOS's keyboard, so
// the page gets the room left above it (420 px tall, like an iPhone with the
// keyboard open). Each field of each window of "Mes dépenses" and "Mes poches"
// is focused in turn: it must be whole on the screen, inside its window, and
// never under the sticky "Enregistrer / Annuler".

const KEYBOARD_HEIGHT = 420;

/** "ok", or what is wrong with the focused field's place. */
function placeOf(field: Element): string {
  const box = field.getBoundingClientRect();
  const viewport = window.visualViewport;
  const top = viewport ? viewport.offsetTop : 0;
  const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  if (box.top < top - 1 || box.bottom > bottom + 1) return `off screen: ${Math.round(box.top)}–${Math.round(box.bottom)} not in ${Math.round(top)}–${Math.round(bottom)}`;
  const dialog = field.closest('[role="dialog"]');
  if (!dialog) return "ok";
  const sheet = dialog.getBoundingClientRect();
  if (box.top < sheet.top - 1 || box.bottom > sheet.bottom + 1) return "outside its window";
  for (const node of dialog.querySelectorAll("*")) {
    if (node.contains(field) || !(field.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const style = getComputedStyle(node);
    if (style.position !== "sticky" || style.bottom === "auto") continue;
    const buttons = node.getBoundingClientRect();
    if (box.bottom > buttons.top + 1) return `under the buttons: field ends at ${Math.round(box.bottom)}, buttons start at ${Math.round(buttons.top)}`;
  }
  return "ok";
}

/** Focuses every typing field of `scope` and checks it is whole and clear of the buttons. */
async function expectFieldsClear(scope: Locator, name: string) {
  const fields = scope.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), textarea, select');
  const count = await fields.count();
  let checked = 0;
  for (let index = 0; index < count; index++) {
    const field = fields.nth(index);
    if (!(await field.isVisible()) || !(await field.isEnabled())) continue;
    await field.focus();
    const label = (await field.getAttribute("aria-label")) ?? (await field.getAttribute("name")) ?? `#${index}`;
    await expect.poll(() => field.evaluate(placeOf), { message: `${name}: ${label}`, timeout: 3_000 }).toBe("ok");
    checked++;
  }
  expect(checked, `${name}: no field`).toBeGreaterThan(0);
}

/** The open window (one at a time), checked then closed. */
async function checkSheet(page: Page, name: string, { close = true } = {}) {
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  await expectFieldsClear(dialog, name);
  if (close) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  return dialog;
}

export async function walkExpenseSheets(page: Page) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  const width = page.viewportSize()?.width ?? 390;
  await page.setViewportSize({ width, height: KEYBOARD_HEIGHT });

  // The first time, in the page: where the money is.
  await page.goto("/pockets");
  const setup = page.getByRole("form", { name: "Où est ton argent ?" });
  await expect(setup.getByLabel(/^Espèces : combien/)).toBeVisible();
  await expectFieldsClear(setup, "first pockets");
  await setUpPockets(page, { cash: "45000", mvola: "230000" });

  // "Mes dépenses": an expense, an income, one of each month, the budget, savings and tontine.
  const welcome = page.getByRole("region", { name: "Bienvenue dans Mes dépenses" });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  await checkSheet(page, "Ajouter une dépense");
  await page.getByRole("radio", { name: "Revenus", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un revenu" }).first().click();
  await checkSheet(page, "Ajouter un revenu");
  await page.getByRole("radio", { name: "Fixes", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter une dépense de chaque mois" }).click();
  await checkSheet(page, "Ajouter une dépense de chaque mois");
  await page.getByRole("radio", { name: "Budget", exact: true }).click();
  await page.getByRole("button", { name: "Fixer mon budget" }).click();
  await checkSheet(page, "Fixer mon budget");
  await page.getByRole("radio", { name: "Mois", exact: true }).click();
  const savings = page.getByRole("button", { name: /Mettre de l’argent de côté/ });
  await savings.click();
  await page.getByRole("dialog", { name: "Épargne et tontines" }).getByRole("button", { name: "Tontine", exact: true }).click();
  await checkSheet(page, "Tontine");
  await savings.click();
  await page.getByRole("dialog", { name: "Épargne et tontines" }).getByRole("button", { name: "Objectif", exact: true }).click();
  const goal = await checkSheet(page, "Objectif d’épargne", { close: false });
  await goal.getByLabel("Nom", { exact: true }).fill("Rentrée scolaire");
  await goal.getByLabel("Montant visé").fill("300000");
  await goal.getByRole("button", { name: "Enregistrer" }).click();
  const list = page.getByRole("dialog", { name: "Épargne et tontines" });
  await list.getByRole("button", { name: "Mettre de côté" }).click();
  await checkSheet(page, "Mettre de côté");

  // "Mes poches": a new pocket, a transfer, then a pocket's correction and edit.
  await page.goto("/pockets");
  await page.getByRole("button", { name: "Ajouter une poche" }).click();
  await checkSheet(page, "Ajouter une poche");
  await page.getByRole("button", { name: "Virement", exact: true }).first().click();
  await checkSheet(page, "Virement entre mes poches");
  await page.getByTestId("pocket-card").filter({ hasText: "MVola" }).click();
  const detail = page.getByTestId("pocket-detail");
  await detail.getByRole("button", { name: "Corriger le solde" }).click();
  await checkSheet(page, "Corriger le solde");
  await detail.getByTestId("pocket-more").click();
  await page.getByRole("dialog", { name: "MVola" }).getByRole("button", { name: /^Modifier/ }).click();
  await checkSheet(page, "Modifier la poche");
}
