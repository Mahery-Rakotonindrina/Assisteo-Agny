import { z } from "zod";
import { planOfferOf, rankOf, type ActivePlan, type CustomPlan, type PlansConfig } from "./plans";

// Family seats: a subscriber shares their plan with a few people, by e-mail,
// from "Mon offre". Each person gets the plan's features and its quotas,
// counted for them alone, while the subscription runs. Pure rules here; the
// server applies them (lib/server/familySeats.ts, pages/api/family-seats.ts).

/** The most seats a plan may give (Admin → Offers). */
export const MAX_FAMILY_SEATS = 20;

/** An e-mail typed by the subscriber: trimmed, lowercase, valid. */
export const SeatEmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const FamilySeatActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), email: SeatEmailSchema }),
  z.object({ action: z.literal("remove"), id: z.uuid() }),
  /** The invited person gives their seat back. */
  z.object({ action: z.literal("leave") }),
]);
export type FamilySeatAction = z.infer<typeof FamilySeatActionSchema>;

/** One seat as the subscriber sees it. */
export type FamilySeat = { id: string; email: string; createdAt: number };

/** GET /api/family-seats. */
export type FamilySeatsResponse = {
  /** The seats the subscriber's plan gives now; 0 when it can't share (see `reason`). */
  seats: number;
  /** Why there are no seats: no plan with seats, or a free trial. */
  reason: "plan" | "trial" | null;
  /** The people added, the earliest first; past `seats` (the plan changed), they get nothing. */
  members: FamilySeat[];
  /** The seat this account holds in someone else's plan, if any (to leave it). */
  joined: { owner: string } | null;
};

/** Why an add is refused, as the API's error code. */
export type SeatRefusal = "seats_none" | "seats_trial" | "seats_full" | "seat_self" | "seat_taken";

/** The seats a plan gives: a created plan's own, else the sold plan's; none on free and Admin. */
export function familySeatsOf(config: Pick<PlansConfig, "offers"> & { customPlans?: readonly CustomPlan[] }, current: Pick<ActivePlan, "plan" | "custom">): number {
  if (current.plan === "free") return 0;
  const offer = planOfferOf(config, current.custom ?? current.plan);
  return Math.max(0, Math.min(MAX_FAMILY_SEATS, offer?.familySeats ?? 0));
}

/**
 * The seats a subscriber may fill now: those of their plan, none during a
 * free trial (`paymentMethod` of the running subscription).
 */
export function shareableSeats(config: Parameters<typeof familySeatsOf>[0], current: Pick<ActivePlan, "plan" | "custom">, paymentMethod: string | null | undefined): { seats: number; reason: FamilySeatsResponse["reason"] } {
  if (paymentMethod === "trial") return { seats: 0, reason: "trial" };
  const seats = familySeatsOf(config, current);
  return { seats, reason: seats > 0 ? null : "plan" };
}

/** A seat counts when it is among the subscriber's first `seats` ones (the earliest kept when the Admin lowers the count). */
export function seatLive(ownerSeats: ReadonlyArray<{ id: string; createdAt: number }>, id: string, seats: number): boolean {
  if (seats <= 0) return false;
  return [...ownerSeats]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, seats)
    .some((seat) => seat.id === id);
}

/** Whether the subscriber's plan beats the person's own (no stacking: the better of the two, their own when equal). */
export function seatWins(own: Pick<ActivePlan, "plan" | "custom">, owner: Pick<ActivePlan, "plan" | "custom">, created: Parameters<typeof rankOf>[1] = []): boolean {
  if (owner.plan === "free") return false;
  return rankOf(owner.custom ?? owner.plan, created) > rankOf(own.custom ?? own.plan, created);
}

/** Why an add is refused, or null: checked by the server before writing (the database keeps one seat per person too). */
export function seatRefusal(input: {
  owner: string;
  member: string;
  seats: number;
  reason: FamilySeatsResponse["reason"];
  members: readonly { email: string }[];
  /** The person already holds a seat (in this plan or another). */
  taken: boolean;
}): SeatRefusal | null {
  if (input.seats <= 0) return input.reason === "trial" ? "seats_trial" : "seats_none";
  if (input.member === input.owner) return "seat_self";
  if (input.taken || input.members.some((seat) => seat.email === input.member)) return "seat_taken";
  if (input.members.length >= input.seats) return "seats_full";
  return null;
}

/** The name shown to the invited person: the subscriber's first name, else their e-mail. */
export function seatOwnerName(fullName: unknown, email: string): string {
  const first = typeof fullName === "string" ? fullName.trim().split(/\s+/)[0] : "";
  return first ? first.slice(0, 60) : email;
}
