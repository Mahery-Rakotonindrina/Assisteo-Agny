import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// Family seats in "Mon offre": the demo server has no accounts, so the
// subscriber's plan and the seats API are answered here, nothing is saved.

async function asPremium(page: Page) {
  await prepare(page);
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), signedIn: true, plan: "premium", endsAt: Date.now() + 20 * 24 * 3600 * 1000, features: undefined, familySeat: null } });
  });
}

test("a Premium subscriber adds a person, sees 1/4, then removes them", async ({ page }) => {
  let members: Array<{ id: string; email: string; createdAt: number }> = [];
  const sent: Array<Record<string, unknown>> = [];
  await page.route("**/api/family-seats", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action: string; email?: string; id?: string };
      sent.push(body);
      if (body.action === "add") members = [...members, { id: "5f0c6a52-1b7e-4b8e-9d55-3c1f2a9e7b10", email: body.email ?? "", createdAt: Date.now() }];
      if (body.action === "remove") members = members.filter((member) => member.id !== body.id);
    }
    return route.fulfill({ json: { seats: 4, reason: null, members, joined: null } });
  });
  await asPremium(page);
  await page.goto("/settings");

  // A new Premium is welcomed first.
  await expect(async () => {
    await page.getByRole("dialog").getByRole("button", { name: "C’est parti" }).click({ timeout: 2000 });
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 2000 });
  }).toPass();
  const seats = page.getByTestId("family-seats");
  await expect(seats).toBeVisible();
  await expect(seats.getByTestId("family-count")).toHaveText("0/4 places");
  await seats.getByTestId("family-email").fill(" Mere.Rabe@Example.com ");
  await seats.getByTestId("family-add").click();
  await expect(seats.getByTestId("family-count")).toHaveText("1/4 places");
  await expect(seats.getByText("mere.rabe@example.com")).toBeVisible();
  expect(sent[0]).toEqual({ action: "add", email: "mere.rabe@example.com" });

  await seats.getByRole("button", { name: "Retirer mere.rabe@example.com" }).click();
  await expect(seats.getByTestId("family-count")).toHaveText("0/4 places");
  await expect(seats.getByText("mere.rabe@example.com")).toHaveCount(0);
  expect(sent[1]).toMatchObject({ action: "remove" });
});
