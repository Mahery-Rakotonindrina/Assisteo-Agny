import { expect, test, type Page } from "@playwright/test";
import { mockPrescription } from "../../lib/ai/mock";
import { prepare } from "./helpers";

// "Ma santé": the treatments in progress (next dose, « J'ai pris », the
// week's doses), the prescriptions scanned, sharing the treatments, stopping
// them; always with the medical warning.

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

/** Today at this time (the browser's clock is set by the test). */
const today = (hour: number, minute = 0) => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
};

test("empty: what it is for, the warning, and the scan in document mode", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await expect(page.getByRole("heading", { level: 1, name: "Ma santé" })).toBeVisible();
  await expect(page.getByTestId("medicine-disclaimer")).toBeVisible();
  await expect(page.getByText("Rien pour l’instant")).toBeVisible();
  await expect(page.getByRole("link", { name: "Scanner une ordonnance" })).toHaveAttribute("href", "/?mode=document");
});

test("a prescription scanned: listed, its reminders created, followed in « En cours », ticked, shared, then stopped", async ({ page, context, isMobile }) => {
  await context.grantPermissions(["notifications"]);
  // The reminders are made at 07:00; « Ma santé » is looked at at 08:30 (the 08:00 dose gone by, the 20:00 one to come).
  await page.clock.install({ time: today(7) });
  await prepare(page);
  await pretendPlan(page, "lite");
  // What leaves the app when sharing.
  await page.addInitScript(() => {
    const sent = { shared: [] as string[] };
    (window as unknown as { sent: typeof sent }).sent = sent;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { text?: string }) => {
        sent.shared.push(data.text ?? "");
      },
    });
  });
  await seedPrescription(page);

  // Reachable from the home page (phone) or the sidebar (computer).
  await page.goto("/");
  if (isMobile) await page.getByTestId("shortcut-health").click();
  else await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ma santé" }).click();
  await expect(page).toHaveURL(/\/sante$/);

  const prescriptions = page.getByTestId("health-prescription");
  await expect(prescriptions).toHaveCount(1);
  await expect(prescriptions).toContainText("Amoxicilline, Paracétamol");
  await expect(page.getByTestId("health-treatments")).toHaveCount(0);

  // Reminders are created on the scan, confirmed there, starting today.
  await prescriptions.getByRole("link", { name: "Créer des rappels de prise" }).click();
  await expect(page).toHaveURL(/\/result\?id=rx/);
  await page.getByTestId("medication-planner").getByTestId("medication-save").click();
  await expect(page.getByText(/^Rappels créés jusqu’au/)).toBeVisible();

  await page.clock.setSystemTime(today(8, 30));
  await page.goto("/sante");
  const treatment = page.getByTestId("health-treatment");
  await expect(treatment).toHaveCount(1);
  await expect(treatment).toContainText("Amoxicilline");
  await expect(treatment).toContainText(/Jusqu’au .+ · 7 jour\(s\) restant\(s\)/);
  await expect(treatment.getByTestId("health-next")).toContainText("Prochaine prise :");
  await expect(treatment.getByTestId("health-week")).toHaveText(/^\s*0 prise\(s\) cochée\(s\) sur 1 cette semaine$/);
  // 08:00 gone by, said gently, can be ticked; 20:00 to come, not yet (no dose taken twice).
  const doses = treatment.getByTestId("health-dose");
  await expect(doses).toHaveCount(2);
  await expect(doses.nth(0)).toHaveAttribute("data-state", "missed");
  await expect(doses.nth(0)).toContainText("Pas encore cochée : si tu l’as prise, coche-la");
  await expect(doses.nth(1)).toHaveAttribute("data-state", "upcoming");
  await expect(doses.nth(1).getByTestId("health-take")).toHaveCount(0);
  await expect(prescriptions).toContainText("Rappels de prise en cours");

  // « J'ai pris » on today's first dose.
  const firstDose = treatment.getByTestId("health-dose").first();
  await firstDose.getByTestId("health-take").click();
  await expect(page.getByText("Prise cochée")).toBeVisible();
  await expect(treatment.getByTestId("health-dose").first()).toHaveAttribute("data-state", "taken");
  await expect(treatment.getByTestId("health-dose").first().getByTestId("health-take")).toHaveCount(0);
  await expect(treatment.getByTestId("health-week")).toHaveText(/^\s*1 prise\(s\) cochée\(s\) sur 1 cette semaine$/);

  // Shared: the treatments and the warning, nothing else.
  await page.getByTestId("health-share").click();
  const sent = () => page.evaluate(() => (window as unknown as { sent: { shared: string[] } }).sent.shared);
  await expect.poll(async () => (await sent()).length).toBe(1);
  const text = (await sent())[0];
  expect(text).toMatch(/^Mes traitements en cours\n\n/);
  expect(text).toContain("- Amoxicilline : 1 gélule matin et soir, à 08:00, 20:00, jusqu’au");
  expect(text).toContain("ne remplacent pas l’avis d’un médecin");

  // Stopped: asked once more, then gone from « En cours »; the prescription stays.
  await treatment.getByTestId("health-stop").click();
  await treatment.getByTestId("health-stop").click();
  await expect(page.getByTestId("health-treatments")).toHaveCount(0);
  await expect(prescriptions).toHaveCount(1);
});

test("« Ma santé » fits a 320 px phone in very large text", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
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
  await page.getByTestId("medication-save").click();
  await expect(page.getByText(/^Rappels créés jusqu’au/)).toBeVisible();
  await page.goto("/sante");
  await expect(page.getByTestId("health-treatment")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
