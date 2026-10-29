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
    await route.fulfill({ response, json: { ...(await response.json()), plan: "premium", features: undefined } });
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
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
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

test("My expenses explains each tab, adds an expense in 3 steps and an income, and sets the budget", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/expenses");
  // The welcome card, until closed.
  const welcome = page.getByRole("region", { name: "Bienvenue dans Mes dépenses" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Fermer" }).click();
  await expect(welcome).toHaveCount(0);

  // Each tab says what it is for; an empty one explains itself.
  const hint = page.getByTestId("expenses-tab-hint");
  await expect(hint).toHaveText("Tout ce que tu as dépensé ce mois-ci.");
  await page.getByRole("radio", { name: "Fixes", exact: true }).click();
  await expect(hint).toContainText("Ce que tu paies chaque mois");
  await expect(page.getByText("Rien de fixe pour l’instant")).toBeVisible();
  await page.getByRole("radio", { name: "Historique", exact: true }).click();
  await expect(hint).toHaveText("Tes mois d’avant, pour comparer.");

  // An expense in 3 steps: the button, the amount, save.
  await page.getByRole("radio", { name: "Mois", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("12000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/^Dépense ajoutée : 12\s000 Ar/)).toBeVisible();
  await expect(page.getByTestId("expenses-total")).toHaveText(/^12\s000 Ar$/);
  await expect(page.getByTestId("expenses-left")).toHaveText(/12\s000 Ar$/);

  // An income: what is left changes.
  await page.getByRole("radio", { name: "Revenus", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un revenu" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("50000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("expenses-left")).toHaveText(/^38\s000 Ar$/);

  // The budget, in its sheet.
  await page.getByRole("radio", { name: "Budget", exact: true }).click();
  await page.getByRole("button", { name: "Fixer mon budget" }).click();
  const sheet = page.getByRole("dialog", { name: "Fixer mon budget" });
  await sheet.getByLabel("Budget total").fill("15000");
  await sheet.getByRole("button", { name: "Enregistrer" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("budget-bars")).toContainText(/12\s000 Ar \/ 15\s000 Ar/);
  await expect(page.getByText(/^80 % de ton budget/)).toBeVisible();

  // The welcome card does not come back.
  await page.reload();
  await expect(page.getByTestId("expenses-tab-hint")).toBeVisible();
  await expect(welcome).toHaveCount(0);
});

test("My pockets: two pockets, an expense from MVola, a move between them and a corrected balance", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/expenses");

  // The first time: where the money is.
  await page.getByRole("button", { name: /Où est ton argent \?/ }).click();
  const setup = page.getByRole("dialog", { name: "Où est ton argent ?" });
  await setup.getByLabel(/^Espèces : combien/).fill("45000");
  await setup.getByRole("checkbox", { name: "MVola" }).check();
  await setup.getByLabel(/^MVola : combien/).fill("230000");
  await setup.getByRole("button", { name: "Enregistrer" }).click();
  const pockets = page.getByTestId("pockets");
  await expect(page.getByTestId("pockets-total")).toHaveText(/^275\s000 Ar$/);
  await expect(pockets).toHaveText(/^Espèces 45\s000 Ar · MVola 230\s000 Ar$/);

  // An expense paid with MVola: its balance goes down, "Il te reste" as before.
  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("12000");
  await page.getByRole("radio", { name: "MVola" }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(pockets).toHaveText(/MVola 218\s000 Ar$/);
  await expect(page.getByTestId("expenses-total")).toHaveText(/^12\s000 Ar$/);

  // A move from MVola to cash, with its fees (an expense).
  await page.getByRole("button", { name: "Voir mes poches" }).click();
  const sheet = page.getByRole("dialog", { name: "Mes poches" });
  await sheet.getByRole("button", { name: "Virement entre mes poches" }).click();
  const move = page.getByRole("dialog", { name: "Virement entre mes poches" });
  await move.getByRole("radiogroup", { name: "De" }).getByRole("radio", { name: "MVola" }).click();
  await move.getByLabel("Montant", { exact: true }).fill("50000");
  await move.getByLabel(/^Frais/).fill("1000");
  await move.getByRole("button", { name: "Enregistrer" }).click();
  await expect(pockets).toHaveText(/^Espèces 95\s000 Ar · MVola 167\s000 Ar$/);
  await expect(page.getByTestId("expenses-total")).toHaveText(/^13\s000 Ar$/);

  // "Corriger le solde": the real MVola balance.
  await page.getByRole("dialog", { name: "Mes poches" }).getByRole("button", { name: /^MVola/ }).click();
  await page.getByRole("dialog", { name: "Mes poches" }).getByRole("button", { name: "Corriger le solde" }).click();
  await page.getByLabel(/^Ton solde MVola est en vrai de/).fill("170000");
  await page.getByRole("dialog", { name: "Corriger le solde" }).getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/^Solde corrigé : \+3\s000 Ar/)).toBeVisible();
  await expect(pockets).toHaveText(/MVola 170\s000 Ar$/);
  await expect(page.getByTestId("expenses-total")).toHaveText(/^13\s000 Ar$/);
});

test("My expenses: the forecast, a search over every month, and a result opened", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/expenses");
  await page.getByRole("radio", { name: "Revenus", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un revenu" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("300000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByRole("radio", { name: "Mois", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("45000");
  await page.getByLabel("Note", { exact: true }).fill("Facture JIRAMA");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("expenses-total")).toHaveText(/^45\s000 Ar$/);

  // The forecast: the current month, from its 3rd day.
  const forecast = page.getByTestId("expenses-forecast");
  if (new Date().getDate() >= 3) {
    await expect(forecast).toHaveText(/^À ce rythme, il te (restera|manquera) environ .+ le \d+\.$/);
    await page.getByRole("button", { name: "Comment c’est calculé ?" }).click();
    await expect(page.getByText(/^Aujourd’hui, il te reste 255\s000 Ar\.$/)).toBeVisible();
  } else await expect(forecast).toHaveCount(0);

  // The search, from the header: found without the case, then opened in its form.
  await page.getByRole("button", { name: "Chercher", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Chercher" });
  await search.getByLabel("Chercher une dépense ou un revenu").fill("jirama");
  await expect(search.getByTestId("search-count")).toHaveText(/^1 résultat\(s\) · 45\s000 Ar$/);
  await search.getByRole("button", { name: /Facture JIRAMA/ }).click();
  await expect(search).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Modifier" }).getByLabel("Note", { exact: true })).toHaveValue("Facture JIRAMA");
});

test("Savings and tontine: a goal, money set aside from a pocket, a tontine and its payment", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/expenses");
  await page.getByRole("button", { name: /Où est ton argent \?/ }).click();
  const setup = page.getByRole("dialog", { name: "Où est ton argent ?" });
  await expect(setup.getByText(/^Espèces est ta poche par défaut/)).toBeVisible();
  await setup.getByLabel(/^Espèces : combien/).fill("45000");
  await setup.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("pockets-total")).toHaveText(/^45\s000 Ar$/);

  // A goal, then money set aside: it leaves the pocket, "Il te reste" doesn't move.
  await page.getByRole("button", { name: /Mettre de l’argent de côté/ }).click();
  await page.getByRole("dialog", { name: "Épargne et tontines" }).getByRole("button", { name: "Objectif", exact: true }).click();
  const goal = page.getByRole("dialog", { name: "Objectif d’épargne" });
  await goal.getByLabel("Nom", { exact: true }).fill("Rentrée scolaire");
  await goal.getByLabel("Montant visé").fill("300000");
  await goal.getByRole("button", { name: "Enregistrer" }).click();
  const list = page.getByRole("dialog", { name: "Épargne et tontines" });
  await list.getByRole("button", { name: "Mettre de côté" }).click();
  const deposit = page.getByRole("dialog", { name: "Mettre de côté" });
  await deposit.getByLabel("Montant", { exact: true }).fill("20000");
  await deposit.getByRole("button", { name: "Enregistrer" }).click();
  await expect(list.getByTestId("goal-progress")).toHaveText(/^20\s000 Ar \/ 300\s000 Ar$/);
  await expect(page.getByTestId("pockets-total")).toHaveText(/^25\s000 Ar$/);
  await expect(page.getByTestId("savings-total")).toHaveText(/^20\s000 Ar$/);
  await expect(page.getByTestId("expenses-total")).toHaveText(/^0 Ar$/);

  // A tontine and its first payment.
  await list.getByRole("button", { name: "Tontine", exact: true }).click();
  const tontine = page.getByRole("dialog", { name: "Tontine" });
  await tontine.getByLabel("Nom", { exact: true }).fill("Tontine du quartier");
  await tontine.getByLabel("Montant de chaque versement").fill("20000");
  await tontine.getByLabel("Nombre de membres").fill("12");
  await tontine.getByLabel("Mon tour (n°)").fill("3");
  await expect(tontine.getByText(/^Tu recevras la cagnotte de 240\s000 Ar le/)).toBeVisible();
  await tontine.getByRole("button", { name: "Enregistrer" }).click();
  await list.getByRole("button", { name: "Noter un versement" }).click();
  await page.getByRole("dialog", { name: "Versement de la tontine" }).getByRole("button", { name: "Enregistrer" }).click();
  await expect(list.getByTestId("tontine-status")).toHaveText(/^Tu as versé 20\s000 Ar · Tu recevras 240\s000 Ar le/);
  await expect(page.getByTestId("savings-total")).toHaveText(/^40\s000 Ar$/);
  await expect(page.getByTestId("pockets-total")).toHaveText(/^5\s000 Ar$/);

  // Deleting the goal is asked first: its money comes back to the pocket.
  await list.getByTestId("savings-goal").getByRole("button", { name: "Modifier" }).click();
  const editGoal = page.getByRole("dialog", { name: "Objectif d’épargne" });
  await editGoal.getByRole("button", { name: "Supprimer" }).click();
  await expect(editGoal.getByTestId("savings-remove-question")).toHaveText(/^Supprimer « Rentrée scolaire » \? Les 20\s000 Ar mis de côté reviendront dans tes poches\.$/);
  await editGoal.getByRole("button", { name: "Annuler" }).click();
  await expect(editGoal.getByTestId("savings-remove-question")).toBeHidden();
  await editGoal.getByRole("button", { name: "Supprimer" }).click();
  await editGoal.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(list.getByTestId("savings-goal")).toHaveCount(0);
  await expect(page.getByTestId("savings-total")).toHaveText(/^20\s000 Ar$/);
  await expect(page.getByTestId("pockets-total")).toHaveText(/^25\s000 Ar$/);
});

test("a reseller keeps the activity apart from the home budget and sees the month's profit", async ({ page }) => {
  await prepare(page);
  // Admin has "expenses" and "reseller".
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/");
  // Two parcels this month: a dress sold to Rado (cost 80 000, sold 130 000, 30 000 still owed), a bag in stock (cost 50 000).
  await page.evaluate(async () => {
    const now = Date.now();
    const info = { platform: null, orderNumber: null, trackingNumber: null, carrier: null, status: "in_transit", statusLabel: "En transit", lastEvent: null, items: [], total: null, seller: null, orderedAt: null, shippedAt: null, estimatedDelivery: null, destinationCity: null, shippingMode: null };
    const base = { info, scanIds: [], timeline: [], createdAt: now, updatedAt: now, fees: [] };
    const parcels = [
      { ...base, id: "dress", title: "Robe rouge", client: "Rado", priceMga: 80000, salePriceMga: 130000, paidMga: 100000, soldAt: now },
      { ...base, id: "bag", title: "Sac", forResale: true, priceMga: 50000 },
    ];
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("assisteo-parcels");
      request.onupgradeneeded = () => request.result.createObjectStore("parcels");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("parcels", "readwrite");
        for (const parcel of parcels) tx.objectStore("parcels").put(parcel, parcel.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.goto("/expenses");
  // Off by default: the purchases are expenses, the sale an income (as before).
  await expect(page.getByTestId("expenses-total")).toHaveText(/^130\s000 Ar$/);
  await expect(page.getByTestId("expenses-in")).toHaveText(/^130\s000 Ar$/);
  await expect(page.getByTestId("activity-line")).toHaveText(/Mon activité : bénéfice du mois \+50\s000 Ar/);

  await page.getByTestId("activity-line").click();
  const sheet = page.getByTestId("activity-sheet");
  await expect(sheet.getByTestId("activity-profit")).toHaveText(/^50\s000 Ar$/);
  await expect(sheet.getByText("À encaisser (toutes ventes)", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Rado", { exact: true })).toBeVisible();
  await sheet.getByRole("switch", { name: "Séparer mon activité de revente du budget de la maison" }).click();
  await expect(sheet.getByText(/^Activé : tes colis à revendre/)).toBeVisible();
  await page.keyboard.press("Escape");

  // On: the parcels leave the budget, only the month's profit comes in.
  await expect(page.getByTestId("expenses-total")).toHaveText(/^0 Ar$/);
  await expect(page.getByTestId("expenses-in")).toHaveText(/^50\s000 Ar$/);
  await page.getByRole("radio", { name: "Revenus" }).click();
  await expect(page.getByText("Bénéfice de mon activité")).toBeVisible();
  await expect(page.getByText("Ajouté tout seul · Activité")).toBeVisible();
});

test("an Admin account gets the month's review (demo)", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("20000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByRole("button", { name: "Bilan du mois" }).click();
  const review = page.getByTestId("month-review");
  await expect(review.getByText(/^Tu as dépensé 20\s000 Ar ce mois-ci\.$/)).toBeVisible({ timeout: 15_000 });
  await expect(review.getByText(/Bilan d’exemple \(mode démo\)/)).toBeVisible();
  // Kept on the device.
  await page.reload();
  await expect(page.getByTestId("month-review").getByText(/^Tu as dépensé/)).toBeVisible();
});

test("without the Admin plan, My expenses is not in the menu and its page only offers to join a household", async ({ page }) => {
  await prepare(page);
  // Once the plan is known (free), the menu is final.
  const plan = page.waitForResponse("**/api/plan");
  await page.goto("/");
  await plan;
  await expect(page.getByRole("link", { name: /Mes dépenses|^Dépenses$/ })).toHaveCount(0);
  // Signed in, without a household (the demo server has no accounts).
  await page.route("**/api/household", (route) => route.fulfill({ json: { userId: "11111111-1111-4111-8111-111111111111", household: null } }));
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { level: 1, name: "Budget du foyer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rejoindre un foyer" })).toBeVisible();
  await expect(page.getByText("Créer un foyer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ajouter une dépense" })).toHaveCount(0);
});

test("an Admin account creates a household and sees its invitation code", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  // The household's server, as Supabase would answer it.
  const userId = "11111111-1111-4111-8111-111111111111";
  let household: unknown = null;
  await page.route("**/api/household", async (route) => {
    const body = route.request().postDataJSON() as { action?: string; name?: string } | null;
    if (body?.action === "create")
      household = { id: "h1", name: body.name, role: "owner", budget: { categories: {} }, members: [{ userId, role: "owner", joinedAt: new Date().toISOString(), label: "an…@example.com" }], invite: null };
    if (body?.action === "invite" && household) household = { ...(household as object), invite: { code: "4K7P2Q", expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString() } };
    await route.fulfill({ json: { userId, household } });
  });
  await page.goto("/expenses");
  await page.getByRole("radio", { name: "Foyer" }).click();
  await page.getByLabel("Nom du foyer").fill("Famille Rabe");
  await page.getByRole("button", { name: "Créer le foyer" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Famille Rabe" })).toBeVisible();
  await page.getByRole("button", { name: "Créer un code" }).click();
  await expect(page.getByTestId("household-code")).toHaveText("4K7-P2Q");
  // A shared expense counts in the household's month.
  await page.getByRole("button", { name: "Ajouter une dépense du foyer" }).click();
  const form = page.getByRole("form", { name: "Dépense" });
  await form.getByLabel("Montant", { exact: true }).fill("45000");
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("household-total")).toHaveText(/^45\s000 Ar$/);
});

test("back on the free plan, the vehicles stay visible but read only", async ({ page }) => {
  await prepare(page);
  const premium = async (route: import("@playwright/test").Route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "premium", features: undefined } });
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

test("the app follows the plans' features set in Admin: a Premium without My garage", async ({ page }) => {
  await prepare(page);
  // As the server answers once the owner unticked My garage for Premium (it stays in Pro).
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({
      response,
      json: { ...json, plan: "premium", features: ["reminders", "parcelCosts", "pdfExport", "ownKey", "deepAnalysis", "multiPage"], featureFrom: { ...json.featureFrom, garage: "pro" } },
    });
  });
  await page.goto("/garage");
  await expect(page.getByText("Mon garage est inclus à partir de Pro.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un véhicule" })).toHaveCount(0);
});

test("a feature switched off for everyone shows no plan to buy", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, featureFrom: { ...json.featureFrom, garage: null } } });
  });
  await page.goto("/garage");
  await expect(page.getByText("Cette fonction n’est pas disponible pour le moment.")).toBeVisible();
});

