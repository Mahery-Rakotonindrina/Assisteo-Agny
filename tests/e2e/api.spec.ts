import { expect, test } from "@playwright/test";

// API contracts, independent of the browser: run once.
test.describe("api", () => {
  test.skip(({ isMobile }) => isMobile, "Runs once, on the desktop project.");

  test("health reports demo mode", async ({ request }) => {
    const body = await (await request.get("/api/health")).json();
    expect(body).toMatchObject({ status: "ok", ai: "demo" });
  });

  test("app-version exposes the update settings", async ({ request }) => {
    const body = await (await request.get("/api/app-version")).json();
    expect(Object.keys(body).sort()).toEqual(["downloadUrl", "latest", "minimum"]);
  });

  test("analyze validates its input", async ({ request }) => {
    const response = await request.post("/api/analyze", { data: { image: "", mediaType: "image/gif" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  test("account deletion needs a signed-in user", async ({ request }) => {
    const response = await request.delete("/api/account");
    // 401 with accounts configured, 503 without.
    expect([401, 503]).toContain(response.status());
  });

  test("admin routes reject a wrong token", async ({ request }) => {
    const response = await request.get("/api/admin/trial", { headers: { Authorization: "Bearer nope" } });
    expect([401, 503]).toContain(response.status());
  });

  test("feedback is validated and accepted", async ({ request }) => {
    const ok = await request.post("/api/feedback", {
      data: { vote: "down", reason: "wrong_info", category: "food", mode: "food", model: "demo", confidence: 0.8, title: "Salade" },
    });
    expect(ok.status()).toBe(204);
    const bad = await request.post("/api/feedback", { data: { vote: "maybe" } });
    expect(bad.status()).toBe(400);
  });
});
