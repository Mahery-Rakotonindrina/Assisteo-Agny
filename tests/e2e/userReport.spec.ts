import { expect, test } from "@playwright/test";
import { prepare } from "./helpers";

// "Donner mon avis / Signaler un problème" (Réglages), then the Admin list.

const ADMIN = { Authorization: "Bearer e2e-admin-token-0123456789" };

test("a message is sent from Settings and shows up in the Admin list", async ({ page, request }) => {
  await prepare(page);
  const message = `Le bouton ne répond pas ${Date.now()}`;
  await page.goto("/settings");
  await page.getByTestId("report-open").click();
  await expect(page.getByTestId("report-send")).toBeDisabled();
  await page.getByTestId("report-message").fill(message);
  await page.getByTestId("report-contact").fill("test@example.com");
  await page.getByTestId("report-send").click();
  await expect(page.getByTestId("report-form")).toBeHidden();

  const list = await request.get("/api/admin/reports", { headers: ADMIN });
  expect(list.status()).toBe(200);
  const reports = (await list.json()).reports as { id: string; message: string; status: string; contact: string | null; screen: string | null }[];
  const sent = reports.find((report) => report.message === message);
  expect(sent).toMatchObject({ status: "new", contact: "test@example.com" });

  const patched = await request.patch("/api/admin/reports", { headers: ADMIN, data: { id: sent!.id, status: "done" } });
  expect(patched.status()).toBe(204);
  const after = (await (await request.get("/api/admin/reports", { headers: ADMIN })).json()).reports as { id: string; status: string }[];
  expect(after.find((report) => report.id === sent!.id)?.status).toBe("done");
});

test("the reports list needs the admin token and a valid message", async ({ request }) => {
  expect([401, 503]).toContain((await request.get("/api/admin/reports", { headers: { Authorization: "Bearer nope" } })).status());
  // Its own address, as prepare() gives the page: no limit shared with another test or a retry.
  const ip = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
  const bad = await request.post("/api/reports", { headers: { "x-forwarded-for": ip }, data: { kind: "idea", message: "x" } });
  expect(bad.status()).toBe(400);
});
