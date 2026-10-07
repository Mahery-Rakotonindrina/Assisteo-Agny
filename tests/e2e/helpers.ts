import type { Page } from "@playwright/test";

/** Starts the app as a returning French user (onboarding done) unless told otherwise. */
export async function prepare(page: Page, { onboardingDone = true } = {}) {
  await page.addInitScript((done) => {
    if (!localStorage.getItem("CapacitorStorage.settings.v1")) {
      localStorage.setItem(
        "CapacitorStorage.settings.v1",
        JSON.stringify({ locale: "fr", theme: "dark", notifyOnResult: false, haptics: true, onboardingDone: done, updatedAt: 0 }),
      );
    }
  }, onboardingDone);
}
