import { createDecipheriv, createECDH, createHmac, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushChannel, reachableDevices, type PushDevice } from "@/lib/server/reminderPush";
import { isIosDevice, isPushEndpoint, parseSubscriptionToken, reminderUrl, subscriptionToken, webPushState, type WebPushContext } from "@/lib/webPush";
import { tapTarget } from "@/services/notificationTap";

// A browser's keys, as PushManager.subscribe makes them.
const browser = createECDH("prime256v1");
browser.generateKeys();
const authSecret = randomBytes(16);
const subscription = {
  endpoint: "https://web.push.apple.com/QH-abc123",
  keys: { p256dh: browser.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") },
};

// A VAPID pair, as written by the generator (raw base64url).
const vapid = createECDH("prime256v1");
vapid.generateKeys();
const vapidKeys = { publicKey: vapid.getPublicKey().toString("base64url"), privateKey: vapid.getPrivateKey().toString("base64url"), subject: "mailto:contact@example.com" };

async function loadServer(withKeys = true) {
  vi.resetModules();
  if (withKeys) {
    vi.stubEnv("VAPID_PUBLIC_KEY", vapidKeys.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", vapidKeys.privateKey);
    vi.stubEnv("VAPID_SUBJECT", vapidKeys.subject);
  } else {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
  }
  return { webPush: await import("@/lib/server/webPush"), pushSend: await import("@/lib/server/pushSend") };
}

/** What the browser does with a push body (RFC 8291), to prove it reads it back. */
function decrypt(body: Buffer) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const sender = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
  const shared = browser.computeSecret(sender);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from("WebPush: info\0"), browser.getPublicKey(), sender, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const key = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("webPushState", () => {
  const base: WebPushContext = { publicKey: "key", native: false, ios: true, standalone: true, supported: true, signedIn: true, canRemind: true };

  it("offers the button on an iPhone home screen, for a signed-in account with reminders", () => {
    expect(webPushState(base)).toBe("ready");
    expect(webPushState({ ...base, ios: false, standalone: false })).toBe("ready");
  });

  it("hides it without the server's keys, and in the Android app", () => {
    expect(webPushState({ ...base, publicKey: null })).toBe("hidden");
    expect(webPushState({ ...base, native: true })).toBe("hidden");
    expect(webPushState({ ...base, ios: false, supported: false })).toBe("hidden");
  });

  it("shows the home-screen steps on an iPhone in Safari", () => {
    expect(webPushState({ ...base, standalone: false })).toBe("install");
    // Old Safari without PushManager: the steps too, the home screen is where push lives.
    expect(webPushState({ ...base, standalone: false, supported: false })).toBe("install");
  });

  it("asks to sign in, or shows the plan, before subscribing", () => {
    expect(webPushState({ ...base, signedIn: false })).toBe("signin");
    expect(webPushState({ ...base, canRemind: false })).toBe("locked");
  });
});

describe("isIosDevice", () => {
  it("knows iPhones and iPads, even an iPad saying Macintosh", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15")).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14) Chrome/130.0")).toBe(false);
  });
});

describe("subscriptions", () => {
  it("only accepts the push services' own addresses", () => {
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isPushEndpoint("http://web.push.apple.com/abc")).toBe(false);
    expect(isPushEndpoint("https://web.push.apple.com.evil.example/abc")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });

  it("keeps the subscription in the token and reads it back", () => {
    expect(parseSubscriptionToken(subscriptionToken(subscription))).toEqual(subscription);
    expect(parseSubscriptionToken("fcm-token")).toBeNull();
    expect(parseSubscriptionToken(JSON.stringify({ ...subscription, endpoint: "https://evil.example/x" }))).toBeNull();
  });
});

