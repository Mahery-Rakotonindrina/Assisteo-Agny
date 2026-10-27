import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

test("settings link to the privacy policy and the terms", async ({ page }) => {
  await prepare(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: "Politique de confidentialité" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeVisible();
  await page.getByRole("link", { name: "Conditions d’utilisation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Conditions d’utilisation" })).toBeVisible();
});

test("the chosen text size applies to the whole app and is kept", async ({ page }) => {
  await prepare(page);
  await page.goto("/settings");
  const root = page.locator("html");
  const sizes = page.getByRole("radiogroup", { name: "Taille du texte" });
  // A click before the page is interactive does nothing: try again until it takes.
  await expect(async () => {
    await sizes.getByRole("radio", { name: "Très grand" }).click();
    await expect(root).toHaveAttribute("data-text-size", "xlarge", { timeout: 1000 });
  }).toPass();
  // Applied before the first paint on the next start, and never dropped while the app starts.
  await page.addInitScript(() => {
    new MutationObserver((records) => {
      if (records.some((record) => record.oldValue && !document.documentElement.dataset.textSize)) Object.assign(window, { textSizeDropped: true });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-size"], attributeOldValue: true });
  });
  await page.goto("/");
  await expect(root).toHaveAttribute("data-text-size", "xlarge");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("20px");
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => "textSizeDropped" in window)).toBe(false);
  await page.goto("/settings");
  await expect(async () => {
    await sizes.getByRole("radio", { name: "Normal" }).click();
    await expect(root).not.toHaveAttribute("data-text-size", { timeout: 1000 });
  }).toPass();
});

test("the onboarding never covers the legal pages", async ({ page }) => {
  await prepare(page, { onboardingDone: false });
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeVisible();
  await expect(page.getByText("Bienvenue")).toHaveCount(0);
});

test("the admin page asks for the token", async ({ page }) => {
  await prepare(page);
  await page.goto("/admin");
  await expect(page.locator("#admin-token")).toBeVisible();
});

test("new users can open example results before their first scan", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Un repas" }).click();
  await expect(page).toHaveURL(/\/result\?example=food/);
  await expect(page.getByText("Exemple d’analyse")).toBeVisible();
  // Read-only: no question tab, and the call to action leads to the scanner.
  await expect(page.getByRole("tab", { name: "Question" })).toHaveCount(0);
  await page.getByRole("link", { name: "Faire mon premier scan" }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test("the scanned photo opens full screen and closes with Escape or back", async ({ page }) => {
  await prepare(page);
  await page.goto("/result?example=food");
  await page.getByRole("button", { name: "Agrandir la photo" }).click();
  const viewer = page.getByRole("dialog", { name: "Bol de salade composée" });
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/photo=1/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(/\/result\?example=food$/);

  await page.getByRole("button", { name: "Agrandir la photo" }).click();
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(/\/result\?example=food$/);
});

test("the discover page shows its title and opens a question", async ({ page }) => {
  await prepare(page);
  await page.goto("/decouvrir");
  await expect(page.getByRole("heading", { level: 1, name: /L’IA qui t’explique/ })).toBeVisible();
  const question = page.getByText("Faut-il créer un compte ?");
  await expect(async () => {
    await question.click();
    await expect(page.locator("details[open]").filter({ hasText: "Faut-il créer un compte ?" })).toHaveCount(1);
  }).toPass();
});

test("a newcomer finds the discover page from the home screen", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  // Under the intro on a computer, under the examples on a phone: only one shows.
  const link = page.getByRole("link", { name: "Découvrir tout ce que fait l’app" });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/decouvrir$/);
});

test("a free account sees My garage with the Premium label", async ({ page }) => {
  await prepare(page);
  await page.goto("/garage");
  await expect(page.getByRole("heading", { level: 1, name: "Mon garage" })).toBeVisible();
  await expect(page.getByText("Mon garage est inclus à partir de Premium.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir les offres" }).first()).toBeVisible();
});

test("a Premium account adds a vehicle and two fills, and sees the consumption", async ({ page }) => {
  await prepare(page);
  // The demo server answers "free": pretend the account is Premium.
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "premium" } });
  });
  await page.goto("/garage");
  await page.getByRole("button", { name: "Ajouter un véhicule" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("La Corolla");
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "La Corolla" })).toBeVisible();

  await page.getByRole("radio", { name: "Pleins" }).click();
  for (const [km, litres] of [["10000", "40"], ["10500", "35"]]) {
    await page.getByRole("button", { name: "Ajouter un plein" }).click();
    await page.getByLabel("Kilométrage", { exact: true }).fill(km);
    await page.getByLabel("Litres", { exact: true }).fill(litres);
    await page.getByRole("button", { name: "Enregistrer" }).click();
  }
  // 35 litres over 500 km.
  await expect(page.getByTestId("fuel-last")).toHaveText("7 L");
});

test("an Admin account adds an expense and sees the month's total", async ({ page }) => {
  await prepare(page);
  // The demo server answers "free": pretend the account is Admin.
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited" } });
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Mes dépenses|^Dépenses$/ }).first()).toBeVisible();
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { level: 1, name: "Mes dépenses" })).toBeVisible();
  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("12500");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("expenses-total")).toHaveText(/^12\s500 Ar$/);
});

test("without the Admin plan, My expenses is neither in the menu nor on its page", async ({ page }) => {
  await prepare(page);
  // Once the plan is known (free), the menu is final.
  const plan = page.waitForResponse("**/api/plan");
  await page.goto("/");
  await plan;
  await expect(page.getByRole("link", { name: /Mes dépenses|^Dépenses$/ })).toHaveCount(0);
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Pas disponible" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter une dépense" })).toHaveCount(0);
});

test("back on the free plan, the vehicles stay visible but read only", async ({ page }) => {
  await prepare(page);
  const premium = async (route: import("@playwright/test").Route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "premium" } });
  };
  await page.route("**/api/plan", premium);
  await page.goto("/garage");
  await page.getByRole("button", { name: "Ajouter un véhicule" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("La Corolla");
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "La Corolla" })).toBeVisible();

  // The subscription ended: the demo server answers "free" again.
  await page.unroute("**/api/plan", premium);
  await page.goto("/garage");
  await expect(page.getByText("Ton offre ne comprend plus Mon garage", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un véhicule" })).toHaveCount(0);
  await page.getByRole("button", { name: /La Corolla/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "La Corolla" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Modifier" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Pleins" }).click();
  await expect(page.getByRole("button", { name: "Ajouter un plein" })).toHaveCount(0);
});
