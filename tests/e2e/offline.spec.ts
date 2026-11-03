import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// The site without internet (public/sw.js): the pages already seen open again,
// with their data (on the device), and a page never seen shows the offline page.

test.use({ serviceWorkers: "allow" });
test.describe.configure({ timeout: 120_000 });

test("offline: « Mes poches » and « Mes dépenses » open again after a first visit", async ({ page, context }) => {
  await prepare(page);
  // "Mes poches" is a paid screen; offline, the last plan known on the device is used.
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/pockets");
  const setup = page.getByRole("form", { name: "Où est ton argent ?" });
  await setup.getByLabel(/^Espèces : combien/).fill("45000");
  await setup.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("pockets-all")).toBeVisible();
  // Then "Mes dépenses", opened from the app (no full load).
  await page.getByRole("link", { name: /Voir mes dépenses/ }).first().click();
  await expect(page).toHaveURL(/\/expenses/);
  await expect(page.getByTestId("expenses-tab-hint")).toBeVisible();

  // The worker has taken over and kept both pages with their files.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const names = await caches.keys();
          const cache = await caches.open(names.find((name) => name.startsWith("assisteo-offline-")) ?? "none");
          return Boolean((await cache.match("/pockets")) && (await cache.match("/expenses")));
        }),
      { timeout: 20_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("expenses-tab-hint")).toBeVisible();
  await page.goto("/pockets");
  await expect(page.getByTestId("pockets-all")).toContainText(/45\s000 Ar/);

  // A page never opened here: the offline page, not the browser's error.
  await page.goto("/plants");
  await expect(page.getByRole("heading", { name: "Tu es hors ligne" })).toBeVisible();

  await context.setOffline(false);
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { name: "Tu es hors ligne" })).toHaveCount(0);
});
