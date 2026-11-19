import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Automatic tracking (Premium): one quiet line under the tracking number,
// "vérifié il y a 2 h" once the server checked the parcel, the Premium badge
// (to /plans) below Premium, a status from the tracking named as such in the
// parcel's history.

async function withParcels(page: Page, plan: string) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const now = Date.now();
    const info = { platform: "Temu", orderNumber: null, trackingNumber: "YT2412345678", carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: { description: "Arrived at the sorting centre", location: "Guangzhou", at: null }, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
    const parcels = [
      {
        id: "shoes",
        title: "Chaussures",
        info,
        scanIds: [],
        timeline: [
          { at: now - 3 * 86_400_000, status: "shipped", statusLabel: "Expédié", event: null, scanId: "" },
          { at: now - 2 * 3600_000, status: "in_transit", statusLabel: "En transit", event: info.lastEvent, scanId: "auto-track" },
        ],
        autoTrack: { checkedAt: now - 2 * 3600_000 - 60_000, number: "YT2412345678" },
        createdAt: now - 3 * 86_400_000,
        updatedAt: now,
      },
      // A number 17TRACK refused: not followed.
      { id: "lamp", title: "Lampe", info: { ...info, trackingNumber: "ODD12345" }, scanIds: [], timeline: [], autoTrack: { checkedAt: now - 3600_000, number: "ODD12345", refused: true }, createdAt: now - 86_400_000, updatedAt: now - 1 },
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
  await page.goto("/parcels");
  const card = page.locator("article").filter({ hasText: "Chaussures" });
  await card.getByRole("button", { name: /Chaussures/ }).click();
  return card;
}

test("Premium: the parcel says when the automatic tracking last checked it", async ({ page }) => {
  const card = await withParcels(page, "premium");
  await expect(card.getByTestId("parcel-autotrack")).toHaveText(/Suivi automatique · vérifié il y a 2 h/);
  await expect(card.getByTestId("parcel-autotrack-locked")).toHaveCount(0);
  // The step found by the tracking, named as such in the parcel's history (not "Modifié à la main").
  const history = card.getByRole("list", { name: "Historique du colis" });
  await expect(history.getByText(/^Suivi automatique · /)).toBeVisible();
  await expect(history.getByText(/Modifié à la main/)).toHaveCount(1);
});

test("Premium: a number 17TRACK refused shows no automatic tracking line", async ({ page }) => {
  await withParcels(page, "premium");
  const lamp = page.locator("article").filter({ hasText: "Lampe" });
  await lamp.getByRole("button", { name: /Lampe/ }).click();
  await expect(lamp.getByText("ODD12345")).toBeVisible();
  await expect(lamp.getByText(/Suivi automatique/)).toHaveCount(0);
});

test("below Premium: the automatic tracking shows its plan and leads to the offers", async ({ page }) => {
  const card = await withParcels(page, "lite");
  const locked = card.getByTestId("parcel-autotrack-locked");
  await expect(locked).toContainText("Suivi automatique, sans rescanner");
  await expect(locked).toContainText("Premium");
  await expect(card.getByTestId("parcel-autotrack")).toHaveCount(0);
  await locked.click();
  await expect(page).toHaveURL(/\/plans/);
});
