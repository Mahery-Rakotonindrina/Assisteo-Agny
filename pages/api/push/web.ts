import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { activeProvider } from "@/lib/ai/provider";
import { clientIp, sendError } from "@/lib/server/http";
import { resolvePlan } from "@/lib/server/plan";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { accountsEnabled, supabaseAdmin, verifyAccount } from "@/lib/server/supabaseAdmin";
import { vapidPublicKey } from "@/lib/server/webPush";
import { isPushEndpoint, subscriptionToken } from "@/lib/webPush";

// Web Push for reminders (the site on an iPhone home screen, and browsers):
// GET gives the VAPID public key (null: Web Push is off, the button stays
// hidden) and whether this device's row is kept; POST keeps this browser's subscription for the signed-in account,
// as a push_devices row with platform "web" (migration 0017); DELETE forgets it.

const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const DeviceSchema = z.object({ deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/) });
const SubscribeSchema = DeviceSchema.extend({
  subscription: z.object({
    endpoint: z.string().max(1000).refine(isPushEndpoint, "Not a push service."),
    keys: z.object({ p256dh: base64Url.min(80).max(100), auth: base64Url.min(16).max(40) }),
  }),
});

/** Web Push off without the VAPID keys, without accounts, and in demo mode. */
const publicKey = () => (accountsEnabled && activeProvider !== "demo" ? vapidPublicKey : null);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    const key = publicKey();
    // With ?deviceId and a session: whether this browser's row is kept (only then does the page leave its reminders to the push).
    const device = DeviceSchema.safeParse({ deviceId: req.query.deviceId });
    if (!key || !device.success) return res.status(200).json({ publicKey: key, registered: false });
    const burst = await rateLimit(`web-push:read:${clientIp(req)}`, 30, 60_000);
    if (!burst.ok) {
      res.setHeader("Retry-After", String(burst.retryAfterS));
      return sendError(res, 429, "rate_limited", "Too many requests, try again in a moment.");
    }
    const account = await verifyAccount(req).catch(() => null);
    if (!account) return res.status(200).json({ publicKey: key, registered: false });
    const { data, error } = await supabaseAdmin()
      .from("push_devices")
      .select("device_id")
      .eq("user_id", account.id)
      .eq("device_id", device.data.deviceId)
      .eq("platform", "web")
      .maybeSingle();
    // An error is a doubt: the page keeps its own reminders.
    if (error) return sendError(res, 502, "upstream_error", "Couldn't read this device.");
    return res.status(200).json({ publicKey: key, registered: data !== null });
  }
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return sendError(res, 405, "method_not_allowed", "Use GET, POST or DELETE.");
  }
  if (!publicKey()) return sendError(res, 503, "unavailable", "Web Push is not configured.");

  const burst = await rateLimit(`web-push:${clientIp(req)}`, 10, 60_000);
  if (!burst.ok) {
    res.setHeader("Retry-After", String(burst.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many requests, try again in a moment.");
  }

  const { account, features } = await resolvePlan(req);
  if (!account) return sendError(res, 401, "sign_in_required", "Sign in to receive reminders.");
  const db = supabaseAdmin();

  if (req.method === "DELETE") {
    const parsed = DeviceSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid request.");
    const { error } = await db.from("push_devices").delete().eq("user_id", account.id).eq("device_id", parsed.data.deviceId).eq("platform", "web");
    if (error) {
      await reportError(new Error(`push_devices delete failed (${error.code})`), { route: "push-web" });
      return sendError(res, 502, "upstream_error", "Couldn't remove this device.");
    }
    return res.status(204).end();
  }

  // Reminders are for the plans that have them, checked here, not only by the hidden button.
  if (!features.has("reminders")) return sendError(res, 403, "plan_required", "Reminders are not part of your plan.");
  const parsed = SubscribeSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", "Invalid subscription.");
  const token = subscriptionToken(parsed.data.subscription);
  const { error } = await db
    .from("push_devices")
    .upsert({ user_id: account.id, device_id: parsed.data.deviceId, token, platform: "web", scheduled: [], updated_at: new Date().toISOString() }, { onConflict: "user_id,device_id" });
  if (error) {
    // Only the code: the row (the subscription) stays out of the logs.
    await reportError(new Error(`push_devices upsert failed (${error.code})`), { route: "push-web" });
    // 23514: the platform check of 0003, before migration 0017.
    if (error.code === "23514") return sendError(res, 503, "migration_needed", "Migration 0017 is not applied.");
    return sendError(res, 502, "upstream_error", "Couldn't save this device.");
  }
  // The same browser signed in to another account before: it stops getting that account's reminders.
  await db.from("push_devices").delete().eq("platform", "web").eq("token", token).neq("user_id", account.id);
  return res.status(204).end();
}
