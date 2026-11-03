import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Remettre à zéro" in Réglages: each screen emptied on its own, the others
// left as they were. The demo server answers "free": the account is
// pretended Admin (it has "Mes dépenses" and "Prêts").

// Several pages each (seeding, Réglages, then the screens checked): more than the default 30 s on a busy machine.
test.describe.configure({ timeout: 90_000 });

async function asAdmin(page: Page) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
}

type Seed = { expenses?: object[]; loans?: object[]; parcels?: object[] };

/** Writes records straight into the app's stores (IndexedDB, one store per database, keyed by id). */
async function seed(page: Page, { expenses = [], loans = [], parcels = [] }: Seed) {
  await page.evaluate(
    async (data) => {
      const put = (name: string, store: string, records: Array<{ id: string }>) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onupgradeneeded = () => request.result.createObjectStore(store);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const tx = request.result.transaction(store, "readwrite");
            for (const record of records) tx.objectStore(store).put(record, record.id);
            tx.oncomplete = () => {
              request.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      await put("assisteo-expenses", "expenses", data.expenses as Array<{ id: string }>);
      await put("assisteo-loans", "loans", data.loans as Array<{ id: string }>);
      await put("assisteo-parcels", "parcels", data.parcels as Array<{ id: string }>);
    },
    { expenses, loans, parcels },
  );
}

/** The kinds of the records left in "Mes dépenses" (tombstones apart). */
const expenseKinds = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("assisteo-expenses");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction("expenses").objectStore("expenses").getAll();
          all.onsuccess = () => {
            request.result.close();
            resolve((all.result as Array<{ kind: string; deletedAt?: number }>).filter((record) => !record.deletedAt).map((record) => record.kind).sort());
          };
        };
      }),
  );

const now = Date.now();
const base = { createdAt: now - 3_600_000, updatedAt: now - 3_600_000 };
const info = { platform: null, orderNumber: null, trackingNumber: null, carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
// Bought an hour ago: a computed expense line of 40 000 Ar in "Mes dépenses".
const parcel = { ...base, id: "bag", title: "Sac à dos", info, scanIds: [], timeline: [], fees: [], priceMga: 40000 };
const pocket = { ...base, kind: "wallet", id: "cash", name: "Espèces", type: "cash", startMga: 50000, startAt: now - 86_400_000, primary: true };
const expense = { ...base, kind: "expense", id: "e1", at: now - 1_800_000, amountMga: 12500, category: "market", wallet: "cash" };
const income = { ...base, kind: "income", id: "i1", at: now - 1_800_000, amountMga: 100000, income: "salary" };
const category = { ...base, kind: "category", id: "c1", name: "Église", color: "#2e9e5b", icon: "church" };
const loan = { ...base, id: "l1", direction: "lent", person: "Rakoto", amountMga: 50000, at: now - 86_400_000, repayments: [] };

/** Réglages → the screen's line → its window. */
async function openReset(page: Page, screen: string) {
  await page.goto("/settings");
  await page.locator(`[data-testid="reset-row"][data-screen="${screen}"]`).click();
  const window = page.getByTestId("reset-window");
  await expect(window).toBeVisible();
  return window;
}

test("Dépenses et revenus: emptied, the scanned lines gone too, the pockets, categories and parcels kept", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/");
  await seed(page, { expenses: [pocket, expense, income, category], parcels: [parcel] });
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-total")).toHaveText(/^52\s500 Ar$/);

  const window = await openReset(page, "expenses");
  await expect(window.getByText("1 dépense", { exact: true })).toBeVisible();
  await expect(window.getByText("1 revenu", { exact: true })).toBeVisible();
  await expect(window.getByText(/^Tes poches : leur solde est recalculé/)).toBeVisible();
  await expect(window.getByRole("link", { name: "Exporter d’abord" })).toHaveAttribute("href", /\/expenses\?tab=month/);
  // Cancelled: nothing moves.
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(window).toBeHidden();
  expect(await expenseKinds(page)).toEqual(["category", "expense", "income", "wallet"]);

  await openReset(page, "expenses");
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByText("Dépenses et revenus effacés")).toBeVisible();
  expect(await expenseKinds(page)).toEqual(["category", "reset", "wallet"]);
  await expect(page.locator('[data-testid="reset-row"][data-screen="expenses"]')).toBeDisabled();

  // The parcel bought before the reset no longer counts; the parcel itself stays.
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-total")).toHaveText(/^0 Ar$/);
  await page.goto("/parcels");
  await expect(page.getByText("Sac à dos").first()).toBeVisible();
});

