import { expect, test, type Page } from "@playwright/test";
import { mockReceipt } from "../../lib/ai/mock";
import { prepare } from "./helpers";

// "Prêts": Admin only while tested. The demo server answers "free": the
// tests that need the screen pretend the account is Admin.

async function asAdmin(page: Page) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
}

/** "+ Nouveau", then "J'ai prêté de l'argent" or "J'ai emprunté de l'argent". */
async function startNew(page: Page, direction: "lent" | "borrowed" = "lent") {
  await page.getByTestId("loans-new").click();
  await page.getByRole("button", { name: direction === "lent" ? /^J’ai prêté de l’argent/ : /^J’ai emprunté de l’argent/ }).click();
}

async function lend(page: Page, person: string, amount: string) {
  await startNew(page);
  await page.getByLabel("À qui ?").fill(person);
  await page.getByLabel("Combien ? (Ar)").fill(amount);
  await page.getByRole("button", { name: "Enregistrer" }).click();
}

/** Opens the (oldest) loan of the statement: its sheet. */
async function openLoan(page: Page) {
  await page.locator('[data-testid="ledger-line"][data-kind="loan"]').last().click();
  return page.getByRole("dialog");
}

test("an Admin account starts from the empty screen, then lends money in 4 taps", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Prêts/ }).first()).toBeVisible();
  await page.goto("/loans");
  await expect(page.getByRole("heading", { level: 1, name: "Prêts" })).toBeVisible();
  await expect(page.getByText("Aucun prêt pour l’instant")).toBeVisible();

  // "Nouveau", "J'ai prêté", the name, the amount, "Enregistrer".
  await startNew(page);
  await page.getByLabel("À qui ?").fill("Rakoto");
  await page.getByLabel("Combien ? (Ar)").fill("50000");
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeInViewport();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/C’est noté : Rakoto te doit 50\s000\sAr\./)).toBeVisible();
  await expect(page.getByTestId("loans-total-lent")).toHaveText(/^50\s000\sAr$/);
  await expect(page.getByTestId("loans-side-lent")).toContainText("1 personne");
  await expect(page.getByRole("button", { name: /Rakoto/ })).toContainText("À jour");
});

test("« Rakoto me doit encore… » adds a sum to the same person, the statement says what is left", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Compte avec Rakoto" })).toBeVisible();

  await page.getByRole("button", { name: "Rakoto me doit encore…" }).click();
  const sheet = page.getByRole("dialog", { name: "Rakoto me doit encore…" });
  await expect(sheet.getByLabel("À qui ?")).toHaveValue("Rakoto");
  await sheet.getByLabel("Combien ? (Ar)").fill("30000");
  await sheet.getByRole("button", { name: "Santé", exact: true }).click();
  await sheet.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByTestId("loan-balance")).toContainText(/Rakoto te doit 80\s000\sAr/);
  await expect(page.getByTestId("ledger-line")).toHaveCount(2);
  await expect(page.getByTestId("ledger-line").first()).toContainText("Santé");
  await expect(page.getByTestId("ledger-left").first()).toContainText(/80\s000\sAr/);
  await expect(page.getByTestId("ledger-left").last()).toContainText(/50\s000\sAr/);
});

