import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// Referral by scans: the numbers need a signed-in account (not available in
// the demo), so these tests cover the Admin settings and the refusals.

const ADMIN = { Authorization: "Bearer e2e-admin-token-0123456789" };

test("the referral settings are read, changed and checked in Admin", async ({ request }) => {
  const read = await request.get("/api/admin/referral", { headers: ADMIN });
  expect(read.status()).toBe(200);
  const before = await read.json();
  expect(before).toMatchObject({ scans: expect.any(Number), capPerMonth: expect.any(Number), rewarded: expect.any(Number) });

  const bad = await request.put("/api/admin/referral", { headers: ADMIN, data: { scans: -3, capPerMonth: 10 } });
  expect(bad.status()).toBe(400);

  const saved = await request.put("/api/admin/referral", { headers: ADMIN, data: { scans: 7, capPerMonth: 4 } });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toMatchObject({ scans: 7, capPerMonth: 4 });
  // Back as it was, for the other tests.
  await request.put("/api/admin/referral", { headers: ADMIN, data: { scans: before.scans, capPerMonth: before.capPerMonth } });

  expect([401, 503]).toContain((await request.get("/api/admin/referral", { headers: { Authorization: "Bearer nope" } })).status());
});

test("the referral numbers need a signed-in account", async ({ request }) => {
  const response = await request.get("/api/referral");
  expect([401, 503]).toContain(response.status());
});

test("an invitation link keeps a valid code on the device and cleans the address; anything else is ignored", async ({ page }) => {
  await prepare(page);
  await page.goto("/plans?ref=abcd234");
  await expect(page).toHaveURL(/\/plans$/);
  expect(await page.evaluate(() => localStorage.getItem("pending-referral.v1"))).toBe("ABCD234");

  await page.evaluate(() => localStorage.removeItem("pending-referral.v1"));
  await page.goto("/plans?ref=%3Cscript%3E");
  await expect(page).toHaveURL(/\/plans/);
  expect(await page.evaluate(() => localStorage.getItem("pending-referral.v1"))).toBeNull();
});
