import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Home shortcuts: hide, reorder, survive a reload, reset, hide all, open from Settings.

const nav = (page: Page) => page.getByRole("navigation", { name: "Raccourcis" });
const hrefs = (page: Page) => nav(page).locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));

test.beforeEach(async ({ page }) => {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
  await prepare(page);
});

test("hide one, move another, reload, then reset", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page)).toBeVisible();
  const initial = (await hrefs(page)) as string[];
  expect(initial.length).toBeGreaterThan(3);
  const sheet = page.getByRole("dialog");
  await expect(async () => {
    await page.getByRole("button", { name: "Modifier les raccourcis" }).click();
    await expect(sheet).toBeVisible({ timeout: 1500 });
  }).toPass();
  await sheet.locator("[data-move='plants:-1']").click();
  await sheet.getByRole("switch", { name: /Afficher .*Garage|Afficher .*garage/i }).click();
  await expect(sheet.locator("[role=status]")).toContainText(/place \d+ sur \d+/);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  const after = (await hrefs(page)) as string[];
  expect(after).not.toContain("/garage");
  // Plants went up one place before garage was hidden: one place above where it would have been.
  const withoutGarage = initial.filter((href) => href !== "/garage");
  expect(after.indexOf("/plants")).toBe(withoutGarage.indexOf("/plants") - 1);
  await page.reload();
  await expect(nav(page)).toBeVisible();
  expect(await hrefs(page)).toEqual(after);
  await page.getByRole("button", { name: "Modifier les raccourcis" }).click();
  await sheet.getByRole("button", { name: "Remettre par défaut" }).click();
  await page.keyboard.press("Escape");
  expect(await hrefs(page)).toEqual(initial);
});

test("hiding everything shows the message, scan stays; Settings opens the same sheet", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page)).toBeVisible();
  await page.getByRole("button", { name: "Modifier les raccourcis" }).click();
  const sheet = page.getByRole("dialog");
  const switches = sheet.getByRole("switch");
  const n = await switches.count();
  for (let i = 0; i < n; i++) await switches.nth(i).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("main p", { hasText: /Tous tes raccourcis sont cachés/ }).first()).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Modifier les raccourcis" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