describe("FCM or Web Push", () => {
  const device = (platform: string | null): PushDevice => ({ user_id: "u1", device_id: `d-${platform}`, token: "t", scheduled: [], platform });

  it("picks the channel by device", () => {
    expect(pushChannel(device("web"))).toBe("web");
    expect(pushChannel(device("android"))).toBe("fcm");
    expect(pushChannel(device(null))).toBe("fcm");
  });

  it("leaves out the devices whose channel isn't configured", () => {
    const devices = [device("android"), device("web")];
    expect(reachableDevices(devices, { fcm: true, web: false }).map((d) => d.platform)).toEqual(["android"]);
    expect(reachableDevices(devices, { fcm: false, web: true }).map((d) => d.platform)).toEqual(["web"]);
  });

  it("sends the same title and text as FCM, opening the page a tapped FCM push opens", async () => {
    const { pushSend } = await loadServer();
    const message = { title: "Facture JIRAMA", body: "Tu m’as demandé de te le rappeler.", target: { entryId: "scan-1" } };
    const fcm = pushSend.fcmMessage(message);
    const web = pushSend.webMessage(message);
    expect(web).toMatchObject({ title: fcm.title, body: fcm.body });
    expect(fcm.data).toEqual({ entryId: "scan-1" });
    const target = tapTarget("scan-1");
    expect(web.url).toBe(`${target.pathname}?${new URLSearchParams(target.query).toString()}`);
    expect(reminderUrl("a b")).toBe("/result?id=a%20b&reminded=1");
    expect(pushSend.webMessage({ ...message, target: { route: "/plans" } }).url).toBe("/plans");
  });
});

describe("sendWebPush", () => {
  it("encrypts the payload for this browser only (aes128gcm)", async () => {
    const { webPush } = await loadServer();
    const body = webPush.encryptPayload(subscription, JSON.stringify({ title: "Rappel", body: "Été", url: "/" }));
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(JSON.parse(decrypt(body))).toEqual({ title: "Rappel", body: "Été", url: "/" });
  });

  it("signs a VAPID token for the push service", async () => {
    const { webPush } = await loadServer();
    const header = webPush.vapidAuthorization(subscription.endpoint, Date.parse("2026-11-02T10:00:00Z"), vapidKeys);
    const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(key).toBe(vapidKeys.publicKey);
    const [head, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ aud: "https://web.push.apple.com", sub: vapidKeys.subject });
    const point = Buffer.from(vapidKeys.publicKey, "base64url");
    const verifier = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
    expect(createVerify("SHA256").update(`${head}.${claims}`).verify({ key: verifier, dsaEncoding: "ieee-p1363" }, signature, "base64url")).toBe(true);
  });

  it("posts to the endpoint, and drops a subscription gone (404, 410)", async () => {
    const { pushSend } = await loadServer();
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status });
    });
    const device: PushDevice = { user_id: "u1", device_id: "iphone", token: subscriptionToken(subscription), scheduled: [], platform: "web" };
    const message = { title: "Rappel", body: "Texte", target: { entryId: "scan-1" } };
    expect(await pushSend.sendToDevice(device, message)).toBe("sent");
    expect(calls[0].url).toBe(subscription.endpoint);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization).toMatch(/^vapid t=/);
    expect(JSON.parse(decrypt(Buffer.from(calls[0].init.body as Uint8Array)))).toEqual({ title: "Rappel", body: "Texte", url: "/result?id=scan-1&reminded=1", tag: "scan-1" });
    status = 410;
    expect(await pushSend.sendToDevice(device, message)).toBe("invalid_token");
    status = 404;
    expect(await pushSend.sendToDevice(device, message)).toBe("invalid_token");
    status = 429;
    expect(await pushSend.sendToDevice(device, message)).toBe("error");
    // A row that isn't a subscription is dropped too, without any call.
    expect(await pushSend.sendToDevice({ ...device, token: "garbage" }, message)).toBe("invalid_token");
    expect(calls).toHaveLength(4);
  });

  it("is off without the VAPID keys", async () => {
    const { webPush } = await loadServer(false);
    expect(webPush.webPushEnabled).toBe(false);
    expect(webPush.vapidPublicKey).toBeNull();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await webPush.sendWebPush(subscription, { title: "x", body: "y", url: "/" })).toBe("error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
