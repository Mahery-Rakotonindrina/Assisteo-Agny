import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Mes mesures" (Ma santé): blood pressure, blood sugar and weight added, a
// curve per kind, the period changed, shared for the doctor, one changed and
// one removed, kept after a reload, per person ("Pour qui ?"), and 320 px in
// very large text. Never a word on whether a value is good.

/** A local day from today, as the date field wants it. */
const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type Values = { kind: "pressure" | "glucose" | "weight"; on?: string; at?: string; systolic?: string; diastolic?: string; pulse?: string; glucose?: string; moment?: string; weight?: string; note?: string };

async function addMeasure(page: Page, values: Values) {
  await page.getByTestId("measure-add").click();
  const form = page.getByTestId("measure-form");
  await expect(form).toBeVisible();
  await form.locator(`[data-testid="measure-kind-pick"][data-kind="${values.kind}"]`).click();
  if (values.systolic) await form.getByTestId("measure-systolic").fill(values.systolic);
  if (values.diastolic) await form.getByTestId("measure-diastolic").fill(values.diastolic);
  if (values.pulse) await form.getByTestId("measure-pulse").fill(values.pulse);
  if (values.glucose) await form.getByTestId("measure-glucose").fill(values.glucose);
  if (values.moment) await form.getByTestId("measure-moment").selectOption(values.moment);
  if (values.weight) await form.getByTestId("measure-weight").fill(values.weight);
  if (values.on) await form.getByTestId("measure-day").fill(values.on);
  if (values.at) await form.getByTestId("measure-hour").fill(values.at);
  if (values.note) await form.getByTestId("measure-note").fill(values.note);
  await form.getByTestId("measure-save").click();
  await expect(form).toHaveCount(0);
}

const card = (page: Page, kind: string) => page.locator(`[data-testid="measure-kind"][data-kind="${kind}"]`);

test("measures of the three kinds: their curve, the period, shared for the doctor, changed, removed, kept after a reload", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const sent: string[] = [];
    (window as unknown as { sent: string[] }).sent = sent;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { text?: string }) => {
        sent.push(data.text ?? "");
      },
    });
  });
  await page.goto("/sante");
  const section = page.getByTestId("measures");
  await expect(section.getByRole("heading", { name: "Mes mesures" })).toBeVisible();
  await expect(section).toContainText("Montre ces valeurs à ton médecin.");

  // The date and time are already there; the numbers are checked.
  await page.getByTestId("measure-add").click();
  await expect(page.getByTestId("measure-day")).toHaveValue(day(0));
  await expect(page.getByTestId("measure-hour")).toHaveValue(/^\d{2}:\d{2}$/);
  await page.getByTestId("measure-systolic").fill("80");
  await page.getByTestId("measure-diastolic").fill("120");
  await page.getByTestId("measure-save").click();
  await expect(page.getByTestId("measure-form").getByRole("alert")).toContainText("le premier plus grand que le second");
  await page.getByTestId("measure-form").getByRole("button", { name: "Annuler" }).click();

  await addMeasure(page, { kind: "pressure", on: day(-10), at: "08:00", systolic: "132", diastolic: "86" });
  await addMeasure(page, { kind: "pressure", on: day(-1), at: "08:30", systolic: "128", diastolic: "82", pulse: "70", note: "bras gauche" });
  await addMeasure(page, { kind: "glucose", on: day(-2), at: "07:00", glucose: "1,05", moment: "fasting" });
  await addMeasure(page, { kind: "weight", on: day(-60), at: "09:00", weight: "66" });
  await addMeasure(page, { kind: "weight", on: day(-3), at: "09:00", weight: "64,5" });

  const check = async () => {
    const pressure = card(page, "pressure");
    await expect(pressure.getByTestId("measure-last")).toContainText("128/82 mmHg · pouls 70");
    await expect(pressure.getByTestId("measure-change")).toContainText(/Systolique −4, diastolique −4 mmHg depuis le/);
    await expect(pressure.getByTestId("measure-chart")).toBeVisible();
    await expect(pressure.locator("circle")).toHaveCount(4);
    await expect(pressure.getByRole("listitem").filter({ hasText: "Systolique" })).toBeVisible();
    await expect(card(page, "glucose").getByTestId("measure-last")).toContainText("1,05 g/L · à jeun");
    // Weight: the one of 60 days ago is outside the 30 days.
    const weight = card(page, "weight");
    await expect(weight.getByTestId("measure-last")).toContainText("64,5 kg");
    await expect(weight.locator("circle")).toHaveCount(1);
    await expect(weight.getByTestId("measure-change")).toHaveCount(0);
  };
  await check();
  await page.reload();
  await check();

  // Touching a dot shows its value.
  const pressure = card(page, "pressure");
  await pressure.locator("rect").first().click();
  await expect(pressure.getByTestId("measure-readout")).toContainText("132/86 mmHg");

  // 3 months: the older weight comes in, with the change.
  await page.locator('[data-testid="measure-period"][data-period="3m"]').click();
  const weight = card(page, "weight");
  await expect(weight.locator("circle")).toHaveCount(2);
  await expect(weight.getByTestId("measure-change")).toContainText("−1,5 kg depuis le");

  // Nothing that judges a value.
  await expect(page.getByTestId("measures")).not.toContainText(/normal|dangereux|élevé|trop/i);

  // Shared for the doctor: the period's values and the neutral line.
  await page.getByTestId("measure-share").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { sent: string[] }).sent.length)).toBe(1);
  const text = await page.evaluate(() => (window as unknown as { sent: string[] }).sent[0]);
  expect(text).toMatch(/^Mes mesures\nDu .+ au .+\n\nTension\n/);
  expect(text).toContain("128/82 mmHg · pouls 70 (bras gauche)");
  expect(text).toContain("1,05 g/L · à jeun");
  expect(text).toContain("66 kg");
  expect(text).toMatch(/Montre ces valeurs à ton médecin\.$/);

  // Changed, then removed, from the values below the curve.
  await weight.locator("summary").click();
  await weight.getByTestId("measure-value").first().click();
  await expect(page.getByTestId("measure-weight")).toHaveValue("64,5");
  await page.getByTestId("measure-weight").fill("64");
  await page.getByTestId("measure-save").click();
  await expect(weight.getByTestId("measure-last")).toContainText("64 kg");
  await weight.getByTestId("measure-value").first().click();
  await page.getByTestId("measure-remove").click();
  await page.getByTestId("measure-remove").click();
  await expect(page.getByText("Mesure supprimée")).toBeVisible();
  await expect(weight.getByTestId("measure-last")).toContainText("66 kg");
});

