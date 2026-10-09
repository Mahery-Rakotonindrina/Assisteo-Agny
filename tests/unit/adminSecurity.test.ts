import { randomBytes } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeAll, describe, expect, it } from "vitest";

process.env.ADMIN_TOKEN = "admin-token-for-tests-0123456789";
process.env.CRON_SECRET = "cron-secret-for-tests";
process.env.API_KEYS_SECRET = randomBytes(32).toString("base64");

const totp = await import("@/lib/server/totp");
const { issueAdminSession, verifyAdminSession, ADMIN_SESSION_MS } = await import("@/lib/server/adminSession");
const twoFactor = await import("@/lib/server/adminTwoFactor");
const { guardAdmin } = await import("@/lib/server/adminAuth");

function call(headers: Record<string, string>, options?: { machine?: boolean }) {
  const req = { headers, socket: { remoteAddress: `10.0.0.${Math.floor(Math.random() * 250)}` } } as unknown as NextApiRequest;
  const res = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
    setHeader() {},
  };
  return guardAdmin(req, res as unknown as NextApiResponse, options).then((ok) => ({ ok, status: res.statusCode }));
}

describe("TOTP codes", () => {
  // RFC 6238 test vectors (SHA-1, secret "12345678901234567890"), last 6 digits.
  const secret = totp.base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC test vectors", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totp.totpCode(secret, totp.totpStep(59_000))).toBe("287082");
    expect(totp.totpCode(secret, totp.totpStep(1_111_111_109_000))).toBe("081804");
    expect(totp.totpCode(secret, totp.totpStep(1_234_567_890_000))).toBe("005924");
    expect(totp.totpCode(secret, totp.totpStep(2_000_000_000_000))).toBe("279037");
  });

  it("accepts a phone clock off by one step, not more", () => {
    const now = 1_234_567_890_000;
    const step = totp.totpStep(now);
    expect(totp.matchTotp(secret, totp.totpCode(secret, step), now)).toBe(step);
    expect(totp.matchTotp(secret, totp.totpCode(secret, step - 1).replace(/^(\d{3})/, "$1 "), now)).toBe(step - 1);
    expect(totp.matchTotp(secret, totp.totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(totp.matchTotp(secret, totp.totpCode(secret, step + 2), now)).toBeNull();
    expect(totp.matchTotp(secret, "12345", now)).toBeNull();
  });

  it("round-trips base32 and builds the app link", () => {
    const bytes = randomBytes(20);
    expect(totp.base32Decode(totp.base32Encode(bytes))).toEqual(bytes);
    expect(totp.otpauthUri("ABC", "Assisteo Agny", "admin")).toBe("otpauth://totp/Assisteo%20Agny:admin?secret=ABC&issuer=Assisteo%20Agny&algorithm=SHA1&digits=6&period=30");
  });
});

describe("admin sessions", () => {
  it("expire, and stop working when the epoch or the token changes", () => {
    const { session } = issueAdminSession("epoch-1", 1000);
    expect(verifyAdminSession(session, "epoch-1", 2000)).toBe(true);
    expect(verifyAdminSession(session, "epoch-1", 1000 + ADMIN_SESSION_MS + 1)).toBe(false);
    expect(verifyAdminSession(session, "epoch-2", 2000)).toBe(false);
    expect(verifyAdminSession(session.replace(/\.\d+\./, ".9999999999999."), "epoch-1", 2000)).toBe(false);
    const token = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "another-token-entirely-0123456789";
    expect(verifyAdminSession(session, "epoch-1", 2000)).toBe(false);
    process.env.ADMIN_TOKEN = token;
  });
});

describe("second factor of /admin", () => {
  let recovery: string[];
  let secret: string;
  let oldSession: string;
  let confirmStep: number;

  beforeAll(async () => {
    oldSession = issueAdminSession(twoFactor.sessionEpoch(await twoFactor.twoFactorState())).session;
  });

  it("lets the token in while it is off", async () => {
    expect(await call({ authorization: `Bearer ${process.env.ADMIN_TOKEN}` })).toEqual({ ok: true, status: 200 });
    expect(await call({ authorization: "Bearer wrong" })).toEqual({ ok: false, status: 401 });
    expect(await call({ authorization: `Bearer ${oldSession}` })).toEqual({ ok: true, status: 200 });
  });

  it("turns on only with a right code from the new secret", async () => {
    secret = await twoFactor.startTwoFactor();
    expect(await twoFactor.confirmTwoFactor("000000")).toBeNull();
    confirmStep = totp.totpStep();
    recovery = (await twoFactor.confirmTwoFactor(totp.totpCode(secret, confirmStep)))!;
    expect(recovery).toHaveLength(10);
    expect(recovery[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(await twoFactor.twoFactorState()).toMatchObject({ enabled: true, recoveryLeft: 10 });
  });

  it("then needs a session, except for the APK workflow with the cron secret", async () => {
    const token = `Bearer ${process.env.ADMIN_TOKEN}`;
    expect((await call({ authorization: token })).status).toBe(401);
    expect((await call({ authorization: token }, { machine: true })).status).toBe(401);
    expect((await call({ authorization: token, "x-cron-secret": process.env.CRON_SECRET! }, { machine: true })).ok).toBe(true);
    expect((await call({ authorization: token, "x-cron-secret": process.env.CRON_SECRET! })).status).toBe(401);
    // Sessions signed before it was turned on end.
    expect((await call({ authorization: `Bearer ${oldSession}` })).status).toBe(401);
    const fresh = issueAdminSession(twoFactor.sessionEpoch(await twoFactor.twoFactorState())).session;
    expect((await call({ authorization: `Bearer ${fresh}` })).ok).toBe(true);
  });

  it("takes each code once, and each recovery code once", async () => {
    const step = confirmStep;
    // The confirming code is used up: the next one still works.
    expect(await twoFactor.checkSecondFactor(totp.totpCode(secret, step))).toBe(false);
    expect(await twoFactor.checkSecondFactor(totp.totpCode(secret, step + 1))).toBe(true);
    expect(await twoFactor.checkSecondFactor(totp.totpCode(secret, step + 1))).toBe(false);
    expect(await twoFactor.checkSecondFactor(recovery[3].toUpperCase())).toBe(true);
    expect(await twoFactor.checkSecondFactor(recovery[3])).toBe(false);
    expect(await twoFactor.checkSecondFactor("aaaaa-bbbbb")).toBe(false);
    expect((await twoFactor.twoFactorState()).recoveryLeft).toBe(9);
  });

  it("turns off, which ends the sessions again", async () => {
    const during = issueAdminSession(twoFactor.sessionEpoch(await twoFactor.twoFactorState())).session;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await twoFactor.disableTwoFactor();
    expect(await twoFactor.twoFactorState()).toMatchObject({ enabled: false, recoveryLeft: 0 });
    expect((await call({ authorization: `Bearer ${during}` })).status).toBe(401);
    expect((await call({ authorization: `Bearer ${process.env.ADMIN_TOKEN}` })).ok).toBe(true);
  });
});
