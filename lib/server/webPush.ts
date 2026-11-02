import { createECDH, createCipheriv, createHmac, createPrivateKey, createSign, randomBytes, type ECDH } from "node:crypto";
import { isPushEndpoint, type WebPushSubscription } from "@/lib/webPush";
import type { PushResult } from "./fcm";

// Standard Web Push (RFC 8030), with VAPID (RFC 8292) and the aes128gcm
// payload encryption (RFC 8291, 8188). A few lines of node:crypto rather than
// the web-push package: no dependency to keep up to date for one POST.
// Without the three VAPID_* variables, Web Push is off: no button, the cron skips it.

const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
const subject = process.env.VAPID_SUBJECT?.trim() ?? "";

export const webPushEnabled = Boolean(publicKey && privateKey && /^(mailto:|https:\/\/)/.test(subject));
/** Given to the browsers (PushManager.subscribe); public by design. */
export const vapidPublicKey = webPushEnabled ? publicKey : null;

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** The VAPID signing key, from the raw base64url keys (as written by the generator). */
function signingKey(rawPublic: string, rawPrivate: string) {
  const point = Buffer.from(rawPublic, "base64url");
  return createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: rawPrivate, x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)) },
    format: "jwk",
  });
}

/** `Authorization: vapid t=…, k=…` for this push service, valid 12 hours. */
export function vapidAuthorization(endpoint: string, now: number, keys = { publicKey, privateKey, subject }) {
  const header = b64(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject }));
  const signature = createSign("SHA256")
    .update(`${header}.${claims}`)
    .sign({ key: signingKey(keys.publicKey, keys.privateKey), dsaEncoding: "ieee-p1363" }, "base64url");
  return `vapid t=${header}.${claims}.${signature}, k=${keys.publicKey}`;
}

/** A one-time key pair per message (RFC 8291). */
function newSenderKey() {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return key;
}

/**
 * The payload encrypted for this subscription only (aes128gcm, one record).
 * `salt` and `sender` are drawn at random; the tests pass their own.
 */
export function encryptPayload(subscription: WebPushSubscription, payload: string, salt: Buffer = randomBytes(16), sender: ECDH = newSenderKey()) {
  const receiver = Buffer.from(subscription.keys.p256dh, "base64url");
  const authSecret = Buffer.from(subscription.keys.auth, "base64url");
  const senderPublic = sender.getPublicKey();
  const shared = sender.computeSecret(receiver);

  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from("WebPush: info\0"), receiver, senderPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const key = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  // 0x02: the last (and only) record, no padding.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([senderPublic.length]), senderPublic, body]);
}

/** What the service worker (public/sw.js) shows, and the page a tap opens. */
export type WebPushMessage = { title: string; body: string; url: string; tag?: string };

/**
 * Sends one notification to one browser. "invalid_token" (404, 410): the
 * subscription is gone (unsubscribed, app removed from the home screen): forget it.
 */
export async function sendWebPush(subscription: WebPushSubscription, message: WebPushMessage, now = Date.now()): Promise<PushResult> {
  if (!webPushEnabled || !isPushEndpoint(subscription.endpoint)) return "error";
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, now),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      // A reminder an hour late is still worth showing; later, no.
      TTL: "3600",
      Urgency: "high",
    },
    body: new Uint8Array(encryptPayload(subscription, JSON.stringify(message))),
    redirect: "error",
  });
  return webPushResult(response.status);
}

export function webPushResult(status: number): PushResult {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "invalid_token";
  return "error";
}
