import type { Page, Request, Route } from "@playwright/test";

/** Starts the app as a returning French user (onboarding done) unless told otherwise. */
export async function prepare(page: Page, { onboardingDone = true } = {}) {
  // The server rate-limits /api/analyze (12 a minute) per client IP, and every test
  // comes from localhost: the scans of parallel workers used up the limit and the
  // app answered "Beaucoup de demandes" (the scan stayed on the home page). One
  // fake IP per test keeps the limit out of the way (the tests are independent).
  const ip = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });

  // A mock that does `route.fetch()` then `response.json()` throws "Response has been
  // disposed" when the page navigates away meanwhile (the request is cancelled): that
  // is not a failure of the test, so such errors are swallowed in every page.route.
  const route = page.route.bind(page) as unknown as (url: Parameters<Page["route"]>[0], handler: (r: Route, q: Request) => unknown, options?: { times?: number }) => Promise<unknown>;
  const unroute = page.unroute.bind(page) as unknown as (url: Parameters<Page["route"]>[0], handler?: unknown) => Promise<void>;
  const wrapped = new Map<unknown, (r: Route, q: Request) => Promise<void>>();
  page.route = ((url: Parameters<Page["route"]>[0], handler: (r: Route, q: Request) => unknown, options?: { times?: number }) => {
    const safe = async (r: Route, q: Request) => {
      try {
        await handler(r, q);
      } catch (error) {
        if (!/disposed|closed|Target page|aborted|already handled/i.test(String(error))) throw error;
      }
    };
    wrapped.set(handler, safe);
    return route(url, safe, options);
  }) as unknown as Page["route"];
  // unroute() must be given the function that was registered.
  page.unroute = ((url: Parameters<Page["route"]>[0], handler?: unknown) =>
    unroute(url, handler ? (wrapped.get(handler) ?? handler) : handler)) as unknown as Page["unroute"];
  await page.addInitScript((done) => {
    if (!localStorage.getItem("CapacitorStorage.settings.v1")) {
      localStorage.setItem(
        "CapacitorStorage.settings.v1",
        JSON.stringify({ locale: "fr", theme: "dark", notifyOnResult: false, haptics: true, onboardingDone: done, updatedAt: 0 }),
      );
    }
  }, onboardingDone);
}
