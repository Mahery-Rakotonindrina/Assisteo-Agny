import type { NextApiRequest, NextApiResponse } from "next";
import { HouseholdActionSchema, householdErrorOf, householdFromState, type HouseholdResponse } from "@/lib/household";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { resolvePlan } from "@/lib/server/plan";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { accountsEnabled, supabaseAdmin } from "@/lib/server/supabaseAdmin";

/** Codes tried per account and hour: 26^6 codes can't be guessed at this pace. */
const JOINS_PER_HOUR = 10;
const INVITES_PER_DAY = 20;
const HOUR_MS = 60 * 60 * 1000;

/** A database function, as the server, for the verified user (0009_households.sql). */
async function call<T>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/**
 * "Mes dépenses" shared with the family. GET: the user's household. POST: create
 * one (Admin plan), join with a code (any account), and the owner's tools
 * (code, name, budget, members). Every check is in the database functions,
 * called with the verified user's id; the shared expenses sync directly, under RLS.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<HouseholdResponse | unknown>) {
  if (applyCors(req, res, ["GET", "POST"])) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use GET or POST.");
  }

  const burst = await rateLimit(`household:${clientIp(req)}`, 30, 60_000);
  if (!burst.ok) return sendError(res, 429, "rate_limited", "Too many requests, try again in a moment.");
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured.");

  const { account, features } = await resolvePlan(req);
  if (!account) return sendError(res, 401, "sign_in_required", "Sign in to share a budget.");
  const user = account.id;
  const state = async (): Promise<HouseholdResponse> => ({ userId: user, household: householdFromState(await call<unknown>("household_state", { p_user: user })) });

  try {
    if (req.method === "GET") return res.status(200).json(await state());

    const parsed = HouseholdActionSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
    const action = parsed.data;

    if (action.action === "create") {
      if (!features.has("expenses")) return sendError(res, 403, "plan_required", "Creating a household is not part of your plan.");
      await call("create_household", { p_user: user, p_name: action.name });
      return res.status(200).json(await state());
    }
    if (action.action === "join") {
      const tries = await rateLimit(`household:join:${user}`, JOINS_PER_HOUR, HOUR_MS);
      if (!tries.ok) {
        res.setHeader("Retry-After", String(tries.retryAfterS));
        return sendError(res, 429, "rate_limited", "Too many codes tried, try again later.");
      }
      await call("join_household", { p_user: user, p_code: action.code.toUpperCase().replace(/[\s\-_.]/g, "") });
      return res.status(200).json(await state());
    }

    const household = (await state()).household;
    if (!household) return sendError(res, 404, "not_member", "No household.");
    const ids = { p_user: user, p_household: household.id };

    switch (action.action) {
      case "invite": {
        const daily = await rateLimit(`household:invite:${user}`, INVITES_PER_DAY, 24 * HOUR_MS);
        if (!daily.ok) return sendError(res, 429, "rate_limited", "Too many codes today.");
        await call("create_household_invite", ids);
        break;
      }
      case "revoke":
        await call("revoke_household_invites", ids);
        break;
      case "update":
        await call("update_household", {
          ...ids,
          p_data: { name: action.name ?? household.name, budget: action.budget ?? household.budget },
        });
        break;
      case "remove":
        await call("remove_household_member", { ...ids, p_member: action.userId });
        break;
      case "leave":
        await call("remove_household_member", { ...ids, p_member: user });
        break;
      case "delete":
        await call("delete_household", ids);
        break;
    }
    return res.status(200).json(await state());
  } catch (error) {
    const known = householdErrorOf(error instanceof Error ? error.message : (error as { message?: string })?.message);
    if (known) return sendError(res, known.status, known.code, "Household request refused.");
    console.error("[household]", error instanceof Error ? error.message : error);
    await reportError(error, { route: "household" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
