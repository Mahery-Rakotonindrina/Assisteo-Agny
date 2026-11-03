import { test } from "@playwright/test";
import { walkExpenseSheets } from "./sheetKeyboard";

// The keyboard over a window's field (an iPhone's capture of "Corriger le
// solde"): every field of every window of "Mes dépenses" and "Mes poches"
// stays in sight above the sticky buttons, on a computer and a phone.

test.describe.configure({ timeout: 180_000 });

test("with the keyboard open, each field of the expenses' and pockets' windows stays above Enregistrer", async ({ page }) => {
  await walkExpenseSheets(page);
});
