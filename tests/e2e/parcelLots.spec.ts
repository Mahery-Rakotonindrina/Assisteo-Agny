import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Reseller tools (Pro): freight by the kilo, and parcels grouped by shipment.

async function seedParcels(page: Page) {
  await page.evaluate(async () => {
    const now = Date.now();
    const info = { platform: null, orderNumber: null, trackingNumber: null, carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
    const base = { info, scanIds: [], timeline: [], createdAt: now, updatedAt: now, fees: [] };
    const parcels = [
      { ...base, id: "dress", title: "Robe rouge", client: "Rado", priceMga: 80000, salePriceMga: 130000, paidMga: 100000, soldAt: now },
      { ...base, id: "bag", title: "Sac en cuir", client: "Voahangy", priceMga: 50000 },
    ];
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("assisteo-parcels");
      request.onupgradeneeded = () => request.result.createObjectStore("parcels");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("parcels", "readwrite");
        for (const parcel of parcels) tx.objectStore("parcels").put(parcel, parcel.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

test("a reseller counts the freight by the kilo, groups parcels in a shipment and moves them all at once", async ({ page }) => {
  await prepare(page);
  // Admin has "reseller".
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/");
  await seedParcels(page);
  await page.goto("/parcels");

  // Freight: 2,5 kg × 12 000 Ar, added to the fees and the profit.
  const dress = page.locator("article").filter({ hasText: "Robe rouge" });
  await dress.getByRole("button", { name: /Robe rouge/ }).click();
  const freight = dress.getByTestId("parcel-freight");
  await freight.getByLabel("Transitaire", { exact: true }).fill("Trans Mada");
  await freight.getByLabel("Poids du colis en kilos").fill("2,5");
  await freight.getByLabel("Tarif du transitaire en ariary par kilo").fill("12000");
  await expect(freight.getByTestId("parcel-freight-amount")).toHaveText(/^Fret : 30\s000 Ar, compté dans les frais$/);
  await expect(dress.getByText(/^Bénéfice : 20\s000 Ar$/)).toBeVisible();
  // Saved: the card's total shows it.
  await expect(dress.getByRole("button", { name: /Robe rouge/ })).toContainText(/110\s000 Ar/);

  // The forwarder's rate comes back on the next parcel.
  const bag = page.locator("article").filter({ hasText: "Sac en cuir" });
  await bag.getByRole("button", { name: /Sac en cuir/ }).click();
  const bagFreight = bag.getByTestId("parcel-freight");
  await bagFreight.getByLabel("Transitaire", { exact: true }).fill("Trans Mada");
  await expect(bagFreight.getByLabel("Tarif du transitaire en ariary par kilo")).toHaveValue(/^12\s000$/);
  await bagFreight.getByLabel("Poids du colis en kilos").fill("1");
  await expect(bagFreight.getByTestId("parcel-freight-amount")).toHaveText(/^Fret : 12\s000 Ar/);
  // Closed at once: saved all the same.
  await bag.getByRole("button", { name: /Sac en cuir/ }).click();
  await expect(bag.getByRole("button", { name: /Sac en cuir/ })).toContainText(/62\s000 Ar/);

  // A shipment with both parcels.
  await page.getByRole("radio", { name: "Envois" }).click();
  await page.getByRole("button", { name: "Nouvel envoi" }).click();
  const sheet = page.getByRole("dialog", { name: "Nouvel envoi" });
  await sheet.getByLabel("Nom de l’envoi").fill("Conteneur de novembre");
  await sheet.getByLabel("Mode d’envoi").selectOption("sea");
  await sheet.getByRole("checkbox", { name: /Robe rouge/ }).check();
  await sheet.getByRole("checkbox", { name: /Sac en cuir/ }).check();
  await sheet.getByRole("button", { name: "Enregistrer l’envoi" }).click();
  await expect(sheet).toBeHidden();

  const lot = page.getByTestId("parcel-lot");
  await expect(lot).toHaveCount(1);
  await expect(lot.getByText("Conteneur de novembre")).toBeVisible();
  const totals = lot.getByTestId("parcel-lot-totals");
  await expect(totals).toContainText(/2 · 2 en route/);
  await expect(totals).toContainText(/3,5 kg/);
  await expect(totals).toContainText(/42\s000 Ar/);
  await expect(totals).toContainText(/100\s000 Ar/);
  await expect(totals).toContainText(/30\s000 Ar/);

  // Every parcel to "À retirer" at once.
  await lot.getByLabel("Statut de tous ses colis").selectOption("pickup_ready");
  await lot.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByText("Statut changé pour 2 colis")).toBeVisible();

  await page.getByRole("radio", { name: "Colis", exact: true }).click();
  await expect(page.getByText("Envoi : Conteneur de novembre")).toHaveCount(2);
  await expect(dress.getByText("À retirer", { exact: true })).toBeVisible();
  await expect(bag.getByText("À retirer", { exact: true })).toBeVisible();
});

test("the shipments fit a 320 px phone in very large text", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const key = "CapacitorStorage.settings.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, textSize: "xlarge", onboardingDone: true }));
  });
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await seedParcels(page);
  await page.evaluate(async () => {
    // Both parcels already in one shipment, with their freight.
    const request = indexedDB.open("assisteo-parcels");
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const store = request.result.transaction("parcels", "readwrite").objectStore("parcels");
        const all = store.getAll();
        all.onsuccess = () => {
          for (const parcel of all.result) {
            parcel.lot = { id: "l1", name: "Conteneur de novembre avec un nom très long", mode: "sea", departedAt: "2026-11-02" };
            parcel.freight = { forwarder: "Trans Mada", weightKg: 2.5, rateMga: 12000 };
            parcel.fees = [{ id: "freight-kg", label: "Fret 2,5 kg × 12 000 Ar", amountMga: 30000 }];
            store.put(parcel, parcel.id);
          }
          store.transaction.oncomplete = () => resolve();
        };
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.goto("/parcels");
  await page.getByRole("radio", { name: "Envois" }).click();
  const lot = page.getByTestId("parcel-lot");
  await expect(lot).toBeVisible();
  await lot.getByRole("button", { name: /Voir ses 2 colis/ }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Nouvel envoi" }).click();
  const sheet = page.getByRole("dialog", { name: "Nouvel envoi" });
  await expect(sheet).toBeVisible();
  const sheetOverflow = await sheet.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(sheetOverflow).toBeLessThanOrEqual(0);
  await sheet.getByRole("button", { name: "Annuler" }).click();

  // A parcel open, with its freight fields.
  await page.getByRole("radio", { name: "Colis", exact: true }).click();
  await page.getByRole("button", { name: /Robe rouge/ }).click();
  await expect(page.getByTestId("parcel-freight")).toBeVisible();
  const parcelOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(parcelOverflow).toBeLessThanOrEqual(0);
});
