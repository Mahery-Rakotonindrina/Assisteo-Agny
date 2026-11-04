import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockAnalysis } from "../../lib/ai/mock";
import type { Analysis } from "../../lib/ai/schema";
import { prepare } from "./helpers";

// After a scan, the note of a parcel already followed and the line of the
// shopping list made from a recipe open what they talk about when touched
// anywhere, not only on their small link.

test.describe.configure({ timeout: 120_000 });
test.skip(({ isMobile }) => isMobile, "The desktop drop zone exposes a plain file input.");

/** Any photo comes back as this analysis. */
async function scanAs(page: Page, analysis: Analysis) {
  await page.route("**/api/analyze", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), analysis } });
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
  await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
}

/** A tap near the left edge of the box (on the text, away from the link), until it leads to `url` (the note may still move in). */
async function tapAside(target: Locator, url: RegExp) {
  const page = target.page();
  await expect(async () => {
    await target.scrollIntoViewIfNeeded();
    const found = await target.boundingBox();
    if (!found) throw new Error("not shown");
    await page.mouse.click(found.x + 12, found.y + found.height / 2);
    await expect(page).toHaveURL(url, { timeout: 1_500 });
  }).toPass({ timeout: 10_000 });
}

test("the note of a followed parcel opens it in « Mes colis »", async ({ page }) => {
  await prepare(page);
  // The demo's parcel: the "auto" examples take turns.
  let parcel = mockAnalysis("auto", "fr");
  while (parcel.category !== "parcel") parcel = mockAnalysis("auto", "fr");
  await scanAs(page, parcel);
  await page.getByRole("tab", { name: "Colis" }).click();
  await page.getByRole("button", { name: "Ajouter à mes colis" }).first().click();
  const note = page.getByText(/Ce colis est dans ta liste/);
  await expect(note).toBeVisible();
  // Without the toast (at the top of the screen) over the note.
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 6_000 });
  await tapAside(note, /\/parcels\?open=/);
  await expect(page.getByRole("button", { name: /Casque moto/ })).toHaveAttribute("aria-expanded", "true");
});

test("the line « Ingrédients dans … » opens the shopping list", async ({ page }) => {
  await prepare(page);
  await scanAs(page, mockAnalysis("food", "fr"));
  await page.getByRole("tab", { name: "Recette" }).click();
  await page.getByRole("button", { name: "Ajouter les ingrédients à une liste de courses" }).click();
  const line = page.getByText(/Ingrédients dans «/);
  await expect(line).toBeVisible();
  await tapAside(line, /\/lists\?open=/);
});
