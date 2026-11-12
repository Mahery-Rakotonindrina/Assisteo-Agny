import { expect, test, type Page } from "@playwright/test";
import { mockReceipt } from "../../lib/ai/mock";
import { prepare } from "./helpers";

// "Dépenses de santé" (Ma santé): the month's total with the month before,
// the lines, per person ("Pour qui ?"); without "Mes dépenses" a list of its
// own (and a pharmacy receipt scanned added to it), with it real expenses of
// the category Santé, the former list still counted; 320 px in very large text.

async function pretendPlan(page: Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
}

/** A local day as the date field wants it: `offset` days from today, or the 1st of the month before. */
const day = (offset: number | "lastMonth") => {
  const date = new Date();
  if (offset === "lastMonth") date.setMonth(date.getMonth() - 1, 1);
  else date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** "42 500 Ar", whatever space the locale puts between the thousands. */
const ariary = (text: string) => new RegExp(`^${text.replace(/ /g, "\\s")} Ar$`);

type Values = { amount: string; kind?: string; on?: string; note?: string };

async function addSpend(page: Page, values: Values) {
  await page.getByTestId("health-spending-add").click();
  const form = page.getByTestId("health-spending-form");
  await expect(form).toBeVisible();
  await form.getByTestId("health-spending-amount").fill(values.amount);
  if (values.kind) await form.locator(`[data-testid="health-spending-kind"][data-kind="${values.kind}"]`).click();
  if (values.on) await form.getByTestId("health-spending-day").fill(values.on);
  if (values.note) await form.getByTestId("health-spending-note").fill(values.note);
  await form.getByTestId("health-spending-save").click();
  await expect(form).toHaveCount(0);
}

const total = (page: Page) => page.getByTestId("health-spending-total");
const lines = (page: Page) => page.getByTestId("health-spending-line");

test("without « Mes dépenses »: added, the month's total, the month before, per person, changed and removed, kept after a reload", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "free");
  await page.goto("/sante");
  const section = page.getByTestId("health-spending");
  await expect(section.getByRole("heading", { name: "Dépenses de santé" })).toBeVisible();
  await expect(total(page)).toHaveText(ariary("0"));
  await expect(section).toContainText("Avec « Mes dépenses »");

  // The amount is checked.
  await page.getByTestId("health-spending-add").click();
  await page.getByTestId("health-spending-amount").fill("douze");
  await page.getByTestId("health-spending-save").click();
  await expect(page.getByTestId("health-spending-form").getByRole("alert")).toHaveText("Écris le montant en ariary (par exemple 12 500).");
  await page.getByTestId("health-spending-form").getByRole("button", { name: "Annuler" }).click();

  await addSpend(page, { amount: "12 500", note: "Pharmacie Soa" });
  await addSpend(page, { amount: "30000", kind: "consultation" });
  await addSpend(page, { amount: "7000", kind: "tests", on: day("lastMonth") });
  await expect(total(page)).toHaveText(ariary("42 500"));
  await expect(page.getByTestId("health-spending-before")).toHaveText(/^Le mois dernier : 7\s000 Ar$/);
  await expect(lines(page)).toHaveCount(2);

  // ‹ ›: the month before, its total and its list; never past this month.
  const shown = (await page.getByTestId("health-spending-month").textContent()) ?? "";
  await expect(page.getByTestId("health-spending-next")).toBeDisabled();
  await page.getByTestId("health-spending-prev").click();
  await expect(page.getByTestId("health-spending-month")).not.toHaveText(shown);
  await expect(total(page)).toHaveText(ariary("7 000"));
  await expect(page.getByTestId("health-spending-before")).toHaveText(/^Le mois dernier : 0 Ar$/);
  await expect(lines(page)).toHaveCount(1);
  await expect(lines(page)).toContainText("Analyses");
  await expect(page.getByTestId("health-spending-next")).toBeEnabled();
  await page.getByTestId("health-spending-next").click();
  await expect(page.getByTestId("health-spending-month")).toHaveText(shown);
  await expect(total(page)).toHaveText(ariary("42 500"));
  await expect(page.getByTestId("health-spending-summary")).toContainText("Pharmacie");
  await expect(page.getByTestId("health-spending-summary")).toContainText("Consultation");

  // A relative: their own total, and the family's.
  await page.getByTestId("health-profile-add").click();
  await page.getByTestId("health-profile-name").fill("Rado");
  await page.getByTestId("health-profile-save").click();
  await expect(total(page)).toHaveText(ariary("0"));
  await addSpend(page, { amount: "5000", kind: "hospital" });
  await expect(total(page)).toHaveText(ariary("5 000"));
  const people = page.getByTestId("health-spending-person");
  await expect(people).toHaveCount(2);
  await expect(people.nth(0)).toContainText("Moi");
  await expect(people.nth(1)).toContainText("Rado");
  await people.nth(0).click();
  await expect(total(page)).toHaveText(ariary("42 500"));

  // Kept after a reload; one changed, one removed.
  await page.reload();
  await expect(total(page)).toHaveText(ariary("42 500"));
  await lines(page).filter({ hasText: "Pharmacie Soa" }).getByRole("button").click();
  await page.getByTestId("health-spending-amount").fill("15000");
  await page.getByTestId("health-spending-save").click();
  await expect(total(page)).toHaveText(ariary("45 000"));
  await lines(page).filter({ hasText: "Consultation" }).getByRole("button").click();
  await page.getByTestId("health-spending-remove").click();
  await page.getByTestId("health-spending-remove").click();
  await expect(total(page)).toHaveText(ariary("15 000"));
  await expect(lines(page)).toHaveCount(1);
});

