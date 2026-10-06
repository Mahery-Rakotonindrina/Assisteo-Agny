import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts users' own AI keys before they reach the database (AES-256-GCM).
// API_KEYS_SECRET is 32 random bytes in base64 and only exists on the server,
// so a database leak alone never exposes a key.

function secret() {
  const raw = process.env.API_KEYS_SECRET;
  const key = raw ? Buffer.from(raw, "base64") : null;
  if (!key || key.length !== 32) throw new Error("API_KEYS_SECRET must be 32 bytes, base64-encoded.");
  return key;
}

/** Returns "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function seal(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export function open(sealed: string) {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unknown sealed format.");
  const decipher = createDecipheriv("aes-256-gcm", secret(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
