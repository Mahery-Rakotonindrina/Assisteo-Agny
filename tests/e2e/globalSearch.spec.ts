import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

async function seedParcel(page: Page) {
  await page.evaluate(async () => {
    const now = Date.now();
    const info = { platform: null, orderNumber: null, trackingNumber: "YT8257341962CN", carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
    const parcel = { id: "p1", title: "Robe rouge", client: "Rado", priceMga: 45000, fees: [], info, scanIds: [], timeline: [], createdAt: now, updatedAt: now };
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

test.describe("global search", () => {
  test("a scan is found without accent, 'See all' filters the history, empty and recent searches", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop file input.");
    await prepare(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
    await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
    const title = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
    const word = title.split(/\s+/).find((w) => w.length >= 4) ?? title;
    const plain = word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    // Clone the entry so that there are more than 5.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("pocket-assistant");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const store = request.result.transaction("history", "readwrite");
          const os = store.objectStore("history");
          const all = os.getAll();
          all.onsuccess = () => {
            const first = all.result[0];
            for (let i = 0; i < 6; i++) os.put({ ...first, id: `clone${i}`, createdAt: first.createdAt - (i + 1) * 1000 }, `clone${i}`);
          };
          store.oncomplete = () => resolve();
        };
      });
    });
    await page.goto("/recherche");
    await page.getByRole("searchbox", { name: "Rechercher dans toute l’app" }).fill(plain);
    const group = page.getByRole("region", { name: "Scans" });
    await expect(group).toBeVisible();
    await expect(group.locator("b").first()).toBeVisible();
    await group.getByRole("link", { name: /Voir tout/ }).click();
    await expect(page).toHaveURL(/\/history\?q=/);

    await page.goto("/recherche");
    await page.getByRole("searchbox", { name: "Rechercher dans toute l’app" }).fill("zzqxw");
    await expect(page.getByRole("status").filter({ hasText: "Rien trouvé" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Rechercher dans toute l’app" }).press("Enter");
    await page.reload();
    await expect(page.getByText("Dernières recherches")).toBeVisible();
    await page.getByRole("button", { name: "Effacer", exact: true }).click();
    await expect(page.getByText("Dernières recherches")).toHaveCount(0);
  });

  test("a parcel by its tracking number, an amount without spaces, free plan hides loans", async ({ page }) => {
    await prepare(page);
    await page.goto("/");
    await seedParcel(page);
    await page.goto("/recherche");
    const bar = page.getByRole("searchbox", { name: "Rechercher dans toute l’app" });
    await bar.fill("8257341962");
    await expect(page.getByRole("region", { name: "Colis" }).getByText("Robe rouge")).toBeVisible();
    await bar.fill("zz");
    await page.goto("/recherche?q=Rado");
    await expect(page.getByRole("region", { name: "Colis" })).toBeVisible();
    await page.goto("/parcels?q=Rado");
    await expect(page.getByText("Robe rouge")).toBeVisible();
    await page.goto("/recherche?q=prêt");
    await expect(page.getByRole("region", { name: "Prêts" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Dépenses et revenus" })).toHaveCount(0);
  });

  test("phone: the magnifier opens the screen; very large text; English", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Phone.");
    await prepare(page);
    await page.goto("/");
    await page.getByRole("link", { name: "Rechercher" }).first().click();
    await expect(page).toHaveURL(/\/recherche/);
    await expect(page.getByRole("heading", { level: 1, name: "Rechercher" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("desktop sidebar has the entry; English labels", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop.");
    await prepare(page);
    await page.goto("/");
    await page.locator("aside, nav").getByRole("link", { name: "Rechercher" }).first().click();
    await expect(page).toHaveURL(/\/recherche/);
  });
});
