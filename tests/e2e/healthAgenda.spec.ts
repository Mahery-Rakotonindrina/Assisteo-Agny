import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// Vaccines and expiry dates in "À venir": a relative's next dose shows on its
// day with their first name, and opens "Ma santé" on that person, the vaccine
// in sight and lit up. For every plan (free here).

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

test("agenda: a relative's next vaccine dose opens their record on that vaccine", async ({ page }) => {
  await prepare(page);
  await page.goto("/sante");
  const chip = (name: string) => page.getByTestId("health-profiles").getByRole("button", { name, exact: true });

  // A relative, with a vaccine whose next dose is in 5 days.
  await page.getByTestId("health-profile-add").click();
  const profile = page.getByTestId("health-profile-form");
  await profile.getByTestId("health-profile-name").fill("Lala Rasoa");
  await profile.getByTestId("health-profile-relation").selectOption("child");
  await profile.getByTestId("health-profile-save").click();
  await expect(chip("Lala Rasoa")).toHaveAttribute("aria-pressed", "true");
  for (const [name, next] of [["BCG", ""], ["Rougeole-Rubéole", day(5)], ["Polio", ""]]) {
    await page.getByTestId("vaccine-add").click();
    const form = page.getByTestId("vaccine-form");
    await form.getByTestId("vaccine-name").fill(name);
    await form.getByTestId("vaccine-day").fill(day(-60));
    if (next) await form.getByTestId("vaccine-next-day").fill(next);
    await form.getByTestId("vaccine-save").click();
    await expect(form).toHaveCount(0);
  }
  // Back on « Moi »: the link has to change the person.
  await chip("Moi").click();

  await page.goto("/agenda");
  const link = page.getByRole("link", { name: /Vaccin : Rougeole-Rubéole/ });
  await expect(link).toContainText("Pour Lala");
  await link.click();

  await expect(page).toHaveURL(/\/sante\?vax=/);
  await expect(chip("Lala Rasoa")).toHaveAttribute("aria-pressed", "true");
  const row = page.getByTestId("vaccine").filter({ hasText: "Rougeole-Rubéole" });
  await expect(row).toHaveAttribute("data-flash", "");
  await expect(row).toBeInViewport();
  // Lit up a moment only.
  await expect(row).not.toHaveAttribute("data-flash", { timeout: 5000 });
});
