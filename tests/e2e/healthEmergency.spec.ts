import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Fiche d'urgence" (Ma santé): for everyone, written in a bottom sheet, kept
// on the device (read again after a reload), « Appeler » the person to call,
// shared only by choice, and emptied by « Remettre à zéro ».

/** What leaves the app: the share sheet, WhatsApp (window.open) and the dialer (a tel: link). */
async function catchOutgoing(page: Page) {
  await page.addInitScript(() => {
    const sent = { shared: [] as string[], opened: [] as string[], called: [] as string[] };
    (window as unknown as { sent: typeof sent }).sent = sent;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { text?: string }) => {
        sent.shared.push(data.text ?? "");
      },
    });
    window.open = ((url: string) => {
      sent.opened.push(String(url));
      return null;
    }) as typeof window.open;
    document.addEventListener(
      "click",
      (event) => {
        const link = (event.target as Element | null)?.closest?.("a[href^='tel:']");
        if (!link) return;
        event.preventDefault();
        sent.called.push(link.getAttribute("href") ?? "");
      },
      true,
    );
  });
}

const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: { shared: string[]; opened: string[]; called: string[] } }).sent);

async function fillCard(page: Page) {
  await page.getByTestId("emergency-fill").click();
  const form = page.getByTestId("emergency-form");
  await expect(form).toBeVisible();
  await form.getByTestId("emergency-blood-input").selectOption("O-");
  await form.getByTestId("emergency-allergies-input").fill("pénicilline, arachide");
  await form.getByTestId("emergency-conditions-input").fill("Asthme");
  await form.getByTestId("emergency-contact-name").fill("Voahangy");
  await form.getByTestId("emergency-contact-relation").fill("ma sœur");
  await form.getByTestId("emergency-contact-phone").fill("034 12 345 67");
  await form.getByTestId("emergency-note-input").fill("Porte des lentilles");
  await form.getByTestId("emergency-save").click();
  await expect(page.getByText("Fiche enregistrée")).toBeVisible();
  await expect(form).toHaveCount(0);
}

test("the emergency card: filled, read again after a reload, called, shared, then emptied by the reset", async ({ page, isMobile }) => {
  await prepare(page);
  await catchOutgoing(page);
  // « Ma santé » is in the menu for everyone, nothing scanned yet (computer: the sidebar).
  if (isMobile) await page.goto("/sante");
  else {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ma santé" }).click();
    await expect(page).toHaveURL(/\/sante$/);
  }

  // For everyone, even with nothing else on the screen.
  const card = page.getByTestId("emergency-card");
  await expect(card.getByRole("heading", { name: "Fiche d’urgence" })).toBeVisible();
  await expect(card.getByTestId("emergency-call")).toHaveCount(0);
  await fillCard(page);

  const check = async () => {
    await expect(card.getByTestId("emergency-blood")).toContainText("O−");
    await expect(card.getByTestId("emergency-allergies").getByRole("listitem")).toHaveText(["pénicilline", "arachide"]);
    await expect(card.getByTestId("emergency-conditions")).toContainText("Asthme");
    await expect(card.getByTestId("emergency-contact")).toContainText("Voahangy (ma sœur)");
    await expect(card.getByTestId("emergency-note")).toContainText("Porte des lentilles");
  };
  await check();

  // Kept on the device: there again after a reload.
  await page.reload();
  await check();

  // « Appeler »: the dialer, with the number's digits.
  const call = card.getByTestId("emergency-call");
  await expect(call).toHaveText(/Appeler Voahangy/);
  await expect(call).toHaveAttribute("href", "tel:0341234567");
  expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await call.click();
  await expect.poll(async () => (await sent(page)).called).toEqual(["tel:0341234567"]);

  // Shared by choice: only what is written.
  await card.getByTestId("emergency-share").click();
  await expect.poll(async () => (await sent(page)).shared.length).toBe(1);
  const text = (await sent(page)).shared[0];
  expect(text).toMatch(/^Ma fiche d’urgence\nGroupe sanguin : O−\nAllergies : pénicilline, arachide\n/);
  expect(text).toContain("Personne à prévenir : Voahangy (ma sœur) 034 12 345 67");
  await card.getByTestId("emergency-whatsapp").click();
  await expect.poll(async () => (await sent(page)).opened.length).toBe(1);
  expect((await sent(page)).opened[0]).toMatch(/^https:\/\/wa\.me\/\?text=Ma%20fiche%20d%E2%80%99urgence/);

  // Edited: the sheet opens with what is written.
  await card.getByTestId("emergency-edit").click();
  await expect(page.getByTestId("emergency-contact-name")).toHaveValue("Voahangy");
  await page.getByTestId("emergency-blood-input").selectOption("unknown");
  await page.getByTestId("emergency-save").click();
  await expect(card.getByTestId("emergency-blood")).toContainText("Je ne sais pas");

  // « Remettre à zéro » (Réglages): the card has its line, and goes.
  await page.goto("/settings");
  const row = page.locator('[data-testid="reset-row"][data-screen="health"]');
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.getByTestId("reset-window")).toContainText("Ta fiche d’urgence");
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByText("Fiche d’urgence effacée")).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.goto("/sante");
  await expect(page.getByTestId("emergency-fill")).toBeVisible();
});

test("the emergency card fits a 320 px phone in very large text", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const key = "CapacitorStorage.settings.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, textSize: "xlarge", onboardingDone: true }));
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/sante");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // The form, in the sheet: its fields at 16 px at least, nothing wider than the screen.
  await page.getByTestId("emergency-fill").click();
  const form = page.getByTestId("emergency-form");
  await expect(form).toBeVisible();
  for (const field of await form.locator("input, select, textarea").all()) {
    const box = (await field.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(parseFloat(await field.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  }
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  await form.getByRole("button", { name: "Annuler" }).click();
  await expect(form).toHaveCount(0);
  await fillCard(page);

  const card = page.getByTestId("emergency-card");
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(320);
  for (const button of await card.locator("a, button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
