import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Continuer avec Google": shown only when Supabase has Google switched on,
// then Google's page and back to the site, signed in. Nothing reaches the
// real Supabase nor Google: their answers are played here.

/** A build without Supabase has no accounts, so nothing to sign in to. */
async function accountsOn(page: Page) {
  await page.goto("/settings");
  return page
    .getByText("Tu n’es pas connecté")
    .waitFor({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
}

async function googleSwitched(page: Page, on: boolean) {
  await page.route(/\/auth\/v1\/settings/, (route) => route.fulfill({ json: { external: { google: on, email: true }, disable_signup: false } }));
}

async function openSignIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter" }).click();
  return page.getByRole("dialog");
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "On a computer, the sidebar has the account.");
  await prepare(page);
  // Whatever the account would sync: nothing.
  await page.route(/supabase\.co\/(rest|storage)\//, (route) => route.fulfill({ json: [] }));
  test.skip(!(await accountsOn(page)), "Accounts are not configured in this build.");
});

test("Google switched off in Supabase: no Google button, the e-mail code as before", async ({ page }) => {
  await googleSwitched(page, false);
  const sheet = await openSignIn(page);
  await expect(sheet.getByRole("button", { name: "Recevoir un code" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Continuer avec Google" })).toHaveCount(0);
});

test("Google switched on: Google's page, then back on the site, signed in", async ({ page }) => {
  await googleSwitched(page, true);
  const authorize: string[] = [];
  await page.route(/\/auth\/v1\/authorize/, async (route) => {
    authorize.push(route.request().url());
    // Google said yes: Supabase sends the browser back with a code.
    await route.fulfill({ status: 302, headers: { location: "http://localhost:3200/auth-callback?code=test-code" } });
  });
  const exchanged: Array<Record<string, string>> = [];
  await page.route(/\/auth\/v1\/token\?grant_type=pkce/, async (route) => {
    exchanged.push(route.request().postDataJSON() as Record<string, string>);
    const now = Math.floor(Date.now() / 1000);
    await route.fulfill({
      json: {
        access_token: "e2e-access",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: "e2e-refresh",
        user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "rado@gmail.com", app_metadata: { provider: "google" }, user_metadata: {}, created_at: new Date().toISOString() },
      },
    });
  });

  const sheet = await openSignIn(page);
  await sheet.getByRole("button", { name: "Continuer avec Google" }).click();
  await expect(page.getByText("Tu es connecté avec Google")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/localhost:3200\/$/);

  const asked = new URL(authorize[0]);
  expect(asked.searchParams.get("provider")).toBe("google");
  expect(asked.searchParams.get("redirect_to")).toBe("http://localhost:3200/auth-callback");
  expect(asked.searchParams.get("code_challenge_method")).toMatch(/^s256$/i);
  expect(exchanged[0]).toMatchObject({ auth_code: "test-code" });
  expect(exchanged[0].code_verifier).toBeTruthy();
});

test("back from Google without a yes: it says so, and leads back to the settings", async ({ page }) => {
  await page.goto("/auth-callback?error=access_denied&error_description=Cancelled");
  await expect(page.getByTestId("auth-callback").getByRole("alert")).toHaveText(/La connexion avec Google n’a pas abouti/);
  await page.getByRole("link", { name: "Retour aux réglages" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
