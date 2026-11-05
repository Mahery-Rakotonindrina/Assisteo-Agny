import { expect, test, type Page } from "@playwright/test";
import { mockPrescription } from "../../lib/ai/mock";
import { prepare } from "./helpers";

// A scanned prescription: what it says with the medical warning, and the
// dose reminders created only once the user confirms them (Lite and up).

async function pretendPlan(page: Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
}

/** The demo prescription, as a scan already in the history. */
async function seedPrescription(page: Page) {
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
}

test("a prescription shows the warning, the doses as written, and dose reminders once confirmed", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  await prepare(page);
  await pretendPlan(page, "lite");
  await seedPrescription(page);
  await page.goto("/result?id=rx");

  // It opens on the medicines, with the warning.
  await expect(page.getByRole("tab", { name: "Médicaments" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("medicine-disclaimer").first()).toHaveText(/ne remplacent pas l’avis d’un médecin ou d’un pharmacien/);
  await expect(page.getByTestId("medicine-unreadable")).toHaveText(/Le nom du médecin n'est pas lisible/);
  const items = page.getByTestId("medicine-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("1 gélule matin et soir");
  await expect(items.nth(0)).toContainText("7 jour(s)");
  // Not written: never filled in.
  await expect(items.nth(1)).toContainText("Pas écrite sur la photo");
  await expect(items.nth(1)).toContainText("Contre-indications courantes (informations générales)");

  // Nothing is created before the user confirms.
  const planner = page.getByTestId("medication-planner");
  const courses = planner.getByTestId("medication-course");
  await expect(courses.nth(0).getByRole("checkbox")).toBeChecked();
  await expect(courses.nth(1).getByRole("checkbox")).not.toBeChecked();
  await expect(courses.nth(0).getByLabel("Heure de la prise 1")).toHaveValue("08:00");
  await expect(courses.nth(0).getByLabel("Heure de la prise 2")).toHaveValue("20:00");
  // The paracetamol without a written duration: it can't be saved until one is typed.
  await courses.nth(1).getByRole("checkbox").check();
  await expect(planner.getByTestId("medication-save")).toBeDisabled();
  await courses.nth(1).getByRole("checkbox").uncheck();
  await planner.getByTestId("medication-save").click();
  await expect(page.getByText(/^Rappels créés jusqu’au/)).toBeVisible();

  const active = page.getByTestId("medication-active");
  await expect(active).toContainText(/Rappels de prise jusqu’au/);
  await expect(active).toContainText("À 08:00, 20:00, pendant 7 jour(s)");
  // Kept on the scan: still there after a reload.
  await page.reload();
  await expect(page.getByTestId("medication-active")).toBeVisible();

  await page.getByRole("button", { name: "Arrêter les rappels" }).click();
  await page.getByRole("button", { name: "Oui, arrêter les rappels" }).click();
  await expect(page.getByTestId("medication-planner")).toBeVisible();
});

test("without the reminders, the medicines and the warning stay, the reminders show their plan", async ({ page }) => {
  await prepare(page);
  await seedPrescription(page);
  await page.goto("/result?id=rx");
  await expect(page.getByTestId("medicine-disclaimer").first()).toBeVisible();
  await expect(page.getByTestId("medicine-item")).toHaveCount(2);
  await expect(page.getByText(/^Les rappels de prise : avec l’offre/)).toBeVisible();
  await expect(page.getByTestId("medication-planner")).toHaveCount(0);
  // The summary carries the warning too.
  await page.getByRole("tab", { name: "Résumé" }).click();
  await expect(page.getByTestId("medicine-disclaimer")).toBeVisible();
});

test("the medicines fit a 320 px phone in very large text", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const key = "CapacitorStorage.settings.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, textSize: "xlarge", onboardingDone: true }));
  });
  await pretendPlan(page, "lite");
  await page.setViewportSize({ width: 320, height: 640 });
  await seedPrescription(page);
  await page.goto("/result?id=rx");
  await expect(page.getByTestId("medication-planner")).toBeVisible();
  // Once the cards have risen in (an animation may stick out for a moment).
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
