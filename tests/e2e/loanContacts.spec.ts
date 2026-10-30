import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Choisir dans mes contacts" in "Prêts": the browser's Contact Picker
// (Chrome on Android) simulated; desktop Chromium has none, so the button
// stays hidden there.

async function asAdmin(page: Page) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
}

/** `navigator.contacts.select` answering one contact. */
async function withContact(page: Page, name: string, tel: string) {
  await page.addInitScript(
    ([contactName, contactTel]) => {
      Object.defineProperty(navigator, "contacts", { configurable: true, value: { select: async () => [{ name: [contactName], tel: [contactTel] }] } });
    },
    [name, tel],
  );
}

async function lend(page: Page, person: string, amount: string) {
  await page.getByTestId("loans-new").click();
  await page.getByRole("button", { name: /^J’ai prêté de l’argent/ }).click();
  await page.getByLabel("À qui ?").fill(person);
  await page.getByLabel("Combien ? (Ar)").fill(amount);
  await page.getByRole("button", { name: "Enregistrer" }).click();
}

test("a contact picked fills the name and number, and the loan goes on the person already known", async ({ page }) => {
  await asAdmin(page);
  await withContact(page, " rakoto ", "+261 34 12 345 67");
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");

  await page.getByTestId("loans-new").click();
  await page.getByRole("button", { name: /^J’ai prêté de l’argent/ }).click();
  await page.getByRole("button", { name: "Choisir dans mes contacts" }).click();
  await expect(page.getByLabel("À qui ?")).toHaveValue("Rakoto");
  await expect(page.getByLabel("Téléphone (facultatif)")).toHaveValue("034 12 345 67");
  await page.getByLabel("Combien ? (Ar)").fill("30000");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByTestId("loans-side-lent")).toContainText("1 personne");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await expect(page.getByTestId("loan-balance")).toContainText(/Rakoto te doit 80\s000\sAr/);
  await expect(page.getByText("034 12 345 67")).toBeVisible();
  // A number known: no "add their number" any more.
  await expect(page.getByTestId("loan-contact-phone")).toHaveCount(0);
});

test("« Ajouter son numéro depuis mes contacts » gives the person a number for the reminder", async ({ page }) => {
  await asAdmin(page);
  await withContact(page, "Rasoa", "0331234567");
  await page.goto("/loans");
  await lend(page, "Rasoa", "20000");
  await page.getByRole("button", { name: /Rasoa/ }).click();
  await expect(page.getByTestId("loan-remind")).toContainText("copier");

  await page.getByRole("button", { name: "Ajouter son numéro depuis mes contacts" }).click();
  await expect(page.getByText("033 12 345 67")).toBeVisible();
  await expect(page.getByTestId("loan-remind")).toHaveText("Relancer");
  await expect(page.getByTestId("loan-contact-phone")).toHaveCount(0);
});

test("without a contact picker, the button isn't there", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/loans");
  await page.getByTestId("loans-new").click();
  await page.getByRole("button", { name: /^J’ai prêté de l’argent/ }).click();
  await expect(page.getByLabel("À qui ?")).toBeVisible();
  await expect(page.getByTestId("loan-contact")).toHaveCount(0);
});
