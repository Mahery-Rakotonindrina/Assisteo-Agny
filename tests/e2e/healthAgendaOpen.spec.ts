import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Opening a medicine and an appointment from "À venir", and a vaccine then a
// medicine from the search.

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

async function addMedicine(page: Page, name: string, offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  await page.getByTestId("pharmacy-add").click();
  const form = page.getByTestId("pharmacy-form");
  await form.getByTestId("pharmacy-name").fill(name);
  await form.getByTestId("pharmacy-month").selectOption(String(date.getMonth() + 1));
  await form.getByTestId("pharmacy-year").selectOption(String(date.getFullYear()));
  await form.getByTestId("pharmacy-day").selectOption(String(date.getDate()));
  await form.getByTestId("pharmacy-save").click();
  await expect(form).toHaveCount(0);
}

async function addVaccine(page: Page, name: string) {
  await page.getByTestId("vaccine-add").click();
  const form = page.getByTestId("vaccine-form");
  await form.getByTestId("vaccine-name").fill(name);
  await form.getByTestId("vaccine-day").fill(day(-30));
  await form.getByTestId("vaccine-save").click();
  await expect(form).toHaveCount(0);
}

test("agenda: a medicine's last day opens the pharmacy on it, lit up", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await addMedicine(page, "Sirop Toux", 3);
  await page.goto("/agenda");
  const link = page.getByRole("link", { name: /Sirop Toux/ });
  await expect(link).toContainText("Dernier jour");
  await link.click();
  await expect(page).toHaveURL(/\/sante\?med=/);
  const row = page.getByTestId("pharmacy-item").filter({ hasText: "Sirop Toux" });
  await expect(row).toHaveAttribute("data-flash", "");
  await expect(row).toBeInViewport();
});

test("agenda: an appointment opens Ma santé on it, lit up", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await page.getByTestId("appointment-add").click();
  const form = page.getByTestId("appointment-form");
  await form.getByTestId("appointment-day").fill(day(4));
  await form.getByTestId("appointment-hour").fill("09:30");
  await form.getByTestId("appointment-who").fill("Dr Rabe");
  await form.getByTestId("appointment-save").click();
  await expect(form).toHaveCount(0);
  await page.goto("/agenda");
  const link = page.getByRole("link", { name: /Dr Rabe/ });
  await link.click();
  await expect(page).toHaveURL(/\/sante\?appt=/);
  const card = page.getByTestId("appointment").filter({ hasText: "Dr Rabe" });
  await expect(card).toHaveAttribute("data-flash", "");
  await expect(card).toBeInViewport();
});

test("a second link opened at once: only the second item stays lit up", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await addMedicine(page, "Sirop Toux", 3);
  await addMedicine(page, "Vitamine C", 5);
  await page.goto("/agenda");
  const second = await page.getByRole("link", { name: /Vitamine C/ }).getAttribute("href");
  expect(second).toContain("med=");
  await page.getByRole("link", { name: /Sirop Toux/ }).click();
  const firstRow = page.getByTestId("pharmacy-item").filter({ hasText: "Sirop Toux" });
  await expect(firstRow).toHaveAttribute("data-flash", "");
  await page.evaluate(async (url) => {
    const { router } = (window as unknown as { next: { router: { push: (url: string) => Promise<boolean> } } }).next;
    await router.push(url);
  }, second!);
  const secondRow = page.getByTestId("pharmacy-item").filter({ hasText: "Vitamine C" });
  await expect(secondRow).toHaveAttribute("data-flash", "");
  await expect(firstRow).not.toHaveAttribute("data-flash");
  await expect(secondRow).not.toHaveAttribute("data-flash", { timeout: 5000 });
});

test("search: a vaccine then a medicine are found and opened", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  await addVaccine(page, "Hépatite B");
  await addMedicine(page, "Doliprane", 200);
  for (const [term, url, testid] of [["Hépatite", /\?vax=/, "vaccine"], ["Doliprane", /\?med=/, "pharmacy-item"]] as const) {
    await page.goto("/recherche");
    await page.getByRole("searchbox").fill(term);
    await page.getByRole("link", { name: new RegExp(term) }).first().click();
    await expect(page).toHaveURL(url);
    await expect(page.getByTestId(testid).filter({ hasText: term })).toBeInViewport();
  }
});