test("Dépenses with only lines from elsewhere (a parcel's price): the line can be used, and they leave", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/");
  await seed(page, { parcels: [parcel] });
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-total")).toHaveText(/^40\s000 Ar$/);
  const window = await openReset(page, "expenses");
  await expect(window.getByText(/^1 ligne venue de tes reçus, factures, colis ou véhicules/)).toBeVisible();
  await page.getByTestId("reset-confirm").click();
  await expect(page.locator('[data-testid="reset-row"][data-screen="expenses"]')).toBeDisabled();
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-total")).toHaveText(/^0 Ar$/);
});

test("Poches: the pockets gone, the expenses kept without a pocket", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/");
  await seed(page, { expenses: [pocket, expense, { ...base, kind: "transfer", id: "t1", from: "cash", to: "cash2", at: now - 1_000_000, amountMga: 5000 }] });
  const window = await openReset(page, "pockets");
  await expect(window.getByText("1 poche", { exact: true })).toBeVisible();
  await expect(window.getByText("1 virement ou correction", { exact: true })).toBeVisible();
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByText("Poches effacées")).toBeVisible();
  expect(await expenseKinds(page)).toEqual(["expense"]);
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-total")).toHaveText(/^12\s500 Ar$/);
});

test("Prêts: every loan gone, the parcels and expenses kept", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/");
  await seed(page, { expenses: [expense], loans: [loan, { ...loan, id: "l2", person: "Be", direction: "borrowed" }], parcels: [parcel] });
  await page.goto("/loans");
  await expect(page.getByRole("button", { name: /Rakoto/ })).toBeVisible();

  const window = await openReset(page, "loans");
  await expect(window.getByText("2 prêts", { exact: true })).toBeVisible();
  await expect(window.getByText("Les liens de partage envoyés sont arrêtés")).toBeVisible();
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByText("Prêts effacés")).toBeVisible();

  await page.goto("/loans");
  await expect(page.getByText("Aucun prêt pour l’instant")).toBeVisible();
  expect(await expenseKinds(page)).toEqual(["expense"]);
  await page.goto("/parcels");
  await expect(page.getByText("Sac à dos").first()).toBeVisible();
});

test("Colis: every parcel gone, the loans and expenses kept; a free account sees only its screens", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await seed(page, { parcels: [parcel, { ...parcel, id: "shoes", title: "Chaussures" }] });
  await page.goto("/settings");
  // Free: no "Mes dépenses" nor "Prêts", and nothing kept from them.
  await expect(page.locator('[data-testid="reset-row"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="reset-row"][data-screen="history"]')).toBeDisabled();

  const window = await openReset(page, "parcels");
  await expect(window.getByText("2 colis suivis", { exact: true })).toBeVisible();
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByText("Colis effacés")).toBeVisible();
  await page.goto("/parcels");
  await expect(page.getByText("Aucun colis suivi")).toBeVisible();
});

test("the window fits a 320 px phone in very large text", async ({ page }) => {
  await asAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.settings.v1", JSON.stringify({ locale: "fr", theme: "dark", textSize: "xlarge", onboardingDone: true, updatedAt: 0 }));
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await seed(page, { expenses: [pocket, expense, income] });
  await page.goto("/settings");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect(page.locator('[data-testid="reset-row"][data-screen="expenses"]')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  const window = await openReset(page, "expenses");
  const confirm = page.getByTestId("reset-confirm");
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const box = (await window.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(320);
});
