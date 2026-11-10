import { expect, test, type Page } from "@playwright/test";
import { mockPrescription } from "../../lib/ai/mock";
import { prepare } from "./helpers";

// "Pour qui ?" (Ma santé): a relative added, their appointment and emergency
// card, the screen filtered by person, their dose reminders from a scan, the
// relative removed (their things back to « Moi »), and 320 px in very large text.

async function pretendPlan(page: Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
}

const tomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

async function addRelative(page: Page, name: string, year = "") {
  await page.getByTestId("health-profile-add").click();
  const form = page.getByTestId("health-profile-form");
  await form.getByTestId("health-profile-name").fill(name);
  await form.getByTestId("health-profile-relation").selectOption("child");
  if (year) await form.getByTestId("health-profile-year").fill(year);
  await form.getByTestId("health-profile-save").click();
  await expect(form).toHaveCount(0);
}

const chip = (page: Page, name: string) => page.getByTestId("health-profiles").getByRole("button", { name, exact: true });

test("a relative: added, their appointment and card, the screen filtered, then removed and their things back to « Moi »", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "lite");
  await page.goto("/sante");
  await expect(chip(page, "Moi")).toHaveAttribute("aria-pressed", "true");

  await addRelative(page, "Rado", "2019");
  // Their screen, right away.
  await expect(chip(page, "Rado")).toHaveAttribute("aria-pressed", "true");
  const age = new Date().getFullYear() - 2019;
  await expect(page.getByTestId("health-profile-current")).toContainText(`Enfant · ${age} ans`);
  const card = page.getByTestId("emergency-card");
  await expect(card.getByRole("heading", { name: "Fiche d’urgence de Rado" })).toBeVisible();

  // Their emergency card.
  await card.getByTestId("emergency-fill").click();
  await page.getByTestId("emergency-blood-input").selectOption("B+");
  await page.getByTestId("emergency-allergies-input").fill("arachide");
  await page.getByTestId("emergency-save").click();
  await expect(card.getByTestId("emergency-blood")).toContainText("B+");

  // Their appointment: « Pour qui ? » is Rado.
  await page.getByTestId("appointment-add").click();
  await expect(page.getByTestId("health-who")).toHaveValue(/.+/);
  await expect(page.getByTestId("health-who").locator("option:checked")).toHaveText("Rado");
  await page.getByTestId("appointment-day").fill(tomorrow());
  await page.getByTestId("appointment-hour").fill("10:00");
  await page.getByTestId("appointment-who").fill("Pédiatre");
  await page.getByTestId("appointment-save").click();
  await expect(page.getByTestId("appointment")).toContainText("Pédiatre");

  // « Moi »: none of Rado's.
  await chip(page, "Moi").click();
  await expect(card.getByRole("heading", { name: "Fiche d’urgence" })).toBeVisible();
  await expect(card.getByTestId("emergency-fill")).toBeVisible();
  await expect(page.getByTestId("appointment")).toHaveCount(0);

  // Kept on the device.
  await page.reload();
  await chip(page, "Rado").click();
  await expect(page.getByTestId("appointment")).toContainText("Pédiatre");
  await expect(card.getByTestId("emergency-blood")).toContainText("B+");

  // Removed, after saying what happens.
  await page.getByTestId("health-profile-remove").click();
  const window = page.getByTestId("health-profile-remove-window");
  await expect(window).toContainText("Son rendez-vous revient à « Moi »");
  await expect(window).toContainText("La fiche d’urgence de Rado est effacée");
  await page.getByTestId("health-profile-remove-confirm").click();
  await expect(page.getByText("Rado supprimé(e)")).toBeVisible();
  await expect(chip(page, "Rado")).toHaveCount(0);
  await expect(chip(page, "Moi")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("appointment")).toContainText("Pédiatre");
  await expect(card.getByTestId("emergency-fill")).toBeVisible();
});

test("the person picked is kept after a reload, and a link opens on a known one only", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await addRelative(page, "Rado");
  await addRelative(page, "Hanitra");
  await chip(page, "Rado").click();
  await page.reload();
  await expect(chip(page, "Rado")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("emergency-card").getByRole("heading", { name: "Fiche d’urgence de Rado" })).toBeVisible();

  // « ?pour= » (a notification's link): that person; unknown, ignored.
  const hanitra = await chip(page, "Hanitra").getAttribute("data-profile");
  await page.goto(`/sante?pour=${hanitra}`);
  await expect(chip(page, "Hanitra")).toHaveAttribute("aria-pressed", "true");
  await page.goto("/sante?pour=someone-else");
  await expect(chip(page, "Hanitra")).toHaveAttribute("aria-pressed", "true");

  // Removed: back to « Moi », after a reload too.
  await page.getByTestId("health-profile-remove").click();
  await page.getByTestId("health-profile-remove-confirm").click();
  await page.reload();
  await expect(chip(page, "Moi")).toHaveAttribute("aria-pressed", "true");
});

test("dose reminders created for a relative: « Pour qui ? » on the scan, the treatment under their name", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  await prepare(page);
  await pretendPlan(page, "lite");
  await page.goto("/");
  await page.evaluate(async (analysis) => {
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
    const entry = { id: "rx", createdAt: Date.now(), mode: "auto", thumbnail: pixel, preview: pixel, analysis, meta: { model: "demo", demo: true, durationMs: 1 } };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("pocket-assistant");
      request.onupgradeneeded = () => request.result.createObjectStore("history");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("history", "readwrite");
        tx.objectStore("history").put(entry, entry.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, mockPrescription("fr"));
  await page.goto("/sante");
  await addRelative(page, "Maman");

  await page.goto("/result?id=rx");
  const who = page.getByTestId("health-who");
  await expect(who.locator("option:checked")).toHaveText("Moi");
  await who.selectOption({ label: "Maman" });
  await page.getByTestId("medication-save").click();
  await expect(page.getByText(/^Rappels créés jusqu’au/)).toBeVisible();

  await page.goto("/sante");
  // Maman, just added, is the person kept: « Moi » has no treatment.
  await chip(page, "Moi").click();
  await expect(page.getByTestId("health-treatments")).toHaveCount(0);
  await chip(page, "Maman").click();
  await expect(page.getByTestId("health-treatment")).toBeVisible();
  await expect(page.getByTestId("health-prescriptions")).toBeVisible();
});

test("« Pour qui ? » fits a 320 px phone in very large text", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const key = "CapacitorStorage.settings.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, textSize: "xlarge", onboardingDone: true }));
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/sante");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.getByTestId("health-profile-add").click();
  const form = page.getByTestId("health-profile-form");
  for (const field of await form.locator("input, select").all()) {
    const box = (await field.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(parseFloat(await field.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  }
  await form.getByRole("button", { name: "Annuler" }).click();
  await addRelative(page, "Jean-Christophe Andrianarivelo", "1950");
  await addRelative(page, "Hanitra");

  const bar = page.getByTestId("health-profiles");
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  for (const button of await bar.locator("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  // The appointment form, with « Pour qui ? ».
  await page.getByTestId("appointment-add").click();
  const who = page.getByTestId("health-who");
  const box = (await who.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await expect.poll(overflow).toBeLessThanOrEqual(0);
});
