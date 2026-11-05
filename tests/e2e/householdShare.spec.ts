import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Lists and parcels shared with the household. A session comes from a played
// e-mail code, the household from a played /api/household; Supabase's
// tables answer nothing (what the other members share is put on the device).

const ME = "00000000-0000-4000-8000-000000000001";
const BEN = "00000000-0000-4000-8000-000000000002";
const household = {
  userId: ME,
  household: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Famille Rabe",
    role: "owner",
    budget: { categories: {} },
    members: [
      { userId: ME, role: "owner", joinedAt: "2026-11-01T00:00:00Z", label: "Anna" },
      { userId: BEN, role: "member", joinedAt: "2026-11-02T00:00:00Z", label: "Ben" },
    ],
    invite: null,
  },
};

/** A build without Supabase has no accounts, so no household. */
async function accountsOn(page: Page) {
  await page.goto("/settings");
  return page
    .getByText("Tu n’es pas connecté")
    .waitFor({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
}

/** Signed in (a played e-mail code), in the household. */
async function signIn(page: Page) {
  const now = Math.floor(Date.now() / 1000);
  const authUser = { id: ME, aud: "authenticated", role: "authenticated", email: "anna@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  await page.route(/\/auth\/v1\/otp/, (route) => route.fulfill({ json: {} }));
  await page.route(/\/auth\/v1\/verify/, (route) =>
    route.fulfill({ json: { access_token: "e2e-access", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "e2e-refresh", user: authUser } }),
  );
  await page.route(/\/auth\/v1\/user/, (route) => route.fulfill({ json: authUser }));
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByPlaceholder(/@/).fill("anna@example.com");
  await sheet.getByRole("button", { name: "Recevoir un code" }).click();
  await sheet.getByRole("textbox", { name: "Entre le code" }).fill("12345678");
  await expect(sheet).toBeHidden({ timeout: 15_000 });
}

async function put(page: Page, database: string, storeName: string, records: Array<{ id: string }>) {
  await page.evaluate(
    async ({ database, storeName, records }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction(storeName, "readwrite");
          for (const record of records) tx.objectStore(storeName).put(record, record.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { database, storeName, records },
  );
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "On a computer, the sidebar has the account.");
  await prepare(page);
  // Supabase's tables: nothing to read, every write accepted.
  await page.route(/supabase\.co\/(rest|storage)\//, (route) => route.fulfill({ status: route.request().method() === "GET" ? 200 : 201, json: [] }));
  await page.route("**/api/household", (route) => route.fulfill({ json: household }));
  test.skip(!(await accountsOn(page)), "Accounts are not configured in this build.");
  await signIn(page);
});

test("a list shared with the household: Ben's ticked here, mine shared then taken back", async ({ page }) => {
  const now = Date.now();
  await put(page, "assisteo-lists", "lists", [{ id: "mine", title: "Courses du samedi", kind: "shopping", items: [{ id: "i1", text: "Riz", done: false }], createdAt: now, updatedAt: now } as { id: string }]);
  await put(page, "assisteo-household-lists", "lists", [
    { id: "list:ben1", title: "Fournitures scolaires", kind: "todo", items: [{ id: "b1", text: "Cahiers", done: false }], createdAt: now, updatedAt: now, householdId: household.household.id, userId: BEN } as { id: string },
  ]);
  await page.goto("/lists");

  // Ben's list: shared by him, ticked by me, not mine to remove.
  const ben = page.locator("article").filter({ hasText: "Fournitures scolaires" });
  await expect(ben.getByTestId("list-shared")).toHaveText("Partagée par Ben");
  await ben.getByRole("button", { name: /Fournitures scolaires/ }).click();
  await ben.getByRole("checkbox", { name: "Cahiers" }).click();
  await expect(ben.getByRole("checkbox", { name: "Cahiers" })).toHaveAttribute("aria-checked", "true");
  await expect(ben.getByRole("button", { name: "Supprimer" })).toHaveCount(0);
  await expect(ben.getByTestId("list-unshare")).toHaveCount(0);

  // Mine: shared, then taken back.
  const mine = page.locator("article").filter({ hasText: "Courses du samedi" });
  await mine.getByRole("button", { name: /Courses du samedi/ }).click();
  await mine.getByTestId("list-share-household").click();
  await expect(page.getByText(/^Liste partagée/)).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Courses du samedi" }).getByTestId("list-shared")).toHaveText("Partagée avec le foyer");
  const shared = page.locator("article").filter({ hasText: "Courses du samedi" });
  await shared.getByRole("button", { name: /Courses du samedi/ }).click();
  await shared.getByTestId("list-unshare").click();
  await expect(page.getByText(/^Partage arrêté/)).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Courses du samedi" }).getByTestId("list-shared")).toHaveCount(0);
});

test("a parcel shared with the household: Ben's read only here, mine shared then stopped", async ({ page }) => {
  const now = Date.now();
  const info = { platform: null, orderNumber: null, trackingNumber: "YT2412345678", carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
  await put(page, "assisteo-parcels", "parcels", [{ id: "dress", title: "Robe rouge", info, scanIds: [], timeline: [], createdAt: now, updatedAt: now, priceMga: 80000 } as { id: string }]);
  await put(page, "assisteo-household-parcels", "parcels", [
    { id: "parcel:ben1", sourceId: "ben1", title: "Chaussures de Ben", info: { ...info, status: "pickup_ready" }, timeline: [], createdAt: now, sourceUpdatedAt: now, updatedAt: now, householdId: household.household.id, userId: BEN } as { id: string },
  ]);
  await page.goto("/parcels");

  const fromHousehold = page.getByTestId("household-parcels");
  await expect(fromHousehold.getByRole("heading", { name: "Partagés par ton foyer" })).toBeVisible();
  const ben = fromHousehold.getByTestId("household-parcel");
  await expect(ben).toContainText("Chaussures de Ben");
  await expect(ben).toContainText("À retirer");
  await expect(ben).toContainText("Partagé par Ben");
  await expect(ben.getByRole("button")).toHaveCount(0);

  const dress = page.locator("article").filter({ hasText: "Robe rouge" });
  await dress.getByRole("button", { name: /Robe rouge/ }).click();
  await dress.getByTestId("parcel-share-household").click();
  await expect(page.getByText("Colis partagé avec le foyer, sans ses prix")).toBeVisible();
  await dress.getByTestId("parcel-unshare").click();
  await expect(page.getByText("Partage du colis arrêté")).toBeVisible();
  await expect(dress.getByTestId("parcel-share-household")).toBeVisible();
});
