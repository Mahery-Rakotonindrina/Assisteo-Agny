import { expect, test, type Page } from "@playwright/test";
import { mockMedicineBox } from "../../lib/ai/mock";
import { prepare } from "./helpers";

// "Pharmacie de la maison" (Ma santé): added by hand (month and year, the day
// optional), sorted by expiry with its badges and the one general sentence
// near the expired ones, the alerts from Lite, removed as thrown or finished;
// and added from a scanned medicine box, the expiry read on it.

async function pretendPlan(page: Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
}

/** A month from today ("+1" next month), as the selects want it. */
const monthFrom = (offset: number) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return { month: String(date.getMonth() + 1), year: String(date.getFullYear()) };
};

async function addMedicine(page: Page, { name, month, year, day = "", quantity = "" }: { name: string; month: string; year: string; day?: string; quantity?: string }) {
  await page.getByTestId("pharmacy-add").click();
  const form = page.getByTestId("pharmacy-form");
  await expect(form).toBeVisible();
  await form.getByTestId("pharmacy-name").fill(name);
  await form.getByTestId("pharmacy-month").selectOption(month);
  await form.getByTestId("pharmacy-year").selectOption(year);
  if (day) await form.getByTestId("pharmacy-day").selectOption(day);
  if (quantity) await form.getByTestId("pharmacy-quantity").fill(quantity);
  await form.getByTestId("pharmacy-save").click();
  await expect(form).toHaveCount(0);
}

test("home pharmacy: sorted by expiry, badges, the alerts from Lite, removed when thrown or finished", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "lite");
  await page.goto("/sante");
  const section = page.getByTestId("pharmacy");
  await expect(section.getByRole("heading", { name: "Pharmacie de la maison" })).toBeVisible();
  await expect(section).toContainText("Rien de noté");

  // The month and the year are needed.
  await page.getByTestId("pharmacy-add").click();
  const form = page.getByTestId("pharmacy-form");
  await form.getByTestId("pharmacy-name").fill("Sirop");
  await form.getByTestId("pharmacy-save").click();
  await expect(form.getByRole("alert")).toHaveText("Choisis le mois et l’année de péremption.");
  await form.getByRole("button", { name: "Annuler" }).click();

  const far = monthFrom(6);
  const late = monthFrom(-2);
  await addMedicine(page, { name: "Ibuprofène", ...far, quantity: "1 boîte" });
  await addMedicine(page, { name: "Sirop", ...late });
  await addMedicine(page, { name: "Paracétamol", ...monthFrom(0) });

  const check = async () => {
    const items = section.getByTestId("pharmacy-item");
    await expect(items).toHaveCount(3);
    // The first to expire first, each with what it is.
    await expect(items.nth(0)).toContainText("Sirop");
    await expect(items.nth(0).getByTestId("pharmacy-badge")).toHaveText("Périmé");
    await expect(items.nth(1)).toContainText("Paracétamol");
    // The last day of the month: "Dernier jour" instead.
    await expect(items.nth(1).getByTestId("pharmacy-badge")).toHaveText(/Bientôt périmé|Dernier jour : périmé demain/);
    await expect(items.nth(2)).toContainText("Ibuprofène");
    await expect(items.nth(2)).toContainText("1 boîte");
    await expect(items.nth(2).getByTestId("pharmacy-badge")).toHaveCount(0);
    await expect(items.nth(2).getByTestId("pharmacy-alerted")).toBeVisible();
    await expect(section.getByTestId("pharmacy-expired-note")).toHaveText("Ne prends pas un médicament périmé : demande à ton pharmacien.");
  };
  await check();
  await page.reload();
  await check();

  // Thrown away, then finished: gone, and the sentence with the last expired one.
  await section.getByTestId("pharmacy-item").nth(0).getByTestId("pharmacy-thrown").click();
  await expect(page.getByText("Sirop retiré : jeté")).toBeVisible();
  await expect(section.getByTestId("pharmacy-expired-note")).toHaveCount(0);
  // A mistake: "Annuler" in the message puts it back as it was, after a reload too.
  await page.getByTestId("toast-action").click();
  await expect(page.getByText("Sirop remis dans ta pharmacie")).toBeVisible();
  await expect(section.getByTestId("pharmacy-item")).toHaveCount(3);
  await page.reload();
  await check();
  await section.getByTestId("pharmacy-item").nth(0).getByTestId("pharmacy-thrown").click();
  await expect(section.getByTestId("pharmacy-expired-note")).toHaveCount(0);
  await section.getByTestId("pharmacy-item").nth(0).getByTestId("pharmacy-finished").click();
  await expect(section.getByTestId("pharmacy-item")).toHaveCount(1);
});

test("home pharmacy: a scanned medicine box goes in with its name, dosage and expiry", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.evaluate(async (analysis) => {
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
    const entry = { id: "box", createdAt: Date.now(), mode: "auto", thumbnail: pixel, preview: pixel, analysis, meta: { model: "demo", demo: true, durationMs: 1 } };
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
  }, mockMedicineBox("fr"));
  await page.goto("/result?id=box");
  const add = page.getByTestId("pharmacy-from-scan");
  await expect(add).toHaveText("Ajouter Paracétamol à ma pharmacie");
  await add.click();
  const form = page.getByTestId("pharmacy-form");
  await expect(form.getByTestId("pharmacy-name")).toHaveValue("Paracétamol");
  await expect(form.getByTestId("pharmacy-strength")).toHaveValue("500 mg");
  await expect(form.getByTestId("pharmacy-month")).toHaveValue("3");
  await expect(form.getByTestId("pharmacy-year")).toHaveValue("2028");
  await expect(form.getByTestId("pharmacy-day")).toHaveValue("");
  await form.getByTestId("pharmacy-save").click();
  await expect(add).toHaveText("Paracétamol est dans ta pharmacie");
  await expect(add).toBeDisabled();

  await page.goto("/sante");
  const item = page.getByTestId("pharmacy").getByTestId("pharmacy-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Paracétamol");
  await expect(item).toContainText("500 mg");
  await expect(item).toContainText("Péremption : mars 2028");
});