test("measures follow the person picked: a relative's weight is not « Moi »'s", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await addMeasure(page, { kind: "weight", weight: "64,5" });
  await page.getByTestId("health-profile-add").click();
  await page.getByTestId("health-profile-name").fill("Rado");
  await page.getByTestId("health-profile-save").click();
  await expect(page.getByTestId("measures")).toContainText("Note ta tension");
  await addMeasure(page, { kind: "weight", weight: "21,3" });
  await expect(card(page, "weight").getByTestId("measure-last")).toContainText("21,3 kg");
  await page.getByTestId("health-profiles").getByRole("button", { name: "Moi", exact: true }).click();
  await expect(card(page, "weight").getByTestId("measure-last")).toContainText("64,5 kg");
  await expect(page.getByTestId("measures")).not.toContainText("21,3");
});

test("« Mes mesures » fits a 320 px phone in very large text", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const key = "CapacitorStorage.settings.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, textSize: "xlarge", onboardingDone: true }));
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/sante");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.getByTestId("measure-add").click();
  const form = page.getByTestId("measure-form");
  for (const kind of ["pressure", "glucose", "weight"]) {
    await form.locator(`[data-testid="measure-kind-pick"][data-kind="${kind}"]`).click();
    for (const field of await form.locator("input, select, button").all()) {
      const box = (await field.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    for (const field of await form.locator("input, select").all()) expect(parseFloat(await field.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await expect.poll(overflow).toBeLessThanOrEqual(0);
  }
  await form.getByRole("button", { name: "Annuler" }).click();

  await addMeasure(page, { kind: "pressure", on: day(-5), systolic: "130", diastolic: "85", pulse: "72" });
  await addMeasure(page, { kind: "pressure", systolic: "128", diastolic: "82" });
  const section = page.getByTestId("measures");
  await expect(section.getByTestId("measure-chart")).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  const chart = (await section.getByTestId("measure-chart").boundingBox())!;
  expect(chart.x + chart.width).toBeLessThanOrEqual(320);
  for (const button of await section.locator("button:visible").all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