test("a partial repayment shows in the statement, then « Marquer comme remboursé » folds the loan away", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();

  await page.getByRole("button", { name: "Rakoto m’a rendu…" }).click();
  // Prefilled with what is left.
  await expect(page.getByLabel("Combien ? (Ar)")).toHaveValue("50000");
  await page.getByLabel("Combien ? (Ar)").fill("20000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loan-balance")).toContainText(/Rakoto te doit 30\s000\sAr/);
  await expect(page.getByTestId("ledger-line").first()).toContainText(/Rakoto m’a rendu.*−20\s000\sAr/);
  await expect(page.getByTestId("ledger-left").first()).toContainText(/30\s000\sAr/);

  const sheet = await openLoan(page);
  await expect(sheet.getByTestId("loan-left")).toHaveText(/^Reste 30\s000\sAr$/);
  await sheet.getByRole("button", { name: "Marquer comme remboursé" }).click();
  await expect(sheet.getByText("Remboursé", { exact: true }).first()).toBeVisible();
  await sheet.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByText("Tout est remboursé").first()).toBeVisible();
  await page.getByRole("button", { name: "Retour à la liste" }).click();
  await expect(page.getByText("Tout est remboursé, des deux côtés.")).toBeVisible();
  await page.getByRole("button", { name: "Remboursés (1)" }).click();
  await expect(page.getByRole("button", { name: /Rakoto/ })).toContainText(/50\s000\sAr/);
});

test("the top card: « On te doit » and « Tu dois » filter the list", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await startNew(page, "borrowed");
  await page.getByLabel("Qui t’a prêté ?").fill("Tante Lalao");
  await page.getByLabel("Combien ? (Ar)").fill("40000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loans-total-lent")).toHaveText(/^50\s000\sAr$/);
  await expect(page.getByTestId("loans-total-borrowed")).toHaveText(/^40\s000\sAr$/);
  await expect(page.getByTestId("loan-person")).toHaveCount(2);

  await page.getByTestId("loans-side-borrowed").click();
  await expect(page.getByRole("button", { name: /Tante Lalao/ })).toContainText("tu dois");
  await expect(page.getByRole("button", { name: /Rakoto/ })).toHaveCount(0);
  await page.getByTestId("loans-side-lent").click();
  await expect(page.getByRole("button", { name: /Tante Lalao/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Rakoto/ })).toBeVisible();
  // Touched again: the whole list.
  await page.getByTestId("loans-side-lent").click();
  await expect(page.getByTestId("loan-person")).toHaveCount(2);
});

test("without the Admin plan, Loans is not in the menu", async ({ page }) => {
  await prepare(page);
  // Once the plan is known (free), the menu is final.
  const plan = page.waitForResponse("**/api/plan");
  await page.goto("/");
  await plan;
  await expect(page.getByRole("link", { name: "Historique" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Prêts/ })).toHaveCount(0);
  await page.goto("/loans");
  await expect(page.getByText("Prêts n’est pas encore ouvert à ton offre.")).toBeVisible();
  await expect(page.getByTestId("loans-new")).toHaveCount(0);
});

test("a loan paid back in 3 times, with a partial repayment", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await startNew(page);
  await page.getByLabel("À qui ?").fill("Rakoto");
  await page.getByLabel("Combien ? (Ar)").fill("60000");
  await page.getByTestId("loan-more").click();
  await page.getByLabel("Rembourser en plusieurs fois").check();
  await page.getByLabel("Combien de fois ?").fill("3");
  await expect(page.getByLabel(/^Montant de l’échéance du/)).toHaveCount(3);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("button", { name: /Rakoto/ })).toContainText("Échéance le");

  await page.getByRole("button", { name: /Rakoto/ }).click();
  await expect(page.getByTestId("loan-balance")).toContainText(/Prochaine échéance : 20\s000\sAr le/);
  await page.getByRole("button", { name: "Rakoto m’a rendu…" }).click();
  await page.getByLabel("Combien ? (Ar)").fill("30000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  const sheet = await openLoan(page);
  const schedule = sheet.getByTestId("loan-schedule");
  await expect(schedule.getByText("Payée")).toHaveCount(1);
  await expect(schedule.getByText("En partie")).toHaveCount(1);
  await expect(schedule.getByText("À venir")).toHaveCount(1);
  await expect(sheet.getByTestId("loan-left")).toHaveText(/^Reste 30\s000\sAr$/);
});

