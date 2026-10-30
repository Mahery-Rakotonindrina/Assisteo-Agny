import type { NextApiRequest, NextApiResponse } from "next";
import { activePlan, customPlanInfo, customPlanOf, type ActivePlan, type CustomPlanInfo, type Subscription } from "@/lib/plans";
import { getPlansConfig } from "@/lib/server/planConfig";
import { guardAdmin } from "@/lib/server/adminAuth";
import { sendError } from "@/lib/server/http";
import { reportError } from "@/lib/server/reportError";
import { listSubscriptions } from "@/lib/server/subscriptions";
import { accountsEnabled, supabaseAdmin } from "@/lib/server/supabaseAdmin";

export type AdminAccount = {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  /** How they sign in: "email", "google"… */
  providers: string[];
  /** The plan running now ("free" without one), and until when. */
  plan: ActivePlan["plan"];
  planEndsAt: number | null;
  /** A plan created from the Admin (then `plan` is the built-in one just below); missing or null otherwise. */
  customPlan?: CustomPlanInfo | null;
};

export type AdminAccountsResponse = { accounts: AdminAccount[] };

const PER_PAGE = 1000;
/** Enough for this app's audience; the list stops there rather than time out. */
const MAX_PAGES = 20;

/** Admin-only: every account, signed up or not subscribed, newest first, with its plan. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminAccountsResponse | unknown>) {
  if (!(await guardAdmin(req, res))) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendError(res, 405, "method_not_allowed", "Use GET.");
  }
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured on the server.");

  try {
    const users = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, error } = await supabaseAdmin().auth.admin.listUsers({ page, perPage: PER_PAGE });
      if (error) throw new Error(`accounts: ${error.message}`);
      users.push(...data.users);
      if (data.users.length < PER_PAGE) break;
    }
    const byEmail = new Map<string, Subscription[]>();
    for (const row of await listSubscriptions()) byEmail.set(row.email, [...(byEmail.get(row.email) ?? []), row]);

    const now = Date.now();
    const { customPlans } = await getPlansConfig();
    const accounts = users
      .map((user): AdminAccount => {
        const email = user.email?.toLowerCase() ?? null;
        const current = activePlan(email ? (byEmail.get(email) ?? []) : [], now, customPlans);
        const created = customPlanOf({ customPlans }, current.custom);
        return {
          id: user.id,
          email,
          createdAt: user.created_at,
          lastSignInAt: user.last_sign_in_at ?? null,
          providers: [...new Set((user.identities ?? []).map((identity) => identity.provider))],
          plan: current.plan,
          planEndsAt: current.endsAt,
          customPlan: created ? customPlanInfo(created, customPlans) : null,
        };
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return res.status(200).json({ accounts } satisfies AdminAccountsResponse);
  } catch (error) {
    await reportError(error, { route: "admin/accounts" });
    return sendError(res, 500, "upstream_error", "The accounts could not be read.");
  }
}