test("with « Mes dépenses »: a real expense of the category Santé, the former list still counted", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "unlimited");
  await page.goto("/");
  // Kept from a plan without "Mes dépenses".
  await page.evaluate(async () => {
    const at = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
    const spend = { id: "own-1", at, amountMga: 4000, kind: "pharmacy", note: "Avant", createdAt: at, updatedAt: at };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("assisteo-health-spending");
      request.onupgradeneeded = () => request.result.createObjectStore("spending");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("spending", "readwrite");
        tx.objectStore("spending").put(spend, spend.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.goto("/sante");
  await expect(page.getByTestId("health-spending")).toContainText("Elles comptent aussi dans « Mes dépenses »");
  await expect(total(page)).toHaveText(ariary("4 000"));
  await addSpend(page, { amount: "18000", kind: "consultation", note: "Dr Rabe" });
  await expect(total(page)).toHaveText(ariary("22 000"));
  await expect(page.locator('[data-testid="health-spending-line"][data-from="expense"]')).toContainText("Dans Mes dépenses");
  await expect(page.locator('[data-testid="health-spending-line"][data-from="own"]')).toContainText("Avant");

  // A real expense of "Mes dépenses", category Santé, once.
  const expenses = await page.evaluate(
    () =>
      new Promise<{ kind: string; category: string; amountMga: number; health?: { kind: string } }[]>((resolve, reject) => {
        const request = indexedDB.open("assisteo-expenses");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const get = request.result.transaction("expenses").objectStore("expenses").getAll();
          get.onsuccess = () => resolve(get.result);
        };
      }),
  );
  const health = expenses.filter((record) => record.kind === "expense");
  expect(health).toHaveLength(1);
  expect(health[0]).toMatchObject({ category: "health", amountMga: 18000, health: { kind: "consultation" } });

  // The former list counted in "Mes dépenses", once confirmed; tapped again, nothing doubles.
  const banner = page.getByTestId("health-spending-move");
  await expect(banner).toContainText("1 dépense de santé n’est que dans Ma santé");
  await banner.getByTestId("health-spending-move-button").click();
  await expect(banner.getByTestId("health-spending-move-button")).toHaveText("Oui, les mettre dans Mes dépenses");
  await banner.getByTestId("health-spending-move-button").dblclick();
  await expect(banner).toHaveCount(0);
  await expect(total(page)).toHaveText(ariary("22 000"));
  await expect(lines(page)).toHaveCount(2);
  await expect(page.locator('[data-testid="health-spending-line"][data-from="own"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="health-spending-line"][data-from="expense"]').filter({ hasText: "Avant" })).toHaveCount(1);
  const after = await page.evaluate(
    () =>
      new Promise<{ id: string; kind: string; category: string; amountMga: number; deletedAt?: number }[]>((resolve, reject) => {
        const request = indexedDB.open("assisteo-expenses");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const get = request.result.transaction("expenses").objectStore("expenses").getAll();
          get.onsuccess = () => resolve(get.result);
        };
      }),
  );
  expect(after.filter((record) => record.kind === "expense" && !record.deletedAt).map((record) => [record.id.startsWith("health:"), record.amountMga]).sort()).toEqual([
    [false, 18000],
    [true, 4000],
  ]);
  await page.reload();
  await expect(total(page)).toHaveText(ariary("22 000"));
  await expect(page.getByTestId("health-spending-move")).toHaveCount(0);

  // It opens in "Mes dépenses".
  await page.locator('[data-testid="health-spending-line"][data-from="expense"]').filter({ hasText: "Dr Rabe" }).locator("a").click();
  await expect(page).toHaveURL(/\/expenses\?open=/);
});

