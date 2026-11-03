import type { NextApiRequest, NextApiResponse } from "next";
import { afterAll, describe, expect, it } from "vitest";

process.env.ADMIN_TOKEN = "admin-token-for-tests-0123456789";

const { guardAdmin } = await import("@/lib/server/adminAuth");
const twoFactor = await import("@/lib/server/adminTwoFactor");

function call() {
  const req = { headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` }, method: "GET", socket: { remoteAddress: "10.1.1.1" } } as unknown as NextApiRequest;
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
  return guardAdmin(req, res as unknown as NextApiResponse).then((actor) => ({ ok: Boolean(actor), status: res.statusCode }));
}

describe("ADMIN_2FA_REQUIRED", () => {
  afterAll(() => {
    delete process.env.ADMIN_2FA_REQUIRED;
  });

  it("stays open when the variable is not set and the second factor was never stored", async () => {
    expect((await twoFactor.twoFactorState()).known).toBe(false);
    expect(await call()).toEqual({ ok: true, status: 200 });
  });

  it("closes the admin when the variable is 1 and the second factor is not found", async () => {
    process.env.ADMIN_2FA_REQUIRED = "1";
    expect(await call()).toEqual({ ok: false, status: 503 });
  });

  it("lets the owner in again once they turned the second factor off on purpose", async () => {
    await twoFactor.disableTwoFactor();
    expect((await twoFactor.twoFactorState()).known).toBe(true);
    expect(await call()).toEqual({ ok: true, status: 200 });
  });
});
