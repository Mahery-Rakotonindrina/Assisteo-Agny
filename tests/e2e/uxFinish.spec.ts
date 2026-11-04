import { expect, test, type Locator, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// What a tour with fictional users found: the tab bar's labels whole on a
// 320 px phone in "Très grand", "Enregistrer" always in view in a sheet, a
// message that never covers the buttons, the expenses' welcome card folded
// with "Compris", and the scan buttons above the bar on a 667 px phone.

test.describe.configure({ timeout: 120_000 });

async function start(page: Page, { textSize = "normal", admin = true }: { textSize?: "normal" | "xlarge"; admin?: boolean } = {}) {
  await prepare(page);
  await page.addInitScript((size) => {
    localStorage.setItem("CapacitorStorage.settings.v1", JSON.stringify({ locale: "fr", theme: "dark", textSize: size, onboardingDone: true, updatedAt: 0 }));
  }, textSize);
  if (admin)
    await page.route("**/api/plan", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
    });
}

/** The box of an element, in the viewport. */
async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not shown");
  return found;
}

for (const [textSize, admin] of [
  ["xlarge", true],
  ["xlarge", false],
  ["normal", true],
] as const) {
  test(`tab bar: every label whole at 320 px (${textSize}${admin ? ", with Admin" : ""})`, async ({ page, isMobile }) => {
    test.skip(!isMobile, "The tab bar is the phone's.");
    await page.setViewportSize({ width: 320, height: 640 });
    await start(page, { textSize, admin });
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(tabs).toHaveCount(admin ? 6 : 5);
    await expect(tabs.nth(1)).toHaveAccessibleName("Historique");
    const labels = await tabs.evaluateAll((links) =>
      links.map((link) => {
        const label = link.lastElementChild as HTMLElement;
        const inner = label.getBoundingClientRect();
        const outer = link.getBoundingClientRect();
        return {
          name: link.getAttribute("aria-label"),
          whole: label.scrollWidth <= Math.ceil(inner.width) + 1 && inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1,
          size: parseFloat(getComputedStyle(label).fontSize),
        };
      }),
    );
    for (const label of labels) {
      expect(label.whole, `${label.name} is cut`).toBe(true);
      expect(label.size, `${label.name} is too small`).toBeGreaterThanOrEqual(10);
    }
  });
}

test("adding an expense: « Enregistrer » shows without scrolling the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await start(page, { textSize: "xlarge" });
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  const sheet = page.getByRole("dialog", { name: "Ajouter une dépense" });
  const save = sheet.getByRole("button", { name: "Enregistrer" });
  await expect(save).toBeVisible();
  // The fields are taller than the screen: the button stays at the bottom of what shows.
  expect(await sheet.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  // Once the sheet has finished rising (60 px of spring).
  await expect.poll(async () => (await box(save)).y + (await box(save)).height).toBeLessThanOrEqual(667);
  const button = await box(save);
  expect(button.y).toBeGreaterThanOrEqual(0);
  await sheet.getByLabel("Montant", { exact: true }).fill("12500");
  await save.click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("expenses-total")).toHaveText(/^12\s500 Ar$/);
});

test("my pockets: the message does not cover « Ajouter une poche » nor « Virement », « Réordonner » is a link", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await start(page, { textSize: "xlarge" });
  await page.goto("/pockets");
  const setup = page.getByRole("form", { name: "Où est ton argent ?" });
  await setup.getByLabel(/^Espèces : combien/).fill("45000");
  await setup.getByRole("checkbox", { name: "MVola" }).check();
  await setup.getByLabel(/^MVola : combien/).fill("120000");
  await setup.getByRole("button", { name: "Enregistrer" }).click();
  const toast = page.getByRole("status").filter({ hasText: "Tes poches sont prêtes" });
  await expect(toast).toBeVisible();
  const message = await box(toast);
  for (const name of ["Ajouter une poche", "Virement"]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const action = await box(button);
    const overlaps = message.x < action.x + action.width && action.x < message.x + message.width && message.y < action.y + action.height && action.y < message.y + message.height;
    expect(overlaps, `the message covers ${name}`).toBe(false);
  }
  // "Virement" is the one big button; "Réordonner" is a quiet link next to "Comment ça marche ?".
  const transfer = await box(page.getByRole("button", { name: "Virement", exact: true }));
  const reorder = await box(page.getByRole("button", { name: "Réordonner" }));
  expect(reorder.height).toBeGreaterThanOrEqual(43);
  expect(reorder.height).toBeLessThan(transfer.height + 1);
  await page.getByRole("button", { name: "Réordonner" }).click();
  await expect(page.getByRole("button", { name: "Terminé" })).toBeVisible();
});

