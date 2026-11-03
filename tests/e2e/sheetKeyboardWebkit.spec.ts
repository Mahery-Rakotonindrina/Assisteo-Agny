import { test } from "@playwright/test";
import { walkExpenseSheets } from "./sheetKeyboard";

// The same walk in WebKit (Safari's engine), locally only: the CI installs
// Chromium alone.
test.skip(Boolean(process.env.CI), "WebKit is not installed in the CI.");
test.use({ browserName: "webkit", channel: "" });
test.describe.configure({ timeout: 180_000 });

test("WebKit: with the keyboard open, each field of the expenses' and pockets' windows stays above Enregistrer", async ({ page }) => {
  await walkExpenseSheets(page);
});
