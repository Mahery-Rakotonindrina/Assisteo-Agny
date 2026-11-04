import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// Reseller tools (Pro): "Envoyer le statut au client", on WhatsApp or shared.

test("a reseller sends a parcel's status to the client: WhatsApp with their number, else shared, never the costs", async ({ page }) => {
  await prepare(page);
  // Admin has "reseller".
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  // What leaves the app: the link opened, the text shared.
  await page.addInitScript(() => {
    const sent = { opened: [] as string[], shared: [] as string[] };
    (window as unknown as { sent: typeof sent }).sent = sent;
    window.open = ((url: string) => {
      sent.opened.push(String(url));
      return null;
    }) as typeof window.open;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { text?: string }) => {
        sent.shared.push(data.text ?? "");
      },
    });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const now = Date.now();
    const info = { platform: null, orderNumber: null, trackingNumber: "YT2412345678", carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
    const base = { info, scanIds: [], timeline: [], createdAt: now, updatedAt: now };
    const parcels = [
      { ...base, id: "dress", title: "Robe rouge", client: "Rado", priceMga: 80000, fees: [{ id: "f", label: "Fret", amountMga: 9000 }], salePriceMga: 130000, paidMga: 100000, soldAt: now },
      { ...base, id: "bag", title: "Sac en cuir", client: "Voahangy", priceMga: 50000, fees: [] },
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
  const sent = () => page.evaluate(() => (window as unknown as { sent: { opened: string[]; shared: string[] } }).sent);

  // Rado's number, typed once in the parcel's edit sheet.
  const dress = page.locator("article").filter({ hasText: "Robe rouge" });
  await dress.getByRole("button", { name: /Robe rouge/ }).click();
  await dress.getByRole("button", { name: "Modifier" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Numéro WhatsApp du client").fill("034 22 222 22");
  await sheet.getByRole("button", { name: "Enregistrer" }).click();
  await expect(sheet).toBeHidden();

  await dress.getByTestId("parcel-send-status").click();
  await expect.poll(async () => (await sent()).opened.length).toBe(1);
  const url = (await sent()).opened[0];
  expect(url.startsWith("https://wa.me/261342222222?text=")).toBe(true);
  const message = decodeURIComponent(url.split("?text=")[1]);
  expect(message).toMatch(/^Bonjour Rado,\nColis « Robe rouge » : En transit\.\nN° de suivi : YT2412345678\nReste à payer : 30\s000 Ar$/);
  expect(message).not.toMatch(/80\D000|9\D000|Fret|Bénéfice/);

  // No number for Voahangy: the message is shared.
  const bag = page.locator("article").filter({ hasText: "Sac en cuir" });
  await bag.getByRole("button", { name: /Sac en cuir/ }).click();
  await bag.getByTestId("parcel-send-status").click();
  await expect.poll(async () => (await sent()).shared.length).toBe(1);
  expect((await sent()).shared[0]).toBe("Bonjour Voahangy,\nColis « Sac en cuir » : En transit.\nN° de suivi : YT2412345678");
  expect((await sent()).opened).toHaveLength(1);
});
