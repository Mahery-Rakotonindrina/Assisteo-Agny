import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Prêts", shared: the link sent to a borrower, and the household's loans.
// The demo server has no accounts nor tables: its answers are played here, as
// pages/api/loans/share.ts and pages/api/household.ts would give them.

const userId = "11111111-1111-4111-8111-111111111111";
const token = "AAAAAAAAAAAAAAAAAAAAAA";

async function asAdmin(page: Page) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
}

/** The share route: `ready` false before migration 0012. Returns what the app sent. */
async function shareServer(page: Page, { ready = true, household = false } = {}) {
  const sent: Array<{ action: string; snapshot?: unknown }> = [];
  let snapshot: unknown = null;
  let live = false;
  await page.route("**/api/loans/share**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      if (!live || !snapshot) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "This link is not active." } } });
      return route.fulfill({ json: { snapshot, updatedAt: new Date().toISOString() } });
    }
    const body = request.postDataJSON() as { action: string; snapshot?: unknown };
    sent.push(body);
    if (body.action === "status") return route.fulfill({ json: { ready, household, shares: live ? [{ person: "rakoto", lender: "Anna" }] : [] } });
    if (body.action === "create") {
      snapshot = body.snapshot;
      live = true;
      return route.fulfill({ json: { token } });
    }
    if (body.action === "update") snapshot = body.snapshot;
    if (body.action === "revoke") live = false;
    return route.fulfill({ json: { ok: true, found: true } });
  });
  return sent;
}

async function lend(page: Page, person: string, amount: string, phone?: string) {
  await page.getByTestId("loans-new").click();
  await page.getByRole("button", { name: /^J’ai prêté de l’argent/ }).click();
  await page.getByLabel("À qui ?").fill(person);
  await page.getByLabel("Combien ? (Ar)").fill(amount);
  if (phone) {
    await page.getByTestId("loan-more").click();
    await page.getByLabel(/Téléphone/).fill(phone);
  }
  await page.getByRole("button", { name: "Enregistrer" }).click();
}

test("a lender shares what is left, and the borrower opens it without an account", async ({ page }) => {
  await asAdmin(page);
  const sent = await shareServer(page);
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000", "034 12 345 67");
  await page.getByRole("button", { name: /Rakoto/ }).click();

  await page.getByRole("button", { name: "Partager ce qu’il reste à rendre" }).click();
  await page.getByLabel("Ton nom, tel qu’il s’affichera").fill("Anna");
  await page.getByRole("button", { name: "Créer le lien" }).click();
  await expect(page.getByText(/Lien actif : Rakoto voit/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copier le lien" })).toBeVisible();
  // Nothing personal leaves the device.
  const created = sent.find((body) => body.action === "create");
  expect(JSON.stringify(created?.snapshot)).not.toMatch(/034|note|phone/);

  await page.goto(`/pret?t=${token}`);
  await expect(page.getByRole("heading", { level: 1, name: "Ce qu’il reste à rendre" })).toBeVisible();
  await expect(page.getByText("Anna t’a prêté de l’argent. Voici où tu en es, Rakoto.")).toBeVisible();
  await expect(page.getByTestId("shared-loan-left")).toHaveText(/^50\s000\sAr$/);
  await expect(page.getByText("034 12 345 67")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Découvrir l’app" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
});

test("« Arrêter le partage »: the link says it is no longer active", async ({ page }) => {
  await asAdmin(page);
  const sent = await shareServer(page);
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await page.getByRole("button", { name: "Partager ce qu’il reste à rendre" }).click();
  await page.getByLabel("Ton nom, tel qu’il s’affichera").fill("Anna");
  await page.getByRole("button", { name: "Créer le lien" }).click();
  await page.getByTestId("loan-share-stop").click();
  await expect(page.getByText("Partage arrêté : le lien ne marche plus.")).toBeVisible();
  expect(sent.some((body) => body.action === "revoke")).toBe(true);

  await page.goto(`/pret?t=${token}`);
  await expect(page.getByTestId("shared-loan-gone")).toContainText("Ce lien n’est plus actif");
  // A link cut short asks nothing.
  await page.goto("/pret?t=abc");
  await expect(page.getByTestId("shared-loan-missing")).toBeVisible();
});

test("before migration 0012, sharing says it is coming soon", async ({ page }) => {
  await asAdmin(page);
  await shareServer(page, { ready: false });
  await page.goto("/loans");
  await lend(page, "Rakoto", "50000");
  await page.getByRole("button", { name: /Rakoto/ }).click();
  await expect(page.getByTestId("loan-share-soon")).toHaveText("Le lien à partager arrive bientôt.");
});

test("a household member writes a loan of the household, with its author shown", async ({ page }) => {
  await asAdmin(page);
  await shareServer(page, { household: true });
  const members = [
    { userId, role: "owner", joinedAt: new Date().toISOString(), label: "Anna" },
    { userId: "22222222-2222-4222-8222-222222222222", role: "member", joinedAt: new Date().toISOString(), label: "Ben" },
  ];
  await page.route("**/api/household", (route) => route.fulfill({ json: { userId, household: { id: "h1", name: "Famille Rabe", role: "owner", budget: { categories: {} }, members, invite: null } } }));
  await page.goto("/loans");
  await page.getByTestId("loans-household").click();
  await expect(page.getByTestId("loans-household")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("loans-household-hint")).toContainText("vus par tous ses membres");

  await page.getByTestId("loans-new").click();
  await page.getByRole("button", { name: /^J’ai prêté de l’argent/ }).click();
  await page.getByTestId("loan-more").click();
  await expect(page.getByTestId("loan-household")).toBeChecked();
  await page.getByLabel("À qui ?").fill("Voisin Be");
  await page.getByLabel("Combien ? (Ar)").fill("60000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("loans-total-lent")).toHaveText(/^60\s000\sAr$/);
  await page.getByRole("button", { name: /Voisin Be/ }).click();
  await expect(page.getByTestId("ledger-line").first()).toContainText("Noté par Anna");
  await page.locator('[data-testid="ledger-line"][data-kind="loan"]').click();
  await expect(page.getByTestId("loan-author")).toHaveText("Noté par Anna");
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();

  // The personal side doesn't have it.
  await page.getByRole("button", { name: "Retour à la liste" }).click();
  await page.getByTestId("loans-household").click();
  await expect(page.getByTestId("loans-household")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /Voisin Be/ })).toHaveCount(0);
});