test("a pharmacy receipt scanned, without « Mes dépenses »: added to the health spending once", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "free");
  await page.goto("/");
  const analysis = mockReceipt("fr");
  analysis.document!.receipt = { ...analysis.document!.receipt!, category: "health", merchant: "Pharmacie Soa", date: day(0), total: 15500 };
  await page.evaluate(async (analysis) => {
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
    const entry = { id: "pharma", createdAt: Date.now(), mode: "auto", thumbnail: pixel, preview: pixel, analysis, meta: { model: "demo", demo: true, durationMs: 1 } };
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
  }, analysis);
  await page.goto("/result?id=pharma");
  const controls = page.getByTestId("health-spending-receipt");
  await expect(controls).toContainText(/Ce reçu de santé fait 15\s500 Ar\./);
  // Two quick taps: one line.
  await controls.getByTestId("health-spending-receipt-add").dblclick();
  await expect(controls.getByRole("link", { name: "Ajouté · Voir dans Ma santé" })).toBeVisible();
  await expect(controls.getByTestId("health-spending-receipt-add")).toHaveCount(0);

  await page.goto("/sante");
  await expect(total(page)).toHaveText(ariary("15 500"));
  await expect(lines(page)).toHaveCount(1);
  await expect(lines(page)).toContainText("Pharmacie Soa");
});

test("« Dépenses de santé » fits a 320 px phone in very large text", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "free");
  await page.addInitScript(() => {
    const key = "CapacitorStorage.settings.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, textSize: "xlarge", onboardingDone: true }));
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/sante");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.getByTestId("health-profile-add").click();
  await page.getByTestId("health-profile-name").fill("Ravaonirina");
  await page.getByTestId("health-profile-save").click();
  await page.getByTestId("health-spending-add").click();
  const form = page.getByTestId("health-spending-form");
  for (const field of await form.locator("input, select, button").all()) {
    const box = (await field.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  for (const field of await form.locator("input, select").all()) expect(parseFloat(await field.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  await form.getByRole("button", { name: "Annuler" }).click();

  await addSpend(page, { amount: "1250000", kind: "hospital", note: "Hospitalisation de trois jours à Antananarivo" });
  await page.getByTestId("health-profiles").getByRole("button", { name: "Moi", exact: true }).click();
  await addSpend(page, { amount: "12500" });
  const section = page.getByTestId("health-spending");
  await expect(page.getByTestId("health-spending-person")).toHaveCount(2);
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  for (const item of await section.locator("button:visible, a:visible").all()) {
    const box = (await item.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
