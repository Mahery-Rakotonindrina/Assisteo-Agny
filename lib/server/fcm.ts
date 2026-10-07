import { createSign } from "node:crypto";

// Firebase Cloud Messaging (HTTP v1) without the Firebase SDK: a service
// account signs a JWT, exchanged for a short-lived OAuth access token.
// FIREBASE_SERVICE_ACCOUNT holds the service account JSON (raw or base64).

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as ServiceAccount;
    return parsed.project_id && parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    return null;
  }
}

const account = readServiceAccount();
export const pushEnabled = account !== null;

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken() {
  if (!account) throw new Error("FCM is not configured.");
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  if (!response.ok) throw new Error(`FCM auth failed (${response.status}).`);
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

export type PushResult = "sent" | "invalid_token" | "error";

/** Sends one notification to one device. "invalid_token": forget this device. */
export async function sendPush(token: string, message: { title: string; body: string; data?: Record<string, string> }): Promise<PushResult> {
  if (!account) return "error";
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: "high", notification: { channel_id: "reminders", icon: "ic_stat_notify", color: "#c6ff4d" } },
      },
    }),
  });
  if (response.ok) return "sent";
  // Uninstalled app or rotated token.
  if (response.status === 404 || response.status === 400) {
    const text = await response.text();
    if (/UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*token/i.test(text)) return "invalid_token";
  }
  return "error";
}