test("my expenses: the welcome card is folded, « Compris » closes it, « Comment ça marche ? » brings it back", async ({ page }) => {
  await start(page);
  await page.goto("/expenses");
  const welcome = page.getByTestId("expenses-welcome");
  await expect(welcome).toBeVisible();
  // Under the month's figures, its steps folded.
  const left = await box(page.getByTestId("expenses-left"));
  expect((await box(welcome)).y).toBeGreaterThan(left.y);
  await expect(welcome.getByText("Fixe ton budget.")).toHaveCount(0);
  await welcome.getByRole("button", { name: "Bienvenue dans Mes dépenses" }).click();
  await expect(welcome.getByText("Fixe ton budget.")).toBeVisible();
  await welcome.getByRole("button", { name: "Compris" }).click();
  await expect(welcome).toHaveCount(0);

  // Gone for good, until asked for again.
  await page.reload();
  await expect(page.getByTestId("expenses-tab-hint")).toBeVisible();
  await expect(welcome).toHaveCount(0);
  await page.getByRole("button", { name: "Comment ça marche ?" }).click();
  await expect(welcome.getByText("Fixe ton budget.")).toBeVisible();
});

for (const [plan, textSize] of [
  ["free", "normal"],
  ["unlimited", "normal"],
  ["free", "xlarge"],
  ["unlimited", "xlarge"],
] as const) {
  test(`scan on a 667 px phone (demo mode, ${plan}, ${textSize}): « Importer une image » and « Plusieurs pages » show above the bar`, async ({ page, isMobile }) => {
    test.skip(!isMobile, "The phone's layout.");
    await page.setViewportSize({ width: 375, height: 667 });
    await start(page, { admin: plan === "unlimited", textSize });
    await page.goto("/");
    // The demo banner is one line (two in "Très grand"); its explanation opens on a tap.
    const banner = page.getByRole("note").filter({ hasText: "Mode démo" });
    await expect(banner).toBeVisible();
    expect((await box(banner)).height).toBeLessThanOrEqual(56);
    // The five modes' labels never run into each other ("Document" and "Véhicule" did in "Très grand").
    // The text's own box: the label's may be narrower than a word that overflows it.
    const labels = page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio").locator("> span:last-child");
    await expect(labels).toHaveCount(5);
    const texts = await labels.evaluateAll((spans) =>
      spans.map((span) => {
        const range = document.createRange();
        range.selectNodeContents(span);
        const { left, right } = range.getBoundingClientRect();
        return { left, right };
      }),
    );
    for (let index = 0; index < 4; index++) expect(texts[index].right, `label ${index + 1} runs into the next`).toBeLessThan(texts[index + 1].left);
    const bar = await box(page.getByRole("navigation", { name: "Main" }).locator("> div"));
    for (const name of [/Importer une image/, /Plusieurs pages/]) {
      const button = page.getByRole(plan === "free" && String(name).includes("Plusieurs") ? "link" : "button", { name });
      await expect(button).toBeVisible();
      const found = await box(button);
      expect(found.y + found.height, `${name} is under the bar`).toBeLessThanOrEqual(bar.y);
    }
  });
}