test("a loan with interest: the total to pay back is followed, the interest a line of its own", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await startNew(page);
  await page.getByLabel("À qui ?").fill("Rakoto");
  await page.getByLabel("Combien ? (Ar)").fill("100000");
  await page.getByTestId("loan-more").click();
  await page.getByLabel("Intérêts ou frais convenus").check();
  await page.getByLabel("Intérêts ou frais (Ar)").fill("10000");
  await expect(page.getByTestId("loan-form-total")).toHaveText(/À rendre en tout : 110\s000\sAr/);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loans-total-lent")).toHaveText(/^110\s000\sAr$/);
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await expect(page.getByTestId("ledger-line").filter({ hasText: "Intérêts" })).toContainText(/\+10\s000\sAr/);
  await expect(page.getByTestId("ledger-left").first()).toContainText(/110\s000\sAr/);
  const sheet = await openLoan(page);
  await expect(sheet.getByTestId("loan-interest")).toHaveText(/Prêté 100\s000\sAr · Intérêts 10\s000\sAr · À rendre 110\s000\sAr/);
});

test("« Reconnaissance de dette (PDF) » gives a file", async ({ page }) => {
  await asAdmin(page);
  await page.addInitScript(() => { Object.defineProperty(navigator, "canShare", { value: () => false }); }); // phones open the share sheet: force the download
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await page.getByRole("button", { name: "Reconnaissance de dette", exact: true }).click();
  await page.getByLabel("Ton nom (celui qui prête)").fill("Hery");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Créer le PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/^reconnaissance-de-dette-Rakoto\.pdf$/);
});

test("« Exporter le compte » gives the person's statement as a file", async ({ page }) => {
  await asAdmin(page);
  await page.addInitScript(() => { Object.defineProperty(navigator, "canShare", { value: () => false }); });
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await page.getByRole("button", { name: "Exporter le compte (PDF, Excel)" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Excel" }).click();
  expect((await download).suggestedFilename()).toMatch(/^prets-Rakoto-.*\.xlsx$/);
});

/** Picks the test photo in the file chooser the button opens (the web camera plugin). */
async function pickPhoto(page: Page, button: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button, exact: true }).click();
  await (await chooser).setFiles("tests/e2e/fixtures/apple.jpg");
}

test("a photo joins a loan as proof, then shows in the list and on the card", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await openLoan(page);
  await page.getByRole("button", { name: "Ajouter une preuve" }).click();
  await pickPhoto(page, "Choisir une image");
  await expect(page.getByText("Preuve ajoutée.")).toBeVisible();
  await expect(page.getByTestId("loan-proofs").getByRole("button")).toHaveCount(1);

  await page.getByRole("button", { name: "Voir la preuve 1" }).click();
  await expect(page.getByRole("img", { name: "Preuve", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Supprimer la preuve" }).click();
  await page.getByRole("button", { name: "Oui, supprimer la preuve" }).click();
  await expect(page.getByText("Preuve supprimée.")).toBeVisible();
  await expect(page.getByTestId("loan-proofs")).toHaveCount(0);
});

test("scanning a debt acknowledgment (demo) fills in the form, the photo kept as proof", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await page.getByTestId("loans-new").click();
  await page.getByRole("button", { name: "Scanner une reconnaissance de dette" }).click();
  await pickPhoto(page, "Choisir une image");
  // Signed out, the side can't be told from the account's name: asked.
  await page.getByRole("button", { name: "Rasoa Marie : on me doit" }).click();
  await expect(page.getByLabel("À qui ?")).toHaveValue("Rakoto Jean");
  await expect(page.getByLabel("Combien ? (Ar)")).toHaveValue("150000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loans-total-lent")).toHaveText(/^150\s000\sAr$/);
  await expect(page.getByTestId("loan-has-proofs")).toBeVisible();
  await page.getByRole("button", { name: /Rakoto Jean/ }).click();
  const sheet = await openLoan(page);
  await expect(sheet.getByTestId("loan-proofs").getByRole("button")).toHaveCount(1);
});

