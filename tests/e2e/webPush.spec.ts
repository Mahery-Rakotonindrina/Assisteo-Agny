import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Receive reminders on this iPhone" (Web Push). The demo server has no VAPID
// keys: /api/push/web is answered here. Notification, PushManager and the
// service worker are simulated: no real push service is called.

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const PUBLIC_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

/** The server's key, and every subscribe / unsubscribe call recorded. */
async function serveKey(page: Page) {
  const calls: string[] = [];
  let registered = false;
  await page.route("**/api/push/web*", async (route) => {
    const method = route.request().method();
    calls.push(method);
    if (method === "GET") return route.fulfill({ json: { publicKey: PUBLIC_KEY, registered } });
    registered = method === "POST";
    return route.fulfill({ status: 204, body: "" });
  });
  return calls;
}

/** Launched from the home screen, with push simulated in the page. */
async function standaloneWithPush(page: Page) {
  await page.addInitScript(() => {
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes("display-mode: standalone") ? ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList) : realMatchMedia(query);

    let subscription: PushSubscription | null = null;
    const pushManager = {
      getSubscription: async () => subscription,
      subscribe: async () => {
        subscription = {
          endpoint: "https://web.push.apple.com/e2e",
          toJSON: () => ({ endpoint: "https://web.push.apple.com/e2e", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } }),
          unsubscribe: async () => {
            subscription = null;
            return true;
          },
        } as unknown as PushSubscription;
        return subscription;
      },
    };
    const registration = { pushManager, scope: "/" };
    Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => (subscription ? registration : undefined) },
    });
    let permission: NotificationPermission = "default";
    const FakeNotification = function Notification() {} as unknown as typeof Notification;
    Object.defineProperty(FakeNotification, "permission", { get: () => permission });
    Object.defineProperty(FakeNotification, "requestPermission", {
      value: async () => {
        permission = "granted";
        return permission;
      },
    });
    Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
  });
}

/** A signed-in account, as supabase-js keeps it (storage key "assisteo-auth", lib/supabase.ts). */
async function signedIn(page: Page) {
  await page.addInitScript(() => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const session = {
      access_token: "e2e.access.token",
      refresh_token: "e2e-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: exp,
      user: { id: "00000000-0000-4000-8000-000000000001", email: "e2e@example.com", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    };
    localStorage.setItem("capacitor-storage_assisteo-auth", JSON.stringify(session));
  });
  // Nothing reaches the real Supabase: empty answers.
  await page.route(/supabase\.co\/(rest|auth|storage)\//, (route) => route.fulfill({ json: [] }));
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan: "unlimited", features: undefined } });
  });
}

test("on an iPhone in Safari, the three home-screen steps show instead of the button", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await prepare(page);
  await serveKey(page);
  await page.goto("/settings");
  const row = page.getByTestId("web-push");
  await expect(row).toContainText("Recevoir les rappels sur cet iPhone");
  await expect(row).toContainText("D’abord, ajoute Assisteo à l’écran d’accueil");
  await expect(row.locator("li")).toHaveCount(3);
  await expect(row.getByRole("button")).toHaveCount(0);
  await context.close();
});

test("without the server's keys, nothing shows", async ({ page }) => {
  await prepare(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByTestId("web-push")).toHaveCount(0);
});

test("from the home screen, the button subscribes then unsubscribes", async ({ page }) => {
  await prepare(page);
  const calls = await serveKey(page);
  await standaloneWithPush(page);
  await signedIn(page);
  await page.goto("/settings");
  const row = page.getByTestId("web-push");
  await expect(row).toBeVisible();
  // A build without Supabase (no accounts): only the "sign in" hint can show.
  test.skip((await row.textContent())?.includes("Connecte-toi") === true, "Accounts are not configured in this build.");

  await row.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByText("C’est fait : tes rappels arriveront ici.")).toBeVisible();
  expect(calls).toContain("POST");
  await row.getByRole("button", { name: "Arrêter" }).click();
  await expect(page.getByText("Tu ne recevras plus les rappels ici.")).toBeVisible();
  expect(calls).toContain("DELETE");
  await expect(row.getByRole("button", { name: "Activer" })).toBeVisible();
});
