import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { prepare } from "./helpers";

// Fiche d'urgence imprimable: the wallet card (PDF) and the lock-screen picture (PNG).

async function fill(page: Page, long = false) {
  await page.getByTestId("emergency-fill").click();
  const form = page.getByTestId("emergency-form");
  await expect(form).toBeVisible();
  await form.getByTestId("emergency-blood-input").selectOption("O-");
  await form.getByTestId("emergency-allergies-input").fill(long ? "a".repeat(500) : "pénicilline");
  await form.getByTestId("emergency-contact-name").fill("Voahangy");
  await form.getByTestId("emergency-contact-phone").fill("034 12 345 67");
  if (long) await form.getByTestId("emergency-note-input").fill("n".repeat(500));
  await form.getByTestId("emergency-save").click();
  await expect(form).toHaveCount(0);
}

async function downloads(page: Page) {
  const card = page.getByTestId("emergency-card");
  const [pdf] = await Promise.all([page.waitForEvent("download"), card.getByTestId("emergency-print").click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  expect(fs.readFileSync((await pdf.path())!).subarray(0, 4).toString()).toBe("%PDF");
  const [png] = await Promise.all([page.waitForEvent("download"), card.getByTestId("emergency-wallpaper").click()]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const bytes = fs.readFileSync((await png.path())!);
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(2400);
}

test("empty card: no print buttons, a message", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await expect(page.getByTestId("emergency-print-empty")).toBeVisible();
  await expect(page.getByTestId("emergency-print")).toHaveCount(0);
  await expect(page.getByTestId("emergency-wallpaper")).toHaveCount(0);
});

test("print and wallpaper download for me and a relative, with long texts", async ({ page }) => {
  await prepare(page);
  // On a phone the file goes to the share sheet: refuse it here so it downloads.
  await page.addInitScript(() => Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }));
  await page.goto("/sante");
  await fill(page, true);
  await expect(page.getByTestId("emergency-print-empty")).toHaveCount(0);
  await downloads(page);
  await page.getByTestId("health-profile-add").click();
  const form = page.getByTestId("health-profile-form");
  await form.getByTestId("health-profile-name").fill("Lala");
  await form.getByTestId("health-profile-relation").selectOption("child");
  await form.getByTestId("health-profile-save").click();
  await expect(form).toHaveCount(0);
  await page.getByTestId("health-profiles").getByRole("button", { name: "Lala", exact: true }).click();
  await expect(page.getByTestId("emergency-print")).toHaveCount(0);
  await fill(page);
  await downloads(page);
});
