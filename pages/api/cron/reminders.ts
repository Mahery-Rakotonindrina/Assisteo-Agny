import type { NextApiRequest, NextApiResponse } from "next";
import { isCron } from "@/lib/server/cronAuth";
import { pushEnabled, sendPush } from "@/lib/server/fcm";
import { sendError } from "@/lib/server/http";
import { isPending, nextReminderAt, planPushes, type DueRow, type PushDevice, type PushLocale } from "@/lib/server/reminderPush";
import { reportError } from "@/lib/server/reportError";
import { accountsEnabled, supabaseAdmin } from "@/lib/server/supabaseAdmin";

// Every few minutes (GitHub Actions, .github/workflows/reminders.yml): pushes
// reminders that are due to the user's Android devices that don't already
// hold them as local notifications (see services/push.ts). A recurring
// reminder then moves on to its next occurrence (reminder_at), which the
// devices pick up at their next sync.

export const config = { maxDuration: 60 };

/** Reminders older than this are dropped rather than pushed late. */
const MAX_LATENESS_MS = 6 * 3600_000;
const BATCH = 200;
/** How far back a missed recurring reminder is still moved on to its next occurrence. */
const MAX_CATCH_UP_MS = 400 * 86_400_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Use GET or POST.");
  if (!isCron(req, { required: true })) return sendError(res, 401, "invalid_key", "Unauthorized.");
  res.setHeader("Cache-Control", "no-store");
  if (!pushEnabled || !accountsEnabled) return res.status(200).json({ skipped: "push not configured" });

  const db = supabaseAdmin();
  const now = new Date();
  const { data, error } = await db
    .from("analyses")
    .select("user_id, id, analysis, meta, reminder_at, reminder_pushed_at")
    .is("deleted_at", null)
    .lte("reminder_at", now.toISOString())
    .gt("reminder_at", new Date(now.getTime() - MAX_LATENESS_MS).toISOString())
    .order("reminder_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    await reportError(error, { route: "cron-reminders", step: "due" });
    return sendError(res, 502, "upstream_error", "Couldn't read reminders.");
  }

  // Recurring reminders missed by the cron (too late to push): moved on silently.
  const missed = await db
    .from("analyses")
    .select("user_id, id, meta, reminder_at")
    .is("deleted_at", null)
    .not("meta->reminderRepeat", "is", null)
    .lte("reminder_at", new Date(now.getTime() - MAX_LATENESS_MS).toISOString())
    .gt("reminder_at", new Date(now.getTime() - MAX_CATCH_UP_MS).toISOString())
    .limit(BATCH);
  let advanced = 0;
  for (const row of (missed.data ?? []) as DueRow[]) {
    const next = nextReminderAt(row, now.getTime());
    if (!next) continue;
    await db.from("analyses").update({ reminder_at: next, updated_at: now.toISOString() }).eq("user_id", row.user_id).eq("id", row.id);
    advanced += 1;
  }

  const due = (data as DueRow[]).filter(isPending);
  if (due.length === 0) return res.status(200).json({ due: 0, sent: 0, advanced });

  const userIds = [...new Set(due.map((row) => row.user_id))];
  const [devices, settings] = await Promise.all([
    db.from("push_devices").select("user_id, device_id, token, scheduled").in("user_id", userIds),
    db.from("user_settings").select("user_id, data").in("user_id", userIds),
  ]);
  if (devices.error) {
    await reportError(devices.error, { route: "cron-reminders", step: "devices" });
    return sendError(res, 502, "upstream_error", "Couldn't read devices.");
  }
  const locales = new Map<string, PushLocale>(
    (settings.data ?? []).map((row) => [row.user_id as string, (row.data as { locale?: string } | null)?.locale === "en" ? "en" : "fr"]),
  );

  let sent = 0;
  const stale = new Map<string, PushDevice>();
  // Entries whose every push failed for a transient reason: retried next run.
  const outcome = new Map<string, { delivered: boolean; failed: boolean }>();
  for (const push of planPushes(due, devices.data as PushDevice[], locales)) {
    const result = await sendPush(push.device.token, { title: push.title, body: push.body, data: { entryId: push.entryId } }).catch(
      () => "error" as const,
    );
    const state = outcome.get(push.entryId) ?? { delivered: false, failed: false };
    if (result === "sent") {
      sent += 1;
      state.delivered = true;
    } else if (result === "invalid_token") {
      stale.set(`${push.device.user_id}/${push.device.device_id}`, push.device);
    } else {
      state.failed = true;
    }
    outcome.set(push.entryId, state);
  }

  // Marked even without a target: devices holding it locally have shown it.
  let retried = 0;
  for (const row of due) {
    const state = outcome.get(row.id);
    if (state?.failed && !state.delivered) {
      retried += 1;
      continue;
    }
    // A recurring reminder moves on; updated_at so the devices take the new time over theirs.
    const next = nextReminderAt(row, now.getTime());
    await db
      .from("analyses")
      .update({ reminder_pushed_at: now.toISOString(), ...(next && { reminder_at: next, updated_at: now.toISOString() }) })
      .eq("user_id", row.user_id)
      .eq("id", row.id);
    if (next) advanced += 1;
  }
  if (retried > 0) await reportError(new Error(`${retried} reminder push(es) failed, will retry`), { route: "cron-reminders", step: "send" });
  for (const device of stale.values()) {
    await db.from("push_devices").delete().eq("user_id", device.user_id).eq("device_id", device.device_id);
  }
  return res.status(200).json({ due: due.length, sent, retried, advanced, removedDevices: stale.size });
}
