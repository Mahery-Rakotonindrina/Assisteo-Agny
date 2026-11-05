import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Ta semaine": on Sundays, a card on the home screen (the site; the app also
// has a notification, which a browser can't show). Lite and up.

const SUNDAY = "2026-11-01T10:00:00+03:00";
const MONDAY = "2026-11-02T10:00:00+03:00";

async function asPremium(page: Page) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, plan: "premium", features: ["reminders", "parcelCosts", "pdfExport", "ownKey", "deepAnalysis", "multiPage"] } });
  });
}

/** A parcel received by hand on Wednesday 28 October. */
async function seedArrivedParcel(page: Page) {
  await page.evaluate(async () => {
    const at = Date.parse("2026-10-28T10:00:00+03:00");
    const info = { platform: null, orderNumber: null, trackingNumber: null, carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
    const parcel = { id: "week-parcel", title: "Robe", info, scanIds: [], timeline: [], createdAt: at, updatedAt: at, receivedAt: at, fees: [] };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("assisteo-parcels");
      request.onupgradeneeded = () => request.result.createObjectStore("parcels");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("parcels", "readwrite");
        tx.objectStore("parcels").put(parcel, parcel.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

test("on a Sunday, a subscriber sees the week's card, below the scan, and can close it", async ({ page, isMobile }) => {
  await prepare(page);
  await asPremium(page);
  await page.goto("/");
  await seedArrivedParcel(page);
  await page.clock.install({ time: new Date(SUNDAY) });
  await page.goto("/");
  const card = page.getByTestId("week-card");
  await expect(card).toContainText("1 colis arrivé.");
  // On a phone, under the photo button: never above it (a computer has a drop zone instead).
  if (isMobile) {
    const scanButton = page.getByRole("button", { name: "Prendre une photo" }).first();
    await expect(scanButton).toBeVisible();
    const scan = await scanButton.boundingBox();
    const box = await card.boundingBox();
    expect(scan).not.toBeNull();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(scan!.y);
  }
  await card.getByRole("button", { name: "Fermer" }).click();
  await expect(card).toHaveCount(0);
});

test("no card on another day, nor without a reminders plan, nor once switched off in Settings", async ({ page }) => {
  await prepare(page);
  await asPremium(page);
  await page.goto("/");
  await seedArrivedParcel(page);
  await page.clock.install({ time: new Date(MONDAY) });
  await page.goto("/");
  await expect(page.getByTestId("week-card")).toHaveCount(0);

  await page.clock.setFixedTime(new Date(SUNDAY));
  // Switched on first: the card shows, so the next check proves the setting is what hides it.
  await page.goto("/");
  await expect(page.getByTestId("week-card")).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("switch", { name: "Résumé du dimanche" }).click();
  await page.goto("/");
  await expect(page.getByTestId("week-card")).toHaveCount(0);
});

test("a free account sees no week card on Sunday", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await seedArrivedParcel(page);
  await page.clock.install({ time: new Date(SUNDAY) });
  await page.goto("/");
  await expect(page.getByTestId("week-card")).toHaveCount(0);
});