// ---- With "Mes poches" (Admin has "expenses" too) ----------------------------

/** Espèces 45 000 Ar (the default pocket) and MVola 230 000 Ar. */
async function withPockets(page: Page) {
  await page.goto("/expenses");
  await page.getByRole("button", { name: /Où est ton argent \?/ }).click();
  const setup = page.getByRole("dialog", { name: "Où est ton argent ?" });
  await setup.getByLabel(/^Espèces : combien/).fill("45000");
  await setup.getByRole("checkbox", { name: "MVola" }).check();
  await setup.getByLabel(/^MVola : combien/).fill("230000");
  await setup.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("pockets")).toHaveText(/^Espèces 45\s000 Ar · MVola 230\s000 Ar$/);
}

test("a loan from MVola lowers the pocket, a repayment brings it back up, « Il te reste » unchanged", async ({ page }) => {
  await asAdmin(page);
  await withPockets(page);
  await page.goto("/loans");
  await startNew(page);
  await page.getByLabel("À qui ?").fill("Rakoto");
  await page.getByLabel("Combien ? (Ar)").fill("50000");
  // The pocket is in "Plus d'options", named on its button.
  await expect(page.getByTestId("loan-more")).toContainText("Espèces");
  await page.getByTestId("loan-more").click();
  await page.getByRole("dialog").getByRole("radio", { name: "MVola" }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loans-total-lent")).toHaveText(/^50\s000\sAr$/);

  await page.getByRole("button", { name: /Rakoto/ }).click();
  await page.getByRole("button", { name: "Rakoto m’a rendu…" }).click();
  await page.getByLabel("Combien ? (Ar)").fill("20000");
  // The loan's pocket by default.
  await expect(page.getByRole("dialog").getByRole("radio", { name: "MVola" })).toBeChecked();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("ledger-line").first()).toContainText("MVola");
  await expect(page.getByTestId("ledger-left").first()).toContainText(/30\s000\sAr/);

  await page.goto("/expenses");
  await expect(page.getByTestId("pockets")).toHaveText(/^Espèces 45\s000 Ar · MVola 200\s000 Ar$/);
  await expect(page.getByTestId("expenses-in")).toHaveText(/^0 Ar$/);
  // In the pocket's history, the line opens the person in "Prêts".
  await page.getByRole("button", { name: "Voir mes poches" }).click();
  await page.getByRole("dialog", { name: "Mes poches" }).getByRole("button", { name: /^MVola/ }).click();
  await expect(page.getByTestId("pocket-loan").first()).toHaveText("Remboursement de Rakoto");
  await page.getByRole("link", { name: "Prêt à Rakoto" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Compte avec Rakoto" })).toBeVisible();
});

test("a « Vous avez reçu » from a debtor (demo): « C’est un remboursement ? », yes — the rest goes down, the income goes", async ({ page, isMobile }) => {
  test.skip(isMobile, "The desktop drop zone exposes a plain file input.");
  await asAdmin(page);
  await page.goto("/loans");
  await lend(page, "Rasoa Hery", "100000");
  await expect(page.getByTestId("loans-total-lent")).toHaveText(/^100\s000\sAr$/);

  // Any photo comes back as the demo "Vous avez reçu" of 80 000 Ar from Rasoa Hery.
  await page.route("**/api/analyze", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), analysis: mockReceipt("fr", "in") } });
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
  await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
  await expect(page.getByTestId("repayment-prompt")).toContainText("C’est un remboursement de Rasoa Hery ?");
  await page.getByRole("button", { name: "Oui, c’est un remboursement" }).click();
  await expect(page.getByTestId("repayment-linked")).toContainText("Compté comme remboursement de Rasoa Hery");

  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-in")).toHaveText(/^0 Ar$/);
  await page.goto("/loans");
  await expect(page.getByTestId("loans-total-lent")).toHaveText(/^20\s000\sAr$/);
});
