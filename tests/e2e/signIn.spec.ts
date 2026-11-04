import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Customers' requests: « Se connecter » on the home page when signed out (it
// was only in the settings), and the code copied from the e-mail pasted as it
// comes (the subject, a sentence, spaces), typed or with « Coller le code ».
// Nothing reaches the real Supabase: the code sent is read from the request.

/** A build without Supabase has no accounts, so nothing to sign in to. */
async function accountsOn(page: Page) {
  await page.goto("/settings");
  return page
    .getByText("Tu n’es pas connecté")
    .waitFor({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
}

/** Opens the sign-in from the home page and asks for a code; returns the codes checked. */
async function askCode(page: Page) {
  const checked: string[] = [];
  await page.route(/supabase\.co\/auth\/v1\/otp/, (route) => route.fulfill({ json: {} }));
  await page.route(/supabase\.co\/auth\/v1\/verify/, async (route) => {
    checked.push((route.request().postDataJSON() as { token: string }).token);
    // Refused: the sheet stays open, the test only looks at what was sent.
    await route.fulfill({ status: 403, json: { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByPlaceholder(/@/).fill("client@example.com");
  await sheet.getByRole("button", { name: "Recevoir un code" }).click();
  await expect(sheet.getByRole("heading", { name: "Entre le code" })).toBeVisible();
  return { sheet, checked };
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "On a computer, the sidebar has the account.");
  await prepare(page);
  test.skip(!(await accountsOn(page)), "Accounts are not configured in this build.");
});

test("signed out, « Se connecter » is on the home page, on the greeting's line", async ({ page }) => {
  await page.goto("/");
  const signIn = page.getByRole("button", { name: "Se connecter" });
  await expect(signIn).toBeVisible();
  // Above the photo button, never pushing the scan off the screen.
  const box = (await signIn.boundingBox())!;
  const photo = (await page.getByRole("button", { name: "Importer une image" }).boundingBox())!;
  expect(box.y + box.height).toBeLessThan(photo.y);
  await signIn.click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Recevoir un code" })).toBeVisible();
});

test("the e-mail's subject pasted in the field: its code is checked at once", async ({ page }) => {
  const { sheet, checked } = await askCode(page);
  await sheet.getByRole("textbox", { name: "Entre le code" }).fill("Ton code Assisteo Agny : 1234 5678");
  await expect.poll(() => checked).toEqual(["12345678"]);
});

test("« Coller le code » reads the code from the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { sheet, checked } = await askCode(page);
  await page.evaluate(() => navigator.clipboard.writeText("Ton code de connexion\n87654321\nIl expire dans une heure."));
  await sheet.getByRole("button", { name: "Coller le code" }).click();
  await expect.poll(() => checked).toEqual(["87654321"]);
});

test("« Coller le code » with no code copied says how to paste by hand", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { sheet, checked } = await askCode(page);
  await page.evaluate(() => navigator.clipboard.writeText("Bonjour"));
  await sheet.getByRole("button", { name: "Coller le code" }).click();
  await expect(page.getByText("Pas de code copié.", { exact: false })).toBeVisible();
  expect(checked).toEqual([]);
});
