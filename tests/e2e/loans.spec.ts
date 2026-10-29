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
