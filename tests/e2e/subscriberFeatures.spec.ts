import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Features set subscriber by subscriber (Admin → Subscriptions, an account's
// card). The demo server has no accounts: the admin API of the subscriptions,
// the accounts and the card is answered here, nothing is saved.

const TOKEN = "e2e-admin-token-0123456789";
const DAY = 24 * 3600 * 1000;

async function openAdmin(page: Page) {
  await prepare(page);
  await page.goto("/admin");
  await page.locator("#admin-token").fill(TOKEN);
  await page.getByRole("button", { name: "Déverrouiller" }).click();
}

test("adding a subscriber with a feature unticked sends it as their own", async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/admin/subscriptions", async (route) => {
    if (route.request().method() === "POST") {
      sent = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { subscriptions: [] } });
    }
    return route.fulfill({ json: { subscriptions: [] } });
  });
  await openAdmin(page);
  await page.getByRole("button", { name: "Ajouter un abonnement" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByPlaceholder("rado@example.com").fill("rado@example.com");
  await sheet.getByRole("button", { name: "Premium" }).click();

  // The plan's features are ticked, its limits filled in.
  const own = sheet.getByRole("group", { name: "Fonctionnalités et quotas" });
  await expect(own.getByRole("checkbox", { name: "Mon garage" })).toBeChecked();
  await expect(own.getByRole("checkbox", { name: "Outils revendeur" })).not.toBeChecked();
  await expect(sheet.getByLabel("Scans / mois")).toHaveValue("300");

  await own.getByRole("checkbox", { name: "Mon garage" }).uncheck();
  await expect(own.getByText("à la main")).toBeVisible();
  await sheet.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(() => sent).not.toBeNull();
  expect(sent).toMatchObject({ plan: "premium", emails: ["rado@example.com"], features: { add: [], remove: ["garage"] } });
  expect(sent).not.toHaveProperty("quotas");
});

test("offering a feature for 7 days to a free account shows it on the card", async ({ page }) => {
  const now = Date.now();
  const grants: Array<Record<string, unknown>> = [];
  const card = () => ({
    email: "free@example.com",
    plan: "free",
    endsAt: null,
    subscriptionId: null,
    features: [
      grants.length
        ? { feature: "garage", kind: "grant", on: true, endsAt: grants[0].endsAt }
        : { feature: "garage", kind: "notInPlan", on: false },
      { feature: "reminders", kind: "notInPlan", on: false },
    ],
    quotas: [
      { key: "scans", value: 10, own: false },
      { key: "deepPerMonth", value: 0, own: false },
    ],
    grants,
    ready: { own: true, grants: true },
  });
  await page.route("**/api/admin/accounts", (route) =>
    route.fulfill({ json: { accounts: [{ id: "u1", email: "free@example.com", createdAt: new Date(now - 30 * DAY).toISOString(), lastSignInAt: null, providers: ["email"], plan: "free", planEndsAt: null }] } }),
  );
  let offered: Record<string, unknown> | null = null;
  await page.route((url) => url.pathname === "/api/admin/account", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: card() });
    offered = route.request().postDataJSON();
    grants.push({ id: "8d0a3f8e-5f8b-4b8e-9a51-7b0d7c5e2a10", email: "free@example.com", feature: "garage", startsAt: new Date().toISOString(), endsAt: offered!.endsAt, note: offered!.note, createdBy: "owner", createdAt: new Date().toISOString() });
    await route.fulfill({ status: 201, json: grants[0] });
  });

  await openAdmin(page);
  await page.getByRole("button", { name: "Fiche · free@example.com" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Pas dans l’offre Gratuit").first()).toBeVisible();

  await sheet.getByLabel("La fonction").selectOption("garage");
  await sheet.getByRole("button", { name: "7 jours" }).click();
  await sheet.getByLabel("Note").fill("Essai demandé");
  await sheet.getByRole("button", { name: "Offrir", exact: true }).click();

  await expect.poll(() => offered).not.toBeNull();
  expect(offered).toMatchObject({ email: "free@example.com", feature: "garage", note: "Essai demandé" });
  const end = Date.parse(String(offered!.endsAt));
  expect(Math.abs(end - (Date.now() + 7 * DAY))).toBeLessThan(5 * 60 * 1000);

  // The card now says until when, and lists the offer with "Stop now".
  const line = sheet.getByRole("list", { name: "Ses fonctions" }).locator('[data-feature="garage"]');
  await expect(line).toContainText("Offert jusqu’au");
  await expect(sheet.getByRole("button", { name: "Arrêter maintenant" })).toBeVisible();
});
