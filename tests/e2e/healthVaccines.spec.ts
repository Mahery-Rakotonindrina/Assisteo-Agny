import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Vaccins" (Ma santé): added by hand, the next dose on top and its
// reminder from Lite, a late one said so, noted as done, read again after a
// reload, shared as a PDF; the plan's lock in the free plan.

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

async function addVaccine(page: Page, { name, on, next = "", dose = "", place = "" }: { name: string; on: string; next?: string; dose?: string; place?: string }) {
  await page.getByTestId("vaccine-add").click();
  const form = page.getByTestId("vaccine-form");
  await expect(form).toBeVisible();
  await form.getByTestId("vaccine-name").fill(name);
  await form.getByTestId("vaccine-day").fill(on);
  if (dose) await form.getByTestId("vaccine-dose").fill(dose);
  if (place) await form.getByTestId("vaccine-place").fill(place);
  if (next) await form.getByTestId("vaccine-next-day").fill(next);
  await form.getByTestId("vaccine-save").click();
  await expect(form).toHaveCount(0);
}

test("vaccines: written by hand, next dose and reminder, a late one, noted as done, shared as a PDF", async ({ page }) => {
  // The phone's share sheet refused: the PDF is downloaded, on a phone too.
  await page.addInitScript(() => Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }));
  await prepare(page);
  await pretendPlan(page, "lite");
  await page.goto("/sante");
  const section = page.getByTestId("vaccines");
  await expect(section.getByRole("heading", { name: "Vaccins" })).toBeVisible();
  await expect(section).toContainText("Aucun vaccin noté");

  // The name and the date are needed; the next dose after the vaccine.
  await page.getByTestId("vaccine-add").click();
  const form = page.getByTestId("vaccine-form");
  await form.getByTestId("vaccine-save").click();
  await expect(form.getByRole("alert")).toHaveText("Écris le nom du vaccin.");
  await form.getByTestId("vaccine-name").fill("BCG");
  await form.getByTestId("vaccine-day").fill(day(-10));
  await form.getByTestId("vaccine-next-day").fill(day(-20));
  await form.getByTestId("vaccine-save").click();
  await expect(form.getByRole("alert")).toHaveText("La prochaine dose doit venir après la date du vaccin.");
  await form.getByRole("button", { name: "Annuler" }).click();

  await addVaccine(page, { name: "BCG", on: day(-400), dose: "1", place: "CSB Analakely" });
  await addVaccine(page, { name: "Rougeole-Rubéole", on: day(-30), next: day(5) });
  await addVaccine(page, { name: "Polio", on: day(-60), next: day(-3) });

  const check = async () => {
    const next = section.getByTestId("vaccine-next");
    await expect(next).toHaveCount(2);
    // The soonest first: the late one, said so.
    await expect(next.first()).toContainText("Prochain vaccin : Polio");
    await expect(next.first().getByTestId("vaccine-overdue")).toBeVisible();
    await expect(next.nth(1)).toContainText("Prochain vaccin : Rougeole-Rubéole");
    await expect(next.nth(1).getByTestId("vaccine-reminded")).toHaveText("Rappel la veille à 9 h");
    // The record, the latest first.
    const rows = section.getByTestId("vaccine");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("Rougeole-Rubéole");
    await expect(rows.last()).toContainText("BCG");
    await expect(rows.last()).toContainText("dose 1 · CSB Analakely");
  };
  await check();
  await page.reload();
  await check();

  // The late Polio done: the form opens on it, today; then it is no longer due.
  await section.getByTestId("vaccine-next").first().getByTestId("vaccine-done").click();
  await expect(page.getByTestId("vaccine-name")).toHaveValue("Polio");
  await expect(page.getByTestId("vaccine-day")).toHaveValue(day(0));
  await page.getByTestId("vaccine-save").click();
  await expect(section.getByTestId("vaccine-next")).toHaveCount(1);
  await expect(section.getByTestId("vaccine")).toHaveCount(4);

  // Shared as a PDF (a download on a computer).
  const [pdf] = await Promise.all([page.waitForEvent("download"), section.getByTestId("vaccines-pdf").click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  expect(fs.readFileSync((await pdf.path())!).subarray(0, 4).toString()).toBe("%PDF");

  // Removed after a confirmation.
  const bcg = section.getByTestId("vaccine").last();
  await bcg.getByTestId("vaccine-remove").click();
  await bcg.getByTestId("vaccine-remove").click();
  await expect(section.getByTestId("vaccine")).toHaveCount(3);
});

test("vaccines: the next dose reminder shows the plan's lock in the free plan", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "free");
  await page.goto("/sante");
  await addVaccine(page, { name: "Hépatite B", on: day(-30), next: day(10) });
  const section = page.getByTestId("vaccines");
  await expect(section.getByTestId("vaccine-next")).toHaveCount(1);
  await expect(section.getByTestId("vaccine-reminded")).toHaveCount(0);
  await expect(section).toContainText("Le rappel de la prochaine dose est inclus à partir de");
});

test("vaccines: a removed relative's record goes with them, never to « Moi »", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await addVaccine(page, { name: "Tétanos", on: day(-100) });
  await page.getByTestId("health-profile-add").click();
  const form = page.getByTestId("health-profile-form");
  await form.getByTestId("health-profile-name").fill("Lala");
  await form.getByTestId("health-profile-relation").selectOption("child");
  await form.getByTestId("health-profile-save").click();
  await expect(form).toHaveCount(0);
  const chip = (name: string) => page.getByTestId("health-profiles").getByRole("button", { name, exact: true });
  await expect(chip("Lala")).toHaveAttribute("aria-pressed", "true");
  for (const name of ["BCG", "Polio", "Rotavirus", "Pentavalent"]) await addVaccine(page, { name, on: day(-200) });
  const section = page.getByTestId("vaccines");
  await expect(section.getByTestId("vaccine")).toHaveCount(4);

  await page.getByTestId("health-profile-remove").click();
  await expect(page.getByTestId("health-profile-remove-window")).toContainText("Ses 4 vaccins seront supprimés");
  await page.getByTestId("health-profile-remove-confirm").click();
  await expect(chip("Lala")).toHaveCount(0);
  // « Moi » keeps only their own.
  await expect(section.getByTestId("vaccine")).toHaveCount(1);
  await expect(section.getByTestId("vaccine")).toContainText("Tétanos");
  await page.reload();
  await expect(page.getByTestId("vaccines").getByTestId("vaccine")).toHaveCount(1);
});
