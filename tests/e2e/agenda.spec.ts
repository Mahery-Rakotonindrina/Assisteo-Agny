import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "À venir" (/agenda): a scan's reminder and a medical appointment on their day,
// the filter chips, "Voir 30 jours de plus", the empty agenda, the free plan,
// and the entries ("Tout voir" on the home page, the side bar).

async function pretendPlan(page: Page, plan: string) {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), plan, features: undefined } });
  });
}

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** Scans a photo (demo answer), then sets its reminder `offset` days from now at noon. */
async function scanWithReminder(page: Page, offset: number) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/apple.jpg");
  await expect(page).toHaveURL(/\/result\?id=/, { timeout: 20_000 });
  const id = new URL(page.url()).searchParams.get("id")!;
  await page.goto("/history");
  await expect(page.locator('a[href*="/result?id="]')).toHaveCount(1);
  await page.evaluate(
    ([key, offsetDays]) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("pocket-assistant");
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const store = db.transaction("history", "readwrite").objectStore("history");
          const get = store.get(key);
          get.onsuccess = () => {
            const at = new Date();
            at.setDate(at.getDate() + offsetDays);
            at.setHours(12, 0, 0, 0);
            store.put({ ...get.result, reminderAt: at.getTime() }, key);
          };
          store.transaction.oncomplete = () => done();
        };
      }),
    [id, offset] as const,
  );
  return id;
}

test("agenda: a reminder and an appointment on their day, chips, 30 more days", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "unlimited");
  const id = await scanWithReminder(page, 2);

  await page.goto("/sante");
  await page.getByTestId("appointment-add").click();
  const form = page.getByTestId("appointment-form");
  await form.getByTestId("appointment-day").fill(day(4));
  await form.getByTestId("appointment-hour").fill("15:00");
  await form.getByTestId("appointment-who").fill("Dentiste");
  await form.getByTestId("appointment-save").click();
  await expect(form).toHaveCount(0);

  await page.goto("/agenda");
  await expect(page.getByRole("heading", { level: 1, name: "À venir" })).toBeVisible();
  const sections = page.locator("section[aria-label]");
  await expect(sections).toHaveCount(2);
  const reminderDay = sections.nth(0);
  const appointmentDay = sections.nth(1);
  await expect(reminderDay.locator(`a[href="/result?id=${id}"]`)).toBeVisible();
  await expect(reminderDay.locator("time")).toHaveText(/12[:h]00/);
  await expect(appointmentDay).toContainText("Dentiste");
  await expect(appointmentDay.locator("time")).toHaveText(/15[:h]00/);

  // The chips filter by domain.
  const chips = page.getByRole("group", { name: "Filtrer par sujet" });
  await chips.getByRole("button", { name: "Santé" }).click();
  await expect(sections).toHaveCount(1);
  await expect(page.getByText("Dentiste")).toBeVisible();
  await chips.getByRole("button", { name: "Santé" }).click();
  await chips.getByRole("button", { name: "Rappels" }).click();
  await expect(sections).toHaveCount(1);
  await chips.getByRole("button", { name: "Tout" }).click();
  await expect(sections).toHaveCount(2);

  // 30 more days.
  const until = page.getByText(/^Jusqu’au /);
  const before = await until.textContent();
  await page.getByRole("button", { name: "Voir 30 jours de plus" }).click();
  await expect(until).not.toHaveText(before!);

  // A click opens the thing.
  await reminderDay.locator(`a[href="/result?id=${id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/result[?]id=${id}`));
  await page.goto("/agenda");
  await page.getByText("Dentiste").click();
  await expect(page).toHaveURL(/\/sante\?appt=/);
});

test("agenda: empty, reachable from the side bar, English", async ({ page, isMobile }) => {
  await prepare(page);
  await page.goto("/agenda");
  await expect(page.getByText("Rien de prévu dans les 30 prochains jours.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Voir 30 jours de plus" })).toBeVisible();
  if (!isMobile) {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("link", { name: "À venir" }).first().click();
    await expect(page).toHaveURL(/\/agenda/);
  }
});

test("agenda: free plan has no reminders; « Tout voir » on the home page", async ({ page }) => {
  await prepare(page);
  await pretendPlan(page, "unlimited");
  await scanWithReminder(page, 1);
  await page.goto("/");
  const all = page.locator("a[href=\"/agenda\"]", { hasText: "Tout voir" });
  await expect(all).toBeVisible();
  await all.click();
  await expect(page).toHaveURL(/\/agenda/);
  await expect(page.locator("section[aria-label]")).toHaveCount(1);

  // Back to free: the reminders source is off.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await pretendPlan(page, "free");
  await page.goto("/agenda");
  await expect(page.getByText("Rien de prévu dans les 30 prochains jours.")).toBeVisible();
});

test("agenda: a shortcut on the home page opens it, first of the list", async ({ page }) => {
  await prepare(page);
  await scanWithReminder(page, 1);
  await page.goto("/");
  const shortcuts = page.getByRole("navigation", { name: "Raccourcis" });
  await expect(shortcuts).toBeVisible();
  expect(await shortcuts.locator("a").first().getAttribute("href")).toBe("/agenda");
  await shortcuts.getByRole("link", { name: /À venir/ }).click();
  await expect(page).toHaveURL(/\/agenda/);
});

test("agenda: in English", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("CapacitorStorage.settings.v1", JSON.stringify({ locale: "en", theme: "dark", notifyOnResult: false, haptics: true, onboardingDone: true, updatedAt: 0 })),
  );
  await prepare(page);
  await page.goto("/agenda");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Coming up");
  await expect(page.getByText(/Nothing planned in the next 30 days/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Show 30 more days/ })).toBeVisible();
});
