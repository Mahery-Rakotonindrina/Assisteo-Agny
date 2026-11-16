import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Rendez-vous" (Ma santé): added, changed, removed, read again after a
// reload, the past ones folded; the reminders from Lite (the plan's lock
// otherwise); and the form and the cards at 320 px in very large text.

async function pretendPlan(page: Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
}

/** A local day from today, as the date field wants it. */
const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

async function addAppointment(page: Page, { on, at, who, place = "", note = "" }: { on: string; at: string; who: string; place?: string; note?: string }) {
  await page.getByTestId("appointment-add").click();
  const form = page.getByTestId("appointment-form");
  await expect(form).toBeVisible();
  await form.getByTestId("appointment-day").fill(on);
  await form.getByTestId("appointment-hour").fill(at);
  await form.getByTestId("appointment-who").fill(who);
  if (place) await form.getByTestId("appointment-place").fill(place);
  if (note) await form.getByTestId("appointment-note").fill(note);
  await form.getByTestId("appointment-save").click();
  await expect(form).toHaveCount(0);
}

test("appointments: added, read again after a reload, changed, the past ones folded, then removed", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "lite");
  await page.goto("/sante");
  const section = page.getByTestId("appointments");
  await expect(section.getByRole("heading", { name: "Rendez-vous" })).toBeVisible();
  await expect(section).toContainText("Aucun rendez-vous à venir");

  // The day and the time are needed.
  await page.getByTestId("appointment-add").click();
  await page.getByTestId("appointment-save").click();
  await expect(page.getByTestId("appointment-form").getByRole("alert")).toHaveText("Choisis le jour et l’heure du rendez-vous.");
  await page.getByTestId("appointment-form").getByRole("button", { name: "Annuler" }).click();

  await addAppointment(page, { on: day(3), at: "15:00", who: "Dentiste" });
  await addAppointment(page, { on: day(1), at: "09:30", who: "Dr Rabe", place: "CHU Befelatanana", note: "Apporter le carnet" });
  await expect(page.getByText("Rendez-vous ajouté").first()).toBeVisible();
  await addAppointment(page, { on: day(-5), at: "08:00", who: "Pédiatre" });

  const check = async () => {
    const cards = section.locator('[data-testid="appointment"]:not([data-past])');
    // The next one first.
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("Dr Rabe");
    await expect(cards.first()).toContainText("09:30");
    await expect(cards.first()).toContainText("CHU Befelatanana");
    await expect(cards.first()).toContainText("Apporter le carnet");
    await expect(cards.first()).toContainText("Rappel la veille à 18 h et 2 h avant");
    await expect(cards.nth(1)).toContainText("Dentiste");
    // The past one, folded.
    const past = section.getByTestId("appointments-past");
    await expect(past.locator("summary")).toHaveText("Passés (1)");
    await expect(past.getByText("Pédiatre")).toBeHidden();
  };
  await check();

  // Kept on the device: there again after a reload.
  await page.reload();
  await check();
  await section.getByTestId("appointments-past").locator("summary").click();
  await expect(section.getByText("Pédiatre")).toBeVisible();

  // Changed: the sheet opens with what is written.
  const first = section.getByTestId("appointment").first();
  await first.getByTestId("appointment-edit").click();
  await expect(page.getByTestId("appointment-who")).toHaveValue("Dr Rabe");
  await expect(page.getByTestId("appointment-hour")).toHaveValue("09:30");
  await page.getByTestId("appointment-hour").fill("10:15");
  await page.getByTestId("appointment-place").fill("Clinique d’Ankadifotsy");
  await page.getByTestId("appointment-save").click();
  await expect(page.getByText("Rendez-vous modifié")).toBeVisible();
  await expect(first).toContainText("10:15");
  await expect(first).toContainText("Clinique d’Ankadifotsy");

  // Removed: asked once more.
  await first.getByTestId("appointment-remove").click();
  await expect(first.getByTestId("appointment-remove")).toHaveText(/Oui, supprimer/);
  await first.getByTestId("appointment-remove").click();
  await expect(page.getByText("Rendez-vous supprimé")).toBeVisible();
  await expect(section.locator('[data-testid="appointment"]:not([data-past])')).toHaveCount(1);
  await page.reload();
  await expect(section.locator('[data-testid="appointment"]:not([data-past])')).toHaveCount(1);
  await expect(section).not.toContainText("Dr Rabe");

  // « Remettre à zéro »: the appointments go with the emergency card.
  await page.goto("/settings");
  const row = page.locator('[data-testid="reset-row"][data-screen="health"]');
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.getByTestId("reset-window")).toContainText("2 rendez-vous");
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByText("Fiche d’urgence et rendez-vous effacés")).toBeVisible();
  await page.goto("/sante");
  await expect(page.getByTestId("appointments")).toContainText("Aucun rendez-vous à venir");
  await expect(page.getByTestId("appointment")).toHaveCount(0);
});

test("the reminder line says only what will really ring", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 10, 12) });
  await prepare(page);
  await pretendPlan(page, "lite");
  await page.goto("/sante");
  await addAppointment(page, { on: "2026-11-10", at: "13:30", who: "Dans une heure et demie" });
  await addAppointment(page, { on: "2026-11-10", at: "20:00", who: "Ce soir" });
  await addAppointment(page, { on: "2026-11-11", at: "09:00", who: "Demain matin" });
  const card = (who: string) => page.getByTestId("appointment").filter({ hasText: who });
  await expect(card("Dans une heure et demie").getByTestId("appointment-reminded")).toHaveCount(0);
  await expect(card("Ce soir").getByTestId("appointment-reminded")).toHaveText("Rappel 2 h avant");
  await expect(card("Demain matin").getByTestId("appointment-reminded")).toHaveText("Rappel la veille à 18 h et 2 h avant");
});

test("on the free plan, the appointments are kept but their reminders show the plan's lock", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  const section = page.getByTestId("appointments");
  await expect(section.getByText("Les rappels de rendez-vous sont inclus à partir de Lite.")).toBeVisible();
  await addAppointment(page, { on: day(2), at: "11:00", who: "Ophtalmo" });
  await expect(section.getByTestId("appointment")).toContainText("Ophtalmo");
  await expect(section.getByText("Rappel la veille à 18 h et 2 h avant")).toHaveCount(0);
});

test("the appointments fit a 320 px phone in very large text", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const key = "CapacitorStorage.settings.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, textSize: "xlarge", onboardingDone: true }));
  });
  await pretendPlan(page, "lite");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/sante");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.getByTestId("appointment-add").click();
  const form = page.getByTestId("appointment-form");
  await expect(form).toBeVisible();
  for (const field of await form.locator("input, textarea").all()) {
    const box = (await field.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(parseFloat(await field.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  }
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  await form.getByRole("button", { name: "Annuler" }).click();
  await expect(form).toHaveCount(0);

  await addAppointment(page, { on: day(1), at: "09:30", who: "Service de cardiologie du centre hospitalier", place: "Hôpital Joseph Ravoahangy Andrianavalona" });
  const section = page.getByTestId("appointments");
  await expect(section.getByTestId("appointment")).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  for (const button of await section.locator("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
