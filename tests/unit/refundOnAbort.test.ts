import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";

// The route's dependencies: an AI engine that fails or waits for the caller to hang up, a free visitor.
const state = vi.hoisted(() => ({ mode: "fail" as "fail" | "wait" }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/reportError", () => ({ reportError: async () => undefined }));
vi.mock("@/lib/server/stats", () => ({ track: async () => undefined }));
vi.mock("@/lib/ai/provider", () => ({
  activeProvider: "gemini",
  readOverride: () => null,
  askQuestion: (_input: unknown, signal: AbortSignal) =>
    new Promise((_, reject) => {
      if (state.mode === "fail") return reject(new Error("The AI is down."));
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
}));
vi.mock("@/lib/server/plan", () => ({
  resolvePlan: async () => {
    const { defaultPlansConfig, effectiveFeatures } = await import("@/lib/plans");
    return { account: null, current: { plan: "free", endsAt: null }, features: effectiveFeatures({ plan: "free", email: null, config: defaultPlansConfig }), quotas: null, onTrial: false };
  },
}));

const { default: askRoute } = await import("@/pages/api/ask");
const { getAskUsage } = await import("@/lib/server/trialStore");

async function ask(installId: string, ip: string, hangUp: boolean) {
  const closers: Array<() => void> = [];
  const req = {
    method: "POST",
    headers: { "x-install-id": installId },
    socket: { remoteAddress: ip },
    body: { image: "abc", mediaType: "image/jpeg", analysis: mockAnalysis("object", "fr"), messages: [{ role: "user", content: "Combien ça coûte ?" }], locale: "fr" },
  } as unknown as NextApiRequest;
  const res = {
    statusCode: 200,
    writableEnded: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      this.writableEnded = true;
      return this;
    },
    setHeader() {},
    on(event: string, callback: () => void) {
      if (event === "close") closers.push(callback);
    },
  };
  const done = askRoute(req, res as unknown as NextApiResponse);
  // The client hangs up while the AI is still thinking.
  if (hangUp) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const close of closers) close();
  }
  await done;
  return res.statusCode;
}

describe("questions given back", () => {
  const install = (suffix: string) => `refund${suffix}`.padEnd(24, "0");

  it("gives the day's question back when the AI itself fails", async () => {
    state.mode = "fail";
    const id = install("a");
    expect(await ask(id, "198.51.100.1", false)).toBe(500);
    expect(await getAskUsage(id)).toBe(0);
  });

  it("keeps it when the caller hangs up: the AI may already have been billed", async () => {
    state.mode = "wait";
    const id = install("b");
    await ask(id, "198.51.100.2", true);
    expect(await getAskUsage(id)).toBe(1);
  });
});
