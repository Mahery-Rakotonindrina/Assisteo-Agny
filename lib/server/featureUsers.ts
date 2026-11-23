import type { PlanFeature } from "@/lib/plans";
import { seatsForMembers } from "./familySeats";
import { currentGrantsForEmails } from "./featureGrants";
import { getPlansConfig } from "./planConfig";
import { paidReminderUsers } from "./reminderPush";
import { subscriptionRowsForEmails } from "./subscriptions";
import type { supabaseAdmin } from "./supabaseAdmin";

/**
 * Of these users, those whose plan includes `feature` right now (crons):
 * their e-mails from the user list (a few pages, not one call per user),
 * then one read of the subscriptions. Throws when either can't be read:
 * the cron then does nothing, and its next run tries again.
 */
export async function usersWithFeature(db: ReturnType<typeof supabaseAdmin>, userIds: string[], now: number, feature: PlanFeature) {
  const wanted = new Set(userIds);
  const emails = new Map<string, string | null>();
  for (let page = 1; emails.size < wanted.size; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) if (wanted.has(user.id)) emails.set(user.id, user.email ?? null);
    if (data.users.length < 1000) break;
  }
  const users = userIds.map((id) => ({ id, email: emails.get(id) ?? null }));
  const known = users.map((user) => user.email).filter((email): email is string => Boolean(email));
  // Family seats (migration 0016; none before it): their subscribers' subscriptions are read too.
  const seats = await seatsForMembers(known).catch(() => []);
  const owners = [...new Set(seats.map((seat) => seat.ownerEmail))].filter((email) => !known.includes(email));
  const [rows, config, grants] = await Promise.all([subscriptionRowsForEmails([...known, ...owners]), getPlansConfig(), currentGrantsForEmails(known, now).catch(() => [])]);
  return paidReminderUsers(users, rows, now, config, grants, seats, feature);
}
