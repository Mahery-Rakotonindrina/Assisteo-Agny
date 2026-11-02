import type { NextApiRequest, NextApiResponse } from "next";
import { FamilySeatActionSchema, seatOwnerName, seatRefusal, shareableSeats, type FamilySeatsResponse } from "@/lib/familySeats";
import { logAdminAction } from "@/lib/server/adminLog";
import { addSeat, leaveSeat, memberSeat, removeSeat, seatsOfOwner, SeatTakenError } from "@/lib/server/familySeats";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { getPlansConfig } from "@/lib/server/planConfig";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { MigrationNeededError } from "@/lib/server/schemaMissing";
import { accessForEmail } from "@/lib/server/subscriptions";
import { accountsEnabled, supabaseAdmin, verifyAccount } from "@/lib/server/supabaseAdmin";

/** People added per subscriber and day: a family, not a mailing list. */
const ADDS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Family seats, from "Mon offre". GET: the seats the subscriber's plan gives,
 * the people added, and the seat the account holds in someone else's plan.
 * POST: add a person by e-mail, remove one, or leave a seat. Every check is
 * here, on the plan the server reads (never the app's word); each change goes
 * to the admin log. Before migration 0016: 409 migration_needed.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<FamilySeatsResponse | unknown>) {
  if (applyCors(req, res, ["GET", "POST"])) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use GET or POST.");
  }

  const burst = await rateLimit(`family-seats:${clientIp(req)}`, 30, 60_000);
  if (!burst.ok) return sendError(res, 429, "rate_limited", "Too many requests, try again in a moment.");
  if (!accountsEnabled) return sendError(res, 503, "unavailable", "Accounts are not configured.");

  const account = await verifyAccount(req).catch(() => null);
  if (!account?.email) return sendError(res, 401, "sign_in_required", "Sign in to share your plan.");
  const email = account.email;

  try {
    const config = await getPlansConfig();
    const access = await accessForEmail(email, Date.now(), config.customPlans);
    const { seats, reason } = shareableSeats(config, access.current, access.subscription?.paymentMethod);
    const state = async (): Promise<FamilySeatsResponse> => {
      const [members, joined] = await Promise.all([seatsOfOwner(account.id), memberSeat(email)]);
      return {
        seats,
        reason,
        members: members.map((seat) => ({ id: seat.id, email: seat.memberEmail, createdAt: seat.createdAt })),
        joined: joined && { owner: joined.ownerName || joined.ownerEmail },
      };
    };

    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") return res.status(200).json(await state());

    const parsed = FamilySeatActionSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
    const action = parsed.data;

    if (action.action === "add") {
      const members = await seatsOfOwner(account.id);
      const taken = members.some((seat) => seat.memberEmail === action.email) || (await memberSeat(action.email)) !== null;
      const refused = seatRefusal({ owner: email, member: action.email, seats, reason, members: members.map((seat) => ({ email: seat.memberEmail })), taken });
      if (refused === "seats_none" || refused === "seats_trial") return sendError(res, 403, "plan_required", "Your plan has no family seats.");
      if (refused) return sendError(res, refused === "seat_self" ? 400 : 409, refused, "This person can't be added.");
      const daily = await rateLimit(`family-seats:add:${account.id}`, ADDS_PER_DAY, DAY_MS);
      if (!daily.ok) return sendError(res, 429, "rate_limited", "Too many people added today.");
      const { data } = await supabaseAdmin()
        .auth.admin.getUserById(account.id)
        .catch(() => ({ data: null }));
      await addSeat({ ownerId: account.id, ownerEmail: email, ownerName: seatOwnerName(data?.user?.user_metadata?.full_name, email), memberEmail: action.email });
      await logAdminAction(email, "family_seat_add", `${email} → ${action.email}`);
    } else if (action.action === "remove") {
      const removed = await removeSeat(action.id, account.id);
      if (!removed) return sendError(res, 404, "not_found", "No such seat.");
      await logAdminAction(email, "family_seat_remove", `${email} → ${removed.memberEmail}`);
    } else {
      const left = await leaveSeat(email);
      if (left) await logAdminAction(email, "family_seat_leave", `${left.ownerEmail} → ${email}`);
    }
    return res.status(200).json(await state());
  } catch (error) {
    if (error instanceof MigrationNeededError) return sendError(res, 409, "migration_needed", "Family seats are not available yet.");
    if (error instanceof SeatTakenError) return sendError(res, 409, "seat_taken", "This person already holds a family seat.");
    await reportError(error, { route: "family-seats" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