test("the admin shows the features table, and the changes before saving", async ({ page }) => {
  await prepare(page);
  await page.goto("/admin");
  await page.locator("#admin-token").fill("e2e-admin-token-0123456789");
  await page.getByRole("button", { name: "Déverrouiller" }).click();
  const table = page.getByRole("region", { name: "Fonctionnalités par offre" });
  await expect(table.getByRole("heading", { name: "Fonctionnalités par offre" })).toBeVisible();
  const garagePremium = table.getByRole("checkbox", { name: "Mon garage · Premium" });
  await expect(garagePremium).toBeChecked();
  await expect(table.getByRole("checkbox", { name: "Mon garage · Lite" })).not.toBeChecked();

  // Unticking the parcels' costs in Pro asks about the reseller tools.
  await table.getByRole("checkbox", { name: "Coûts des colis · Pro" }).click();
  await expect(table.getByText("Dans Pro, Outils revendeur a besoin de « Coûts des colis ». Décocher aussi ?")).toBeVisible();
  await table.getByRole("button", { name: "Annuler" }).click();
  await expect(table.getByRole("checkbox", { name: "Coûts des colis · Pro" })).toBeChecked();

  // Nothing is saved here: the tests share one server.
  await garagePremium.uncheck();
  await table.getByRole("button", { name: "Voir les changements" }).click();
  await expect(table.getByRole("region", { name: "Avant d’enregistrer" })).toContainText("− Mon garage");
  await expect(table.getByRole("button", { name: "Confirmer et enregistrer" })).toBeVisible();
});

test("a Premium who kept expenses still finds the expenses link, one without has none", async ({ page }) => {
  await prepare(page);
  let plan = "premium";
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
  const link = page.getByRole("link", { name: /Mes dépenses|^Dépenses$/ });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Historique" }).first()).toBeVisible();
  await expect(link).toHaveCount(0);
  plan = "unlimited";
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Ajouter une dépense" }).click();
  await page.getByLabel("Montant", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("expenses-total")).toBeVisible();
  // The feature is taken away: the kept expenses stay reachable.
  plan = "premium";
  await page.goto("/");
  await expect(link.first()).toBeVisible();
});
