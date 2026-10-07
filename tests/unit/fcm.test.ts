import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

async function loadFcm() {
  vi.resetModules();
  vi.stubEnv(
    "FIREBASE_SERVICE_ACCOUNT",
    JSON.stringify({ project_id: "demo-project", client_email: "push@demo.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }),
  );
  return import("@/lib/server/fcm");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendPush", () => {
  it("signs a valid service-account JWT, then sends an FCM v1 message", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }));
      return new Response("{}", { status: 200 });
    });
    const { sendPush, pushEnabled } = await loadFcm();
    expect(pushEnabled).toBe(true);
    expect(await sendPush("device-token", { title: "Rappel", body: "Pense à la vidange", data: { entryId: "scan-1" } })).toBe("sent");

    const assertion = new URLSearchParams(String(calls[0].init.body)).get("assertion")!;
    const [header, claims, signature] = assertion.split(".");
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: "push@demo.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });

    expect(calls[1].url).toBe("https://fcm.googleapis.com/v1/projects/demo-project/messages:send");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer ya29.test");
    expect(JSON.parse(String(calls[1].init.body)).message).toMatchObject({
      token: "device-token",
      notification: { title: "Rappel", body: "Pense à la vidange" },
      data: { entryId: "scan-1" },
    });
  });

  it("reports uninstalled apps as invalid tokens", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("oauth2")
        ? new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }))
        : new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), { status: 404 }),
    );
    const { sendPush } = await loadFcm();
    expect(await sendPush("gone", { title: "x", body: "y" })).toBe("invalid_token");
  });

  it("is off without a service account", async () => {
    vi.resetModules();
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", "");
    const { pushEnabled } = await import("@/lib/server/fcm");
    expect(pushEnabled).toBe(false);
  });
});
