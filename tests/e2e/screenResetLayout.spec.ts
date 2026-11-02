import { expect, test, type Page } from "@playwright/test";
import { mockReceipt } from "@/lib/ai/mock";
import { prepare } from "./helpers";

// "Remettre à zéro": the layout at 320, 375 and 1280 px, in normal and "Très
// grand" text (no overflow, buttons of 44 px at least), and a scanned receipt
// that leaves Dépenses but stays in the history.

test.describe.configure({ timeout: 120_000 });

async function asAdmin(page: Page, textSize: "normal" | "xlarge") {
  await prepare(page);
  await page.addInitScript((size) => {
    localStorage.setItem("CapacitorStorage.settings.v1", JSON.stringify({ locale: "fr", theme: "dark", textSize: size, onboardingDone: true, updatedAt: 0 }));
  }, textSize);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
}

/** Writes records straight into a store of the app (IndexedDB, keyed by id). */
async function seed(page: Page, name: string, store: string, records: object[]) {
  await page.evaluate(
    async ({ name, store, records }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => request.result.createObjectStore(store);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction(store, "readwrite");
          for (const record of records as Array<{ id: string }>) tx.objectStore(store).put(record, record.id);
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { name, store, records },
  );
}

const count = (page: Page, name: string, store: string) =>
  page.evaluate(
    ({ name, store }) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => {
            request.result.close();
            resolve((all.result as Array<{ deletedAt?: number }>).filter((record) => !record.deletedAt).length);
          };
        };
      }),
    { name, store },
  );

const now = Date.now();
const base = { createdAt: now - 3_600_000, updatedAt: now - 3_600_000 };
const info = { platform: null, orderNumber: null, trackingNumber: null, carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
const parcel = { ...base, id: "bag", title: "Sac à dos", info, scanIds: [], timeline: [], fees: [], priceMga: 40000 };
const pocket = { ...base, kind: "wallet", id: "cash", name: "Espèces", type: "cash", startMga: 50000, startAt: now - 86_400_000, primary: true };
const expense = { ...base, kind: "expense", id: "e1", at: now - 1_800_000, amountMga: 12500, category: "market", wallet: "cash" };
const income = { ...base, kind: "income", id: "i1", at: now - 1_800_000, amountMga: 100000, income: "salary" };
const loan = { ...base, id: "l1", direction: "lent", person: "Rakoto", amountMga: 50000, at: now - 86_400_000, repayments: [] };

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const textSize of ["normal", "xlarge"] as const) {
  for (const width of [320, 375, 1280]) {
    test(`the reset section and its windows fit ${width} px, ${textSize} text`, async ({ page }) => {
      await asAdmin(page, textSize);
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 700 });
      await page.goto("/");
      await seed(page, "assisteo-expenses", "expenses", [pocket, expense, income]);
      await seed(page, "assisteo-loans", "loans", [loan]);
      await seed(page, "assisteo-parcels", "parcels", [parcel]);
      await page.goto("/settings");
      const rows = page.getByTestId("reset-row");
      await expect(rows.first()).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      for (const row of await rows.all()) {
        await row.scrollIntoViewIfNeeded();
        const box = (await row.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      for (const screen of ["expenses", "pockets", "loans", "parcels"]) {
        const row = page.locator(`[data-testid="reset-row"][data-screen="${screen}"]`);
        await row.scrollIntoViewIfNeeded();
        await row.click();
        const window = page.getByTestId("reset-window");
        await expect(window).toBeVisible();
        const box = (await window.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        for (const button of [page.getByTestId("reset-confirm"), window.getByRole("button", { name: "Annuler" })]) {
          await button.scrollIntoViewIfNeeded();
          await expect(button).toBeInViewport();
          const size = (await button.boundingBox())!;
          expect(size.height).toBeGreaterThanOrEqual(44);
          expect(size.x + size.width).toBeLessThanOrEqual(width);
        }
        await window.getByRole("button", { name: "Annuler" }).click();
        await expect(window).toBeHidden();
      }
    });
  }
}

test("a receipt scanned before the reset leaves Dépenses and stays in the history", async ({ page }) => {
  await asAdmin(page, "normal");
  await page.goto("/");
  const analysis = mockReceipt("fr", "out");
  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    id: "scan1",
    createdAt: now - 3_600_000,
    mode: "auto",
    thumbnail: "data:image/jpeg;base64,/9j/4AAQ",
    preview: "",
    analysis: { ...analysis, document: { ...analysis.document!, receipt: { ...analysis.document!.receipt!, date: today, total: 15000, currency: "MGA", direction: "out", payment: "cash", operator: null, reference: "R-TEST-1" } } },
  };
  await seed(page, "pocket-assistant", "history", [entry]);
  // One typed line too: with scans alone the row is greyed out (reported as a bug).
  await seed(page, "assisteo-expenses", "expenses", [expense]);
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-total")).not.toHaveText(/^0 Ar$/);
  await page.goto("/settings");
  await page.locator('[data-testid="reset-row"][data-screen="expenses"]').click();
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByText("Dépenses et revenus effacés")).toBeVisible();
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-total")).toHaveText(/^0 Ar$/);
  expect(await count(page, "pocket-assistant", "history")).toBe(1);
  // The history line of Réglages is still offered: the scan is there.
  await page.goto("/settings");
  await expect(page.locator('[data-testid="reset-row"][data-screen="history"]')).toBeEnabled();
});
