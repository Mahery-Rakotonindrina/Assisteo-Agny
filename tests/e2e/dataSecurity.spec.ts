import { expect, test, type Locator, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Lot 2 of TODO §19: the family-seat invitation banner, the e-mail code before
// deleting the account. Supabase and the app's API are answered here.

test.describe.configure({ timeout: 120_000 });

const USER = { id: "00000000-0000-4000-8000-000000000001", email: "e2e@example.com", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

async function signedIn(page: Page, { invitation = true, plan = "free" } = {}) {
  await prepare(page);
  await page.addInitScript(
    ([user]) => {
      localStorage.setItem("CapacitorStorage.settings.v1", JSON.stringify({ locale: "fr", theme: "dark", textSize: "normal", onboardingDone: true, updatedAt: 0 }));
      const session = { access_token: "e2e.access.token", refresh_token: "e2e-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
      localStorage.setItem("capacitor-storage_assisteo-auth", JSON.stringify(session));
    },
    [USER],
  );
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), signedIn: true, plan, features: undefined } });
  });
  await page.route(/supabase\.co\/(rest|auth|storage)\//, (route) => route.fulfill({ json: [] }));
  const sent: Array<Record<string, unknown>> = [];
  let pending = invitation;
  await page.route("**/api/family-seats", async (route) => {
    if (route.request().method() === "POST") {
      sent.push(route.request().postDataJSON());
      pending = false;
    }
    return route.fulfill({ json: { seats: 0, reason: null, members: [], joined: null, invitation: pending ? { owner: "Ana", plan: "premium" } : null } });
  });
  return sent;
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not shown");
  return found;
}

test("invitation banner: accept, decline, later", async ({ page }) => {
  const sent = await signedIn(page);
  await page.goto("/");
  const banner = page.getByTestId("family-invitation-banner");
  await expect(banner).toContainText("Ana", { timeout: 30_000 });
  await banner.getByTestId("family-banner-accept").click();
  await expect(banner).toHaveCount(0);
  expect(sent).toEqual([{ action: "accept" }]);
});

test("invitation banner: decline", async ({ page }) => {
  const sent = await signedIn(page);
  await page.goto("/");
  const banner = page.getByTestId("family-invitation-banner");
  await banner.getByTestId("family-banner-decline").click();
  await expect(banner).toHaveCount(0);
  expect(sent).toEqual([{ action: "decline" }]);
});

test("invitation banner: « Plus tard » hides it without answering", async ({ page }) => {
  const sent = await signedIn(page);
  await page.goto("/");
  const banner = page.getByTestId("family-invitation-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await banner.getByRole("button", { name: /plus tard/i }).click();
  await expect(banner).toHaveCount(0);
  expect(sent).toEqual([]);
  // The invitation stays in Settings → Mon offre.
  await page.goto("/settings");
  await expect(page.getByTestId("family-invitation")).toBeVisible({ timeout: 30_000 });
});

test("invitation window at 375x667: fits the screen, « Plus tard » is a real button, and nothing hides the scan buttons once it is closed", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The phone's layout.");
  await page.setViewportSize({ width: 375, height: 667 });
  await signedIn(page);
  await page.goto("/");
  const banner = page.getByTestId("family-invitation-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const sheet = await box(banner);
  const viewport = page.viewportSize()!;
  expect(sheet.y, "the window fits the screen").toBeGreaterThanOrEqual(0);
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(viewport.height);
  const later = await box(banner.getByRole("button", { name: /plus tard/i }));
  expect(later.height, "« Plus tard » is a real touch target").toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: process.env.SHOT ?? "test-results/invitation-667.png" });
  await banner.getByRole("button", { name: /plus tard/i }).click();
  await expect(banner).toHaveCount(0);
  // Closed: nothing stays over the screen; the scan buttons are above the tab bar.
  const bar = await box(page.getByRole("navigation", { name: "Main" }).locator("> div"));
  const upload = page.getByRole("button", { name: /Importer une image/ }).first();
  await expect(upload).toBeVisible();
  const at = await box(upload);
  expect(at.y + at.height).toBeLessThanOrEqual(bar.y);
});

async function openDelete(page: Page) {
  await page.goto("/settings");
  const button = page.getByRole("button", { name: "Supprimer mon compte" });
  // A build without Supabase (the CI's demo build) has no accounts in Settings, so nothing to delete.
  const accounts = await button.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  test.skip(!accounts, "Accounts are not configured in this build.");
  await button.click();
}

test("account deletion: code asked, pasted, then deleted", async ({ page }) => {
  await signedIn(page, { invitation: false });
  const calls: string[] = [];
  await page.route(/supabase\.co\/auth\/v1\/otp/, (route) => {
    calls.push("otp");
    return route.fulfill({ json: {} });
  });
  await page.route(/supabase\.co\/auth\/v1\/verify/, (route) => {
    calls.push("verify");
    return route.fulfill({ json: { access_token: "e2e.access.token2", refresh_token: "r2", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER } });
  });
  let deleted = 0;
  await page.route("**/api/account", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleted++;
    return route.fulfill({ status: 204, body: "" });
  });
  await openDelete(page);
  expect(deleted).toBe(0);
  await page.getByTestId("delete-send-code").click();
  const input = page.getByTestId("delete-code");
  await expect(input).toBeVisible();
  expect(deleted).toBe(0);
  await expect(page.getByTestId("delete-confirm")).toBeDisabled();
  await input.fill("Ton code Assisteo : 12345678 (valable 1 h)");
  await expect(input).toHaveValue("12345678");
  await page.getByTestId("delete-confirm").click();
  await expect.poll(() => deleted).toBe(1);
  expect(calls).toEqual(["otp", "verify"]);
});

test("account deletion: 403 code_required shows a clear message and goes back", async ({ page }) => {
  await signedIn(page, { invitation: false });
  await page.route(/supabase\.co\/auth\/v1\/otp/, (route) => route.fulfill({ json: {} }));
  await page.route(/supabase\.co\/auth\/v1\/verify/, (route) =>
    route.fulfill({ json: { access_token: "e2e.access.token2", refresh_token: "r2", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER } }),
  );
  await page.route("**/api/account", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    return route.fulfill({ status: 403, json: { error: { code: "code_required", message: "confirme avec le code" } } });
  });
  await openDelete(page);
  await page.getByTestId("delete-send-code").click();
  await page.getByTestId("delete-code").fill("12345678");
  await page.getByTestId("delete-confirm").click();
  await expect(page.getByText(/Le code a expiré/)).toBeVisible();
  await expect(page.getByTestId("delete-send-code")).toBeVisible();
});
