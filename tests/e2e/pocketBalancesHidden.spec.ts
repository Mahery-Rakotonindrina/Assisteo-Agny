import { expect, test } from "@playwright/test";
import { prepare, setUpPockets } from "./helpers";

// "Mes poches": the balances shown as ************ (the eye, one pocket), kept on the device (demo).

const STARS = "************";

test.beforeEach(async ({ page }) => {
  await prepare(page);
  // "Mes dépenses" needs a plan with it: the demo server answers "free".
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await setUpPockets(page, { cash: "45000", mvola: "230000" });
});

test("the eye hides every balance, the summary of Mes dépenses too, and shows them again", async ({ page }) => {
  await page.goto("/pockets");
  await expect(page.getByTestId("pockets-all")).toHaveText(/^275\s000 Ar$/);
  await page.getByRole("button", { name: "Masquer les soldes" }).click();
  await expect(page.getByTestId("pockets-all")).toContainText(STARS);
  await expect(page.getByTestId("wallet-balance")).toHaveText([/^\*{12}/, /^\*{12}/]);
  await expect(page.getByTestId("pockets-all")).not.toContainText("275");

  await page.goto("/expenses");
  await expect(page.getByTestId("pockets-total")).toContainText(STARS);
  await expect(page.getByTestId("pockets-row").first()).toContainText(STARS);
  await expect(page.getByTestId("pockets-row").first()).not.toContainText("45");

  await page.goto("/pockets");
  await page.getByRole("button", { name: "Afficher les soldes" }).click();
  await expect(page.getByTestId("pockets-all")).toHaveText(/^275\s000 Ar$/);
});

test("one pocket's balance is hidden from its menu: its card, its sheet, the total; the movements stay", async ({ page }) => {
  await page.goto("/pockets");
  await page.getByTestId("pocket-card").filter({ hasText: "MVola" }).click();
  const detail = page.getByTestId("pocket-detail");
  await expect(detail.getByTestId("pocket-balance")).toHaveText(/^230\s000 Ar$/);
  await detail.getByTestId("pocket-more").click();
  await page.getByRole("button", { name: "Masquer son solde" }).click();
  await expect(detail.getByTestId("pocket-balance")).toContainText(STARS);
  await expect(detail.getByTestId("pocket-start")).toContainText(STARS);
  await expect(detail.getByTestId("pocket-start")).not.toContainText("230");

  // Only a phone has a "back" button: on a desktop the list stays beside the sheet.
  const back = detail.getByRole("button", { name: /Toutes mes poches/ });
  if (await back.count()) await back.click();
  await expect(page.getByTestId("pocket-card").filter({ hasText: "MVola" })).toContainText(STARS);
  await expect(page.getByTestId("pocket-card").filter({ hasText: "Espèces" })).toContainText(/45\s000 Ar/);
  // A hidden pocket keeps the total hidden.
  await expect(page.getByTestId("pockets-all")).toContainText(STARS);

  // The menu now offers to show it again.
  await page.getByTestId("pocket-card").filter({ hasText: "MVola" }).click();
  await detail.getByTestId("pocket-more").click();
  await page.getByRole("button", { name: "Afficher son solde" }).click();
  await expect(detail.getByTestId("pocket-balance")).toHaveText(/^230\s000 Ar$/);
});

test("the choice is kept after a reload, with no flash of the real amount", async ({ page }) => {
  await page.goto("/pockets");
  await page.getByRole("button", { name: "Masquer les soldes" }).click();
  await expect(page.getByTestId("pockets-all")).toContainText(STARS);
  await page.reload();
  // Never the real amount, not even for one frame.
  await expect(page.getByTestId("pockets-all")).toContainText(STARS);
  await expect(page.getByTestId("pockets-all")).not.toContainText("275");
  await expect(page.getByRole("button", { name: "Afficher les soldes" })).toBeVisible();
});
