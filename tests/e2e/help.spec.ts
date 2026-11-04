import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// "Aide": guides, questions by topic, search. Reached from Settings and from "Découvrir".

test("the help page shows its guides and opens a question", async ({ page }) => {
  await prepare(page);
  await page.goto("/aide");
  await expect(page.getByRole("heading", { level: 1, name: "Aide" })).toBeVisible();
  await expect(page.locator("[data-guide]")).toHaveCount(4);
  const question = page.getByText("Que puis-je scanner ?");
  await expect(async () => {
    await question.click();
    await expect(page.locator("details[open]").filter({ hasText: "Que puis-je scanner ?" })).toHaveCount(1);
  }).toPass();
});

test("the search finds a question without accents and says when nothing matches", async ({ page }) => {
  await prepare(page);
  await page.goto("/aide");
  await page.getByTestId("help-search").fill("reseau");
  await expect(page.getByTestId("help-count")).toContainText("réponse");
  await expect(page.getByText("L’app marche-t-elle sans internet ?").or(page.getByText("L’app marche-t-elle sans internet"))).toBeVisible();
  await expect(page.getByTestId("help-guides")).toHaveCount(0);
  await page.getByTestId("help-search").fill("zzzzqq");
  await expect(page.getByTestId("help-count")).toContainText("Aucune réponse");
});

test("help opens from Settings and from the discover page, with nothing wider than the screen", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/settings");
  await page.getByTestId("help-link").click();
  await expect(page).toHaveURL(/\/aide$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/decouvrir");
  await page.getByTestId("discover-help").click();
  await expect(page).toHaveURL(/\/aide$/);
});
