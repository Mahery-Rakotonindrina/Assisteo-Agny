import type { NextApiRequest, NextApiResponse } from "next";
import { activeModel, activeProvider } from "@/lib/ai/provider";
import type { HealthResponse } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { redis } from "@/lib/server/redis";
import { accountsEnabled, supabaseAdmin } from "@/lib/server/supabaseAdmin";

type CheckState = "ok" | "down" | "off";

/** "?deep=1": the database and Redis answer too (the uptime workflow). 503 when one is down. */
export type HealthChecksResponse = Omit<HealthResponse, "status"> & {
  status: "ok" | "down";
  checks: { database: CheckState; redis: CheckState };
};

const TIMEOUT_MS = 5000;

async function check(run: (signal: AbortSignal) => Promise<unknown>): Promise<CheckState> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    await Promise.race([
      run(abort.signal),
      new Promise((_, reject) => abort.signal.addEventListener("abort", () => reject(new Error("timeout")))),
    ]);
    return "ok";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<HealthResponse | HealthChecksResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");

  const base = { ai: activeProvider === "demo" ? "demo" : "live", provider: activeProvider, model: activeModel } as const;
  if (req.query.deep === undefined) return res.status(200).json({ status: "ok", ...base } satisfies HealthResponse);

  res.setHeader("Cache-Control", "no-store");
  const limit = await rateLimit(`health:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return sendError(res, 429, "rate_limited", "Too many checks.");

  const cache = redis;
  const [database, redisState] = await Promise.all([
    accountsEnabled
      ? check(async (signal) => {
          const { error } = await supabaseAdmin().from("subscriptions").select("id", { head: true }).limit(1).abortSignal(signal);
          if (error) throw error;
        })
      : Promise.resolve<CheckState>("off"),
    cache ? check(() => cache.ping()) : Promise.resolve<CheckState>("off"),
  ]);
  const checks = { database, redis: redisState };
  const down = Object.values(checks).includes("down");
  return res.status(down ? 503 : 200).json({ status: down ? "down" : "ok", ...base, checks } satisfies HealthChecksResponse);
}
