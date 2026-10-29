import { expect, test, type Page } from "@playwright/test";
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

async function lend(page: Page, person: string, amount: string) {
  await page.getByRole("button", { name: "J’ai prêté de l’argent" }).click();
  await page.getByLabel("À qui ?").fill(person);
  await page.getByLabel("Montant (Ar)").fill(amount);
  await page.getByRole("button", { name: "Enregistrer" }).click();
}

test("an Admin account starts from the empty screen, then lends money", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Prêts/ }).first()).toBeVisible();
  await page.goto("/loans");
  await expect(page.getByRole("heading", { level: 1, name: "Prêts" })).toBeVisible();
  await expect(page.getByText("Personne ne te doit d’argent")).toBeVisible();

  await lend(page, "Rakoto", "50000");
  await expect(page.getByText(/C’est noté : Rakoto te doit 50\s000\sAr\./)).toBeVisible();
  await expect(page.getByTestId("loans-total")).toHaveText(/^50\s000\sAr$/);
  await expect(page.getByTestId("loans-summary")).toContainText("1 personne");
  await expect(page.getByRole("button", { name: /Rakoto/ })).toContainText("1 prêt en cours");
});

test("a partial repayment, then « Marquer comme remboursé » folds the loan away", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Rakoto" })).toBeVisible();

  await page.getByRole("button", { name: "On m’a rendu…" }).click();
  // Prefilled with what is left.
  await expect(page.getByLabel("Montant (Ar)")).toHaveValue("50000");
  await page.getByLabel("Montant (Ar)").fill("20000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loan-left")).toHaveText(/^Reste 30\s000\sAr$/);

  await page.getByRole("button", { name: "Marquer comme remboursé" }).click();
  await expect(page.getByText("Tout est remboursé").first()).toBeVisible();
  await page.getByRole("button", { name: "Retour à la liste" }).click();
  await expect(page.getByText("Tout le monde t’a remboursé.")).toBeVisible();
  await page.getByRole("button", { name: "Remboursés (1)" }).click();
  await expect(page.getByRole("button", { name: /Rakoto/ })).toContainText(/50\s000\sAr/);
});

test("« Je dois » keeps the borrowed money apart", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("radio", { name: "Je dois" }).click();
  await expect(page.getByText("Tu ne dois rien à personne")).toBeVisible();
  await page.getByRole("button", { name: "J’ai emprunté" }).click();
  await page.getByLabel("Qui t’a prêté ?").fill("Tante Lalao");
  await page.getByLabel("Montant (Ar)").fill("40000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loans-summary")).toContainText("Tu dois en tout");
  await expect(page.getByTestId("loans-total")).toHaveText(/^40\s000\sAr$/);
  await expect(page.getByRole("button", { name: /Rakoto/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "On me doit" }).click();
  await expect(page.getByTestId("loans-total")).toHaveText(/^50\s000\sAr$/);
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
  await expect(page.getByRole("button", { name: "J’ai prêté de l’argent" })).toHaveCount(0);
});

test("a loan paid back in 3 times, with a partial repayment", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await page.getByRole("button", { name: "J’ai prêté de l’argent" }).click();
  await page.getByLabel("À qui ?").fill("Rakoto");
  await page.getByLabel("Montant (Ar)").fill("60000");
  await page.getByLabel("Rembourser en plusieurs fois").check();
  await page.getByLabel("Combien de fois ?").fill("3");
  await expect(page.getByLabel(/^Montant de l’échéance du/)).toHaveCount(3);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("button", { name: /Rakoto/ })).toContainText(/Prochaine échéance : 20\s000\sAr le/);

  await page.getByRole("button", { name: /Rakoto/ }).click();
  await page.getByRole("button", { name: "On m’a rendu…" }).click();
  await page.getByLabel("Montant (Ar)").fill("30000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  const schedule = page.getByTestId("loan-schedule");
  await expect(schedule.getByText("Payée")).toHaveCount(1);
  await expect(schedule.getByText("En partie")).toHaveCount(1);
  await expect(schedule.getByText("À venir")).toHaveCount(1);
  await expect(page.getByTestId("loan-left")).toHaveText(/^Reste 30\s000\sAr$/);
});

test("a loan with interest: the total to pay back is followed", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await page.getByRole("button", { name: "J’ai prêté de l’argent" }).click();
  await page.getByLabel("À qui ?").fill("Rakoto");
  await page.getByLabel("Montant (Ar)").fill("100000");
  await page.getByLabel("Intérêts ou frais convenus").check();
  await page.getByLabel("Intérêts ou frais (Ar)").fill("10000");
  await expect(page.getByTestId("loan-form-total")).toHaveText(/À rendre en tout : 110\s000\sAr/);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loans-total")).toHaveText(/^110\s000\sAr$/);
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await expect(page.getByTestId("loan-interest")).toHaveText(/Prêté 100\s000\sAr · Intérêts 10\s000\sAr · À rendre 110\s000\sAr/);
});

test("« Reconnaissance de dette (PDF) » gives a file", async ({ page }) => {
  await asAdmin(page);
  await page.addInitScript(() => { Object.defineProperty(navigator, "canShare", { value: () => false }); }); // phones open the share sheet: force the download
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await page.getByRole("button", { name: "Reconnaissance de dette (PDF)" }).click();
  await page.getByLabel("Ton nom (celui qui prête)").fill("Hery");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Créer le PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/^reconnaissance-de-dette-Rakoto\.pdf$/);
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
  await page.getByRole("button", { name: "Ajouter une preuve" }).click();
  await pickPhoto(page, "Choisir une image");
  await expect(page.getByText("Preuve ajoutée.")).toBeVisible();
  await expect(page.getByTestId("loan-proofs").getByRole("button")).toHaveCount(1);

  await page.getByRole("button", { name: "Voir la preuve 1" }).click();
  await expect(page.getByRole("img", { name: "Preuve" })).toBeVisible();
  await page.getByRole("button", { name: "Supprimer la preuve" }).click();
  await page.getByRole("button", { name: "Oui, supprimer la preuve" }).click();
  await expect(page.getByText("Preuve supprimée.")).toBeVisible();
  await expect(page.getByTestId("loan-proofs")).toHaveCount(0);
});

test("scanning a debt acknowledgment (demo) fills in the form, the photo kept as proof", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await page.getByRole("button", { name: "J’ai prêté de l’argent" }).click();
  await page.getByRole("button", { name: "Scanner une reconnaissance de dette" }).click();
  await pickPhoto(page, "Choisir une image");
  // Signed out, the side can't be told from the account's name: asked.
  await page.getByRole("button", { name: "Rasoa Marie : on me doit" }).click();
  await expect(page.getByLabel("À qui ?")).toHaveValue("Rakoto Jean");
  await expect(page.getByLabel("Montant (Ar)")).toHaveValue("150000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loans-total")).toHaveText(/^150\s000\sAr$/);
  await expect(page.getByTestId("loan-has-proofs")).toBeVisible();
  await page.getByRole("button", { name: /Rakoto Jean/ }).click();
  await expect(page.getByTestId("loan-proofs").getByRole("button")).toHaveCount(1);
});
