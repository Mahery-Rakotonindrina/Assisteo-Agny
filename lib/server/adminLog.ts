import { redis } from "./redis";

// What was done in /admin, and by whom: the owner (the admin token), an
// admin's e-mail (their own account), or the APK workflow. Kept in Redis as
// a capped list, newest first; in memory when Redis is not configured.

const KEY = "admin:log";
/** The latest actions kept; older ones drop off. */
export const ADMIN_LOG_MAX = 500;

export type AdminAction =
  | "login"
  | "subscription_add"
  | "subscription_edit"
  | "subscription_stop"
  | "subscription_delete"
  | "plans_save"
  /** A plan's features ticked or unticked (Admin → Offers). */
  | "feature_plans"
  /** A feature on, in test or switched off. */
  | "feature_status"
  /** A plan's features changed for new subscriptions only: the running ones keep theirs. */
  | "feature_keep"
  /** A feature offered to an account for a while, or that offer stopped. */
  | "feature_grant"
  | "feature_grant_stop"
  | "trial_save"
  | "promo_create"
  | "promo_enable"
  | "promo_disable"
  | "promo_delete"
  | "promo_discount_used"
  | "referral_reward"
  | "app_save"
  | "two_factor_on"
  | "two_factor_off"
  | "two_factor_codes";

export type AdminLogEntry = {
  at: number;
  /** "owner", "github" or an admin's e-mail. */
  actor: string;
  action: AdminAction;
  /** What it was about: an e-mail and a plan, a version… */
  detail?: string;
};

let memory: AdminLogEntry[] = [];

/** Records an action; a failure to record never blocks the action itself. */
export async function logAdminAction(actor: string, action: AdminAction, detail?: string) {
  const entry: AdminLogEntry = { at: Date.now(), actor, action, ...(detail && { detail: detail.slice(0, 300) }) };
  try {
    if (redis) {
      await redis.lpush(KEY, entry);
      await redis.ltrim(KEY, 0, ADMIN_LOG_MAX - 1);
    } else {
      memory = [entry, ...memory].slice(0, ADMIN_LOG_MAX);
    }
  } catch {
    // The log is a record, not a gate.
  }
}

/** The latest actions, newest first. */
export async function readAdminLog(limit = ADMIN_LOG_MAX): Promise<AdminLogEntry[]> {
  if (!redis) return memory.slice(0, limit);
  const items = await redis.lrange<AdminLogEntry | string>(KEY, 0, limit - 1);
  // Upstash gives back the objects it stored; a raw string is parsed.
  return items.map((item) => (typeof item === "string" ? (JSON.parse(item) as AdminLogEntry) : item));
}
