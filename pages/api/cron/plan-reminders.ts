import type { NextApiRequest, NextApiResponse } from "next";
import { isCron } from "@/lib/server/cronAuth";
import { pushEnabled, sendPush } from "@/lib/server/fcm";
import { sendError } from "@/lib/server/http";
import { dueNotices, noticeKey, noticeMessage, type PlanNotice } from "@/lib/server/planReminders";
import { redis } from "@/lib/server/redis";
import type { PushDevice, PushLocale } from "@/lib/server/reminderPush";
import { reportError } from "@/lib/server/reportError";
import { listSubscriptions } from "@/lib/server/subscriptions";
import { accountsEnabled, supabaseAdmin } from "@/lib/server/supabaseAdmin";

// Every few minutes, with the reminder pushes (.github/workflows/reminders.yml):
// tells subscribers on their Android devices that their plan ends in three
// days, ends today, or has ended. Each moment is pushed once (Redis).

export const config = { maxDuration: 60 };

const CLAIM_TTL_S = 10 * 24 * 3600;
// Without Redis (local development): this instance only.
const memoryClaims = new Set<string>();

/** Takes the right to send this reminder; false if it was already sent. */
async function claim(key: string) {
  if (!redis) {
    if (memoryClaims.has(key)) return false;
    memoryClaims.add(key);
    return true;
  }
  return (await redis.set(key, 1, { nx: true, ex: CLAIM_TTL_S })) === "OK";
}

async function release(key: string) {
  if (redis) await redis.del(key);
  else memoryClaims.delete(key);
}

/** Account ids of these e-mails (the subscriptions are kept by e-mail). */
async function userIdsByEmail(emails: Set<string>) {
  const ids = new Map<string, string>();
  const db = supabaseAdmin();
  for (let page = 1; ids.size < emails.size; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      const email = user.email?.toLowerCase();
      if (email && emails.has(email)) ids.set(email, user.id);
    }
    if (data.users.length < 1000) break;
  }
  return ids;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Use GET or POST.");
  if (!isCron(req, { required: true })) return sendError(res, 401, "invalid_key", "Unauthorized.");
  res.setHeader("Cache-Control", "no-store");
  if (!pushEnabled || !accountsEnabled) return res.status(200).json({ skipped: "push not configured" });

  try {
    const notices = dueNotices(await listSubscriptions(), Date.now());
    const claimed: PlanNotice[] = [];
    for (const notice of notices) if (await claim(noticeKey(notice))) claimed.push(notice);
    if (claimed.length === 0) return res.status(200).json({ due: notices.length, sent: 0 });

    const db = supabaseAdmin();
    const ids = await userIdsByEmail(new Set(claimed.map((notice) => notice.email)));
    const userIds = [...new Set(ids.values())];
    const [devices, settings] = userIds.length
      ? await Promise.all([
          db.from("push_devices").select("user_id, device_id, token, scheduled").in("user_id", userIds),
          db.from("user_settings").select("user_id, data").in("user_id", userIds),
        ])
      : [{ data: [], error: null }, { data: [] }];
    if (devices.error) throw devices.error;
    const locales = new Map<string, PushLocale>(
      (settings.data ?? []).map((row) => [row.user_id as string, (row.data as { locale?: string } | null)?.locale === "en" ? "en" : "fr"]),
    );

    let sent = 0;
    let retried = 0;
    for (const notice of claimed) {
      const userId = ids.get(notice.email);
      const targets = ((devices.data ?? []) as PushDevice[]).filter((device) => device.user_id === userId);
      // No account or no Android device: the app's banner says it when they open it.
      if (targets.length === 0) continue;
      const message = noticeMessage(notice, locales.get(userId!) ?? "fr");
      let delivered = false;
      let failed = false;
      for (const device of targets) {
        const result = await sendPush(device.token, { ...message, data: { route: "/plans" } }).catch(() => "error" as const);
        if (result === "sent") delivered = true;
        else if (result === "error") failed = true;
      }
      if (delivered) sent += 1;
      else if (failed) {
        // Every device failed for a passing reason: try again next run.
        retried += 1;
        await release(noticeKey(notice));
      }
    }
    return res.status(200).json({ due: notices.length, claimed: claimed.length, sent, retried });
  } catch (error) {
    await reportError(error, { route: "cron-plan-reminders" });
    return sendError(res, 502, "upstream_error", "Couldn't send the plan reminders.");
  }
}
