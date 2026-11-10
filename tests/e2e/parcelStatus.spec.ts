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

test("no share sheet: the message is copied as it is; a foreign number without its code is pointed out; a client's number serves their other parcels", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  // No share sheet (a computer): what is copied, what is opened.
  await page.addInitScript(() => {
    const sent = { opened: [] as string[], copied: [] as string[] };
    (window as unknown as { sent: typeof sent }).sent = sent;
    window.open = ((url: string) => {
      sent.opened.push(String(url));
      return null;
    }) as typeof window.open;
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sent.copied.push(text);
        },
        readText: async () => "",
      },
    });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const now = Date.now();
    const info = { platform: null, orderNumber: null, trackingNumber: "YT2412345678", carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
    const base = { info, scanIds: [], timeline: [], createdAt: now, updatedAt: now, fees: [] };
    const parcels = [
      { ...base, id: "bag", title: "Sac en cuir", client: "Voahangy" },
      { ...base, id: "shoes", title: "Chaussures", client: "Rado", clientPhone: "034 22 222 22" },
      { ...base, id: "hat", title: "Chapeau", client: "Rado" },
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
  const sent = () => page.evaluate(() => (window as unknown as { sent: { opened: string[]; copied: string[] } }).sent);

  // Copied without a title: it starts with « Bonjour ».
  const bag = page.locator("article").filter({ hasText: "Sac en cuir" });
  await bag.getByRole("button", { name: /Sac en cuir/ }).click();
  await bag.getByTestId("parcel-send-status").click();
  await expect.poll(async () => (await sent()).copied.length).toBe(1);
  expect((await sent()).copied[0]).toBe("Bonjour Voahangy,\nColis « Sac en cuir » : En transit.\nN° de suivi : YT2412345678");
  await expect(page.getByText("Message copié : colle-le dans la conversation du client")).toBeVisible();

  // A French number written the French way: pointed out, not sent to wa.me.
  await bag.getByRole("button", { name: "Modifier" }).click();
  const sheet = page.getByRole("dialog");
  const phone = sheet.getByLabel("Numéro WhatsApp du client");
  await phone.fill("06 12 34 56 78");
  await expect(sheet.getByRole("alert")).toHaveText(/Pour l’étranger, mets l’indicatif : \+33/);
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await phone.fill("+33 6 12 34 56 78");
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Annuler" }).click();

  // Rado's number, typed on his shoes, shows on his hat; corrected there, it is his.
  const hat = page.locator("article").filter({ hasText: "Chapeau" });
  await hat.getByRole("button", { name: /Chapeau/ }).click();
  await hat.getByRole("button", { name: "Modifier" }).click();
  await expect(page.getByRole("dialog").getByLabel("Numéro WhatsApp du client")).toHaveValue("034 22 222 22");
  await page.getByRole("dialog").getByLabel("Numéro WhatsApp du client").fill("034 33 333 33");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const shoes = page.locator("article").filter({ hasText: "Chaussures" });
  await shoes.getByRole("button", { name: /Chaussures/ }).click();
  await shoes.getByTestId("parcel-send-status").click();
  await expect.poll(async () => (await sent()).opened.at(-1) ?? "").toMatch(/^https:\/\/wa\.me\/261343333333\?text=/);
});

test("at 320 px in normal text, « Envoyer le statut au client » wraps instead of running off the screen", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.evaluate(async () => {
    const now = Date.now();
    const info = { platform: null, orderNumber: null, trackingNumber: null, carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
    const parcel = { id: "bag", title: "Sac en cuir", client: "Voahangy", info, scanIds: [], timeline: [], createdAt: now, updatedAt: now, fees: [] };
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
  await page.goto("/parcels");
  const bag = page.locator("article").filter({ hasText: "Sac en cuir" });
  await bag.getByRole("button", { name: /Sac en cuir/ }).click();
  const button = bag.getByTestId("parcel-send-status");
  await expect(button).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const box = await button.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});
