import { expect, type Page, type Request, type Route } from "@playwright/test";

/**
 * "Mes poches", the first time (a plan with "Mes dépenses"): cash with what
 * it holds, MVola too when given (cash stays the default one), then back to
 * "Mes dépenses".
 */
export async function setUpPockets(page: Page, { cash, mvola }: { cash: string; mvola?: string }) {
  await page.goto("/pockets");
  const setup = page.getByRole("form", { name: "Où est ton argent ?" });
  await setup.getByLabel(/^Espèces : combien/).fill(cash);
  if (mvola) {
    await setup.getByRole("checkbox", { name: "MVola" }).check();
    await setup.getByLabel(/^MVola : combien/).fill(mvola);
  }
  await setup.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("pockets-all")).toBeVisible();
  await page.goto("/expenses");
}

/** The pockets under "Il te reste", one line each ("Espèces 45 000 Ar"), in their order. */
export async function expectPockets(page: Page, rows: string[]) {
  await expect(page.getByTestId("pockets-row")).toHaveText(rows.map((row) => new RegExp(`^${row.replace(/ /g, "\\s")}$`)));
}

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
