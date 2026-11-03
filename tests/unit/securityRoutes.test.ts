import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";

// Routes with their real stores in memory (no Redis): never production.
const state = vi.hoisted(() => ({ email: "moi@gmail.com", subs: [] as Array<{ email: string; plan: string }> }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/reportError", () => ({ reportError: async () => undefined }));
vi.mock("@/lib/server/planConfig", async () => {
  const { defaultPlansConfig } = await import("@/lib/plans");
  return { getPlansConfig: async () => defaultPlansConfig };
});
vi.mock("@/lib/server/supabaseAdmin", () => ({
  accountsEnabled: false,
  supabaseAdmin: null,
  verifyAccount: async () => ({ id: "u1", email: state.email }),
  verifyUser: async () => null,
}));
vi.mock("@/lib/server/subscriptions", () => ({
  subscriptionsForEmail: async (email: string) => state.subs.filter((s) => s.email === email),
  addSubscriptions: async (rows: Array<{ email: string; plan: string }>) => {
    state.subs.push(...rows);
  },
}));

const { default: trialRoute } = await import("@/pages/api/offers/trial");
const { default: planTrial } = await import("@/pages/api/trial");
const { default: health } = await import("@/pages/api/health");

function call(handler: (q: NextApiRequest, r: NextApiResponse) => unknown, method: string, ip: string, headers: Record<string, string> = {}, query: Record<string, string> = {}) {
  const out = { code: 0, body: undefined as unknown };
  const req = { method, headers, query, socket: { remoteAddress: ip }, body: {} } as unknown as NextApiRequest;
  const res = {
    statusCode: 200,
    status(c: number) {
      out.code = c;
      return this;
    },
    json(b: unknown) {
      out.body = b;
      return this;
    },
    setHeader() {},
    end() {
      return this;
    },
  } as unknown as NextApiResponse;
  return Promise.resolve(handler(req, res)).then(() => out);
}

const install = () => ({ "x-install-id": Math.random().toString(16).slice(2).padEnd(24, "0").slice(0, 24) });

describe("Premium trial route", () => {
  it("gives one trial for moi, moi+1 and m.o.i@gmail.com together; an older app without install id works", async () => {
    state.email = "moi@gmail.com";
    expect((await call(trialRoute, "POST", "203.0.113.1")).code).toBe(201);
    for (const email of ["moi+1@gmail.com", "moi+2@gmail.com", "m.o.i@gmail.com", "MOI@googlemail.com"]) {
      state.email = email;
      expect((await call(trialRoute, "POST", "203.0.113.2", install())).code).toBe(403);
    }
    state.email = "autre@example.com";
    expect((await call(trialRoute, "POST", "203.0.113.3", install())).code).toBe(201);
  });
});

describe("rate limits and compatibility", () => {
  it("limits /api/trial per IP, and answers 400 without an install id", async () => {
    expect((await call(planTrial, "GET", "198.51.100.5")).code).toBe(400);
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await call(planTrial, "GET", "198.51.100.6", install())).code;
    expect(last).toBe(429);
  });

  it("keeps /api/health readable without a model", async () => {
    const r = await call(health, "GET", "198.51.100.7");
    expect(r.code).toBe(200);
    expect(r.body).not.toHaveProperty("model");
    expect(r.body).toMatchObject({ status: "ok" });
  });
});
