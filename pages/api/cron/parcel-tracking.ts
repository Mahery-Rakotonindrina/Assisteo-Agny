import type { NextApiRequest, NextApiResponse } from "next";
import type { ParcelStatus } from "@/lib/ai/schema";
import { mergeTracking, parcelsToCheck, trackedInfo, trackingKey, trackingSignature, type Track17Item, type TrackedParcel } from "@/lib/parcelTracking";
import { isCron } from "@/lib/server/cronAuth";
import { pushEnabled } from "@/lib/server/fcm";
import { usersWithFeature } from "@/lib/server/featureUsers";
import { sendError } from "@/lib/server/http";
import { sendToDevice } from "@/lib/server/pushSend";
import { reachableDevices, type PushDevice } from "@/lib/server/reminderPush";
import { reportError } from "@/lib/server/reportError";
import { accountsEnabled, supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { ensureRegistered, lastNotified, rememberNotified, track17Mode, trackInfo } from "@/lib/server/track17";
import { webPushEnabled } from "@/lib/server/webPush";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

// Every 3 hours (GitHub Actions, .github/workflows/parcel-tracking.yml): asks
// 17TRACK about the parcels Premium users follow with a tracking number
// (synced rows of "parcels"), writes a change of status into the row, and
// notifies the user's devices. Without TRACK17_API_KEY it sleeps.
//
// The row is updated in place: only the tracking fields of its JSON change
// (lib/parcelTracking.ts, mergeTracking), on the row as it is now (a row
// changed meanwhile is read again), and updated_at moves by 1 ms only. A
// device that has the row as it was takes the new one at its next sync; a
// device with an edit of its own not yet sent keeps it (its updatedAt is
// later) and sends it: the next run writes the status again, without a
// second notification (lastNotified).

export const config = { maxDuration: 60 };

/** Distinct tracking numbers asked about per run: a few requests, within the time limit. */
const MAX_NUMBERS = 120;
/** Rows read per page, and pages at most (parcels of allowed users). */
const PAGE = 500;
const MAX_PAGES = 10;
/** Owners of parcels on their way: user ids only (a light read), pages of this size, at most this many. */
const OWNER_PAGE = 1000;
const MAX_OWNER_PAGES = 20;
/** Users per read of their parcels (the length of the "in" filter in the URL). */
const USERS_PER_READ = 100;

type Row = { user_id: string; id: string; data: TrackedParcel; updated_at: string };
type Locale = "fr" | "en";

const dictionaries = { fr, en };
const labelsFor = (locale: Locale) => dictionaries[locale].parcel.statuses as Record<ParcelStatus, string>;
const fill = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Use GET or POST.");
  if (!isCron(req, { required: true })) return sendError(res, 401, "invalid_key", "Unauthorized.");
  res.setHeader("Cache-Control", "no-store");
  if (track17Mode() === "off") return res.status(200).json({ skipped: "tracking not configured" });
  if (!accountsEnabled) return res.status(200).json({ skipped: "accounts not configured" });

  const db = supabaseAdmin();
  const now = Date.now();

  // Parcels on their way with a tracking number (the rest of the choice: parcelsToCheck).
  const onTheWay = (columns: string) =>
    db
      .from("parcels")
      .select(columns)
      .is("deleted_at", null)
      .not("data->info->>trackingNumber", "is", null)
      .not("data->info->>status", "in", "(delivered,returned)")
      .is("data->>receivedAt", null);

  // First the users whose plan has the tracking, among the owners of such parcels (their ids only):
  // the parcels of other plans never take the place of theirs in the pages read next.
  const owners = new Set<string>();
  let allowed: Set<string>;
  try {
    for (let page = 0; page < MAX_OWNER_PAGES; page += 1) {
      const { data, error } = await onTheWay("user_id")
        .order("user_id")
        .order("id")
        .range(page * OWNER_PAGE, page * OWNER_PAGE + OWNER_PAGE - 1);
      if (error) throw error;
      for (const row of (data ?? []) as unknown as Array<{ user_id: string }>) owners.add(row.user_id);
      if ((data ?? []).length < OWNER_PAGE) break;
    }
  } catch (error) {
    await reportError(error, { route: "cron-parcel-tracking", step: "parcels" });
    return sendError(res, 502, "upstream_error", "Couldn't read parcels.");
  }
  if (owners.size === 0) return res.status(200).json({ checked: 0, changed: 0, sent: 0 });
  try {
    allowed = await usersWithFeature(db, [...owners], now, "parcelAutoTrack");
  } catch (error) {
    await reportError(error, { route: "cron-parcel-tracking", step: "plans" });
    return sendError(res, 502, "upstream_error", "Couldn't read plans.");
  }

  // Then only their parcels.
  const rows: Row[] = [];
  const allowedIds = [...allowed];
  try {
    let pages = 0;
    for (let start = 0; start < allowedIds.length && pages < MAX_PAGES; start += USERS_PER_READ) {
      const users = allowedIds.slice(start, start + USERS_PER_READ);
      for (let page = 0; pages < MAX_PAGES; page += 1, pages += 1) {
        const { data, error } = await onTheWay("user_id, id, data, updated_at")
          .in("user_id", users)
          .order("id")
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as unknown as Row[]));
        if ((data ?? []).length < PAGE) break;
      }
    }
  } catch (error) {
    await reportError(error, { route: "cron-parcel-tracking", step: "parcels" });
    return sendError(res, 502, "upstream_error", "Couldn't read parcels.");
  }
  const picked = parcelsToCheck(
    rows.filter((row) => allowed.has(row.user_id) && row.data && row.data.info).map((row) => ({ row, parcel: row.data })),
    now,
    MAX_NUMBERS,
  );
  if (picked.length === 0) return res.status(200).json({ checked: 0, changed: 0, sent: 0 });

  let found: Map<string, Track17Item>;
  // Numbers 17TRACK refused (now, or within the last 7 days): marked on the parcel, not shown as followed.
  let refused = new Set<string>();
  try {
    const numbers = [...new Set(picked.map(({ parcel }) => trackingKey(parcel.info.trackingNumber)!))];
    const tracked = await ensureRegistered(numbers);
    refused = new Set(numbers.filter((number) => !tracked.includes(number)));
    found = await trackInfo(tracked, now);
  } catch (error) {
    await reportError(error, { route: "cron-parcel-tracking", step: "17track" });
    return sendError(res, 502, "upstream_error", "Couldn't reach 17TRACK.");
  }

  const userIds = [...new Set(picked.map(({ row }) => row.user_id))];
  const settings = await db.from("user_settings").select("user_id, locale:data->>locale, parcelNotify:data->>parcelNotify").in("user_id", userIds);
  const prefs = new Map(
    ((settings.data ?? []) as Array<{ user_id: string; locale?: string | null; parcelNotify?: string | null }>).map((row) => [
      row.user_id,
      { locale: (row.locale === "en" ? "en" : "fr") as Locale, notify: row.parcelNotify !== "false" },
    ]),
  );
  const prefsOf = (userId: string) => prefs.get(userId) ?? { locale: "fr" as Locale, notify: true };

  let checked = 0;
  const changed: Array<{ userId: string; parcel: TrackedParcel }> = [];
  for (const { row } of picked) {
    const item = found.get(trackingKey(row.data.info.trackingNumber)!);
    // Nothing from 17TRACK (a number it refused, or nothing yet): the check is still noted, so the
    // parcel goes to the back of the queue instead of taking a place first at every run.
    const update = item ? trackedInfo(item, labelsFor(prefsOf(row.user_id).locale)) : null;
    let current = row;
    // Twice at most: a row changed meanwhile (a device synced) is read again and merged anew.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const merged = mergeTracking(current.data, update, now, { refused: refused.has(trackingKey(current.data.info.trackingNumber) ?? "") });
      const { data, error } = await db
        .from("parcels")
        .update({ data: merged.parcel, updated_at: new Date(Date.parse(current.updated_at) + 1).toISOString() })
        .eq("user_id", current.user_id)
        .eq("id", current.id)
        .eq("updated_at", current.updated_at)
        .is("deleted_at", null)
        .select("id");
      if (error) {
        await reportError(error, { route: "cron-parcel-tracking", step: "update" });
        break;
      }
      if ((data ?? []).length > 0) {
        checked += 1;
        if (merged.changed) changed.push({ userId: row.user_id, parcel: merged.parcel });
        break;
      }
      const again = await db.from("parcels").select("user_id, id, data, updated_at").eq("user_id", row.user_id).eq("id", row.id).is("deleted_at", null).maybeSingle();
      if (again.error || !again.data || !(again.data as Row).data?.info) break;
      current = again.data as Row;
    }
  }

  // Notifications: once per new status of a parcel, unless the user turned parcel notifications off.
  const toNotify: typeof changed = [];
  for (const entry of changed) {
    if (!prefsOf(entry.userId).notify) continue;
    const signature = trackingSignature(entry.parcel.info);
    if ((await lastNotified(entry.userId, entry.parcel.id).catch(() => null)) === signature) continue;
    toNotify.push(entry);
  }
  let sent = 0;
  const stale = new Map<string, PushDevice>();
  if (toNotify.length > 0 && (pushEnabled || webPushEnabled)) {
    const devices = await db
      .from("push_devices")
      .select("user_id, device_id, token, scheduled, platform")
      .in("user_id", [...new Set(toNotify.map((entry) => entry.userId))]);
    if (devices.error) await reportError(devices.error, { route: "cron-parcel-tracking", step: "devices" });
    const targets = reachableDevices((devices.data ?? []) as PushDevice[], { fcm: pushEnabled, web: webPushEnabled });
    for (const { userId, parcel } of toNotify) {
      const texts = dictionaries[prefsOf(userId).locale].parcels.autoTrack.push;
      const message = {
        title: fill(texts.title, { title: parcel.title, status: parcel.info.statusLabel }),
        body: parcel.info.lastEvent?.description ?? texts.body,
        target: { route: `/parcels?open=${encodeURIComponent(parcel.id)}` },
      };
      for (const device of targets.filter((target) => target.user_id === userId)) {
        const result = await sendToDevice(device, message).catch(() => "error" as const);
        if (result === "sent") sent += 1;
        else if (result === "invalid_token") stale.set(`${device.user_id}/${device.device_id}`, device);
      }
      // Remembered even when no device took it: the status is written, the next run finds no change anyway.
      await rememberNotified(userId, parcel.id, trackingSignature(parcel.info)).catch(() => undefined);
    }
  }
  for (const device of stale.values()) {
    await db.from("push_devices").delete().eq("user_id", device.user_id).eq("device_id", device.device_id);
  }
  return res.status(200).json({ checked, changed: changed.length, sent, removedDevices: stale.size });
}
