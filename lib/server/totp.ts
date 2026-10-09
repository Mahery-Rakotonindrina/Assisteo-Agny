import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time codes (RFC 6238), as Google Authenticator, Microsoft
// Authenticator or the iPhone's Passwords app make them: HMAC-SHA1, 6 digits,
// a new code every 30 seconds.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_S = 30;

export function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 random bits, in the base32 the authenticator apps expect. */
export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpStep(now = Date.now()) {
  return Math.floor(now / 1000 / PERIOD_S);
}

export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** The time step a code belongs to (now, or one step either way for a phone clock off by a little), or null. */
export function matchTotp(secret: string, code: string, now = Date.now()) {
  const given = Buffer.from(code.replace(/\s/g, ""));
  if (!/^\d{6}$/.test(given.toString())) return null;
  const current = totpStep(now);
  for (const step of [current, current - 1, current + 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), given)) return step;
  }
  return null;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, issuer: string, account: string) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${PERIOD_S}`;
}
