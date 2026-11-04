import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { familySeatsOf, FamilySeatActionSchema, SeatEmailSchema, seatLive, seatOwnerName, seatRefusal, seatWins, shareableSeats } from "@/lib/familySeats";
import { familyLine } from "@/lib/planPerks";
import { defaultPlansConfig, type CustomPlan, type PlansConfig, type Subscription } from "@/lib/plans";

// The server's surroundings: no Redis (the settings stay in memory), the
// signed-in account, the subscriptions of each e-mail and the family seats
// held here.
type Row = Pick<Subscription, "id" | "email" | "plan" | "startsAt" | "endsAt" | "paymentMethod">;
type Seat = { id: string; ownerId: string; ownerEmail: string; ownerName: string | null; memberEmail: string; createdAt: number; pending?: boolean };
const state = vi.hoisted(() => ({
  account: null as { id: string; email: string } | null,
  rows: [] as Row[],
  seats: [] as Seat[],
  logged: [] as string[],
  missing: false,
}));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/reportError", () => ({ reportError: async () => undefined }));
vi.mock("@/lib/server/supabaseAdmin", () => ({
  accountsEnabled: true,
  verifyAccount: async () => state.account,
  supabaseAdmin: () => ({ auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: { full_name: "Rado Rakoto" } } } }) } } }),
}));
vi.mock("@/lib/server/featureGrants", () => ({ currentGrantsForEmail: async () => [] }));
vi.mock("@/lib/server/adminAuth", () => ({ guardAdmin: async () => ({ id: "owner", owner: true }) }));
vi.mock("@/lib/server/adminLog", () => ({ logAdminAction: async (_actor: string, action: string) => void state.logged.push(action) }));
vi.mock("@/lib/server/subscriptions", async () => {
  const plans = await import("@/lib/plans");
  return {
    accessForEmail: async (email: string, now: number, created: CustomPlan[]) => {
      const own = state.rows.filter((row) => row.email === email).map((row) => ({ ...row, features: null, quotas: null }));
      const running = plans.activeSubscription(own, now, created);
      return { current: plans.activePlan(own, now, created), subscription: running && { id: running.id, features: null, quotas: null, paymentMethod: running.paymentMethod } };
    },
  };
});
vi.mock("@/lib/server/familySeats", async () => {
  const { MigrationNeededError } = await import("@/lib/server/schemaMissing");
  const guard = () => {
    if (state.missing) throw new MigrationNeededError("0016_places_famille");
  };
  return {
    // An invitation not accepted gives nothing (lib/server/familySeats.ts).
    seatForMember: async (email: string) => (state.missing ? null : (state.seats.find((seat) => seat.memberEmail === email && !seat.pending) ?? null)),
    seatsOfOwner: async (ownerId: string) => (guard(), state.seats.filter((seat) => seat.ownerId === ownerId).sort((a, b) => a.createdAt - b.createdAt)),
    memberSeat: async (email: string) => (guard(), state.seats.find((seat) => seat.memberEmail === email) ?? null),
    addSeat: async (input: Omit<Seat, "id" | "createdAt">) => {
      guard();
      const seat = { ...input, id: crypto.randomUUID(), createdAt: Date.now() + state.seats.length, pending: true };
      state.seats.push(seat);
      return seat;
    },
    removeSeat: async (id: string, ownerId: string) => {
      guard();
      const seat = state.seats.find((entry) => entry.id === id && entry.ownerId === ownerId) ?? null;
      state.seats = state.seats.filter((entry) => entry !== seat);
      return seat;
    },
    acceptSeat: async (email: string) => {
      guard();
      const seat = state.seats.find((entry) => entry.memberEmail === email && entry.pending) ?? null;
      if (seat) seat.pending = false;
      return seat;
    },
    declineSeat: async (email: string) => {
      guard();
      const seat = state.seats.find((entry) => entry.memberEmail === email && entry.pending) ?? null;
      state.seats = state.seats.filter((entry) => entry !== seat);
      return seat;
    },
    leaveSeat: async (email: string) => {
      guard();
      const seat = state.seats.find((entry) => entry.memberEmail === email) ?? null;
      state.seats = state.seats.filter((entry) => entry !== seat);
      return seat;
    },
    SeatTakenError: class extends Error {},
  };
});

const { resolvePlan, limitsFor } = await import("@/lib/server/plan");
const { getPlansConfig, setPlansConfig } = await import("@/lib/server/planConfig");
const { default: seatsRoute } = await import("@/pages/api/family-seats");
const { default: plansRoute } = await import("@/pages/api/admin/plans");
const { default: customPlansRoute } = await import("@/pages/api/admin/custom-plans");
const { paidReminderUsers } = await import("@/lib/server/reminderPush");

const NOW = Date.now();
const day = (offset: number) => new Date(NOW + offset * 24 * 3600 * 1000).toISOString();
const OWNER = { id: "owner-1", email: "rado@example.com" };
const row = (email: string, plan: string, start: number, end: number | null, paymentMethod = "mvola"): Row => ({
  id: `${email}-${plan}-${start}`,
  email,
  plan,
  startsAt: day(start),
  endsAt: end === null ? null : day(end),
  paymentMethod,
});
const seat = (memberEmail: string, order = 0, ownerId = OWNER.id, ownerEmail = OWNER.email): Seat => ({
  id: `seat-${memberEmail}`,
  ownerId,
  ownerEmail,
  ownerName: "Rado",
  memberEmail,
  createdAt: NOW - 1000 + order,
});

const request = (fields: Partial<NextApiRequest>) => ({ method: "GET", headers: {}, query: {}, body: undefined, socket: { remoteAddress: "127.0.0.1" }, ...fields }) as unknown as NextApiRequest;
function reply() {
  const res = { statusCode: 0, body: undefined as unknown };
  const api = {
    status(code: number) {
      res.statusCode = code;
      return api;
    },
    json(body: unknown) {
      res.body = body;
      return api;
    },
    setHeader() {
      return api;
    },
    end() {
      return api;
    },
  };
  return { res, api: api as unknown as NextApiResponse };
}
async function call(method: string, body?: unknown) {
  const { res, api } = reply();
  await seatsRoute(request({ method, body }), api);
  return res as { statusCode: number; body: { error?: { code: string }; seats?: number; members?: Array<{ id: string; email: string; pending?: boolean }>; joined?: unknown; invitation?: unknown } };
}

/** The plan of the signed-in member, as every route reads it. */
async function memberPlan(email = "mere@example.com") {
  state.account = { id: "member-1", email };
  const resolved = await resolvePlan(request({}));
  const limits = await limitsFor(resolved.current.plan, undefined, resolved.quotas, resolved.features);
  return { ...resolved, limits };
}

beforeEach(async () => {
  state.account = null;
  state.rows = [];
  state.seats = [];
  state.logged = [];
  state.missing = false;
  await setPlansConfig(defaultPlansConfig);
});

describe("the family seats' rules", () => {
  const config: PlansConfig = defaultPlansConfig;

  it("gives Premium and Pro 4 seats, none to free, Lite and Admin, a created plan its own", () => {
    expect(familySeatsOf(config, { plan: "premium" })).toBe(4);
    expect(familySeatsOf(config, { plan: "pro" })).toBe(4);
    expect(familySeatsOf(config, { plan: "lite" })).toBe(0);
    expect(familySeatsOf(config, { plan: "free" })).toBe(0);
    expect(familySeatsOf(config, { plan: "unlimited" })).toBe(0);
    const famille = { ...defaultPlansConfig.offers.premium, id: "famille", familySeats: 6 } as CustomPlan;
    expect(familySeatsOf({ ...config, customPlans: [famille] }, { plan: "premium", custom: "famille" })).toBe(6);
  });

  it("gives no seat during a free trial", () => {
    expect(shareableSeats(config, { plan: "premium" }, "trial")).toEqual({ seats: 0, reason: "trial" });
    expect(shareableSeats(config, { plan: "premium" }, "mvola")).toEqual({ seats: 4, reason: null });
    expect(shareableSeats(config, { plan: "lite" }, "mvola")).toEqual({ seats: 0, reason: "plan" });
  });

  it("keeps the earliest seats when the count goes down", () => {
    const seats = [{ id: "c", createdAt: 3 }, { id: "a", createdAt: 1 }, { id: "b", createdAt: 2 }];
    expect(seatLive(seats, "b", 2)).toBe(true);
    expect(seatLive(seats, "c", 2)).toBe(false);
    expect(seatLive(seats, "a", 0)).toBe(false);
  });

  it("never stacks: the better plan of the two, the person's own when equal", () => {
    expect(seatWins({ plan: "free" }, { plan: "premium" })).toBe(true);
    expect(seatWins({ plan: "lite" }, { plan: "premium" })).toBe(true);
    expect(seatWins({ plan: "premium" }, { plan: "premium" })).toBe(false);
    expect(seatWins({ plan: "pro" }, { plan: "premium" })).toBe(false);
    expect(seatWins({ plan: "free" }, { plan: "free" })).toBe(false);
  });

  it("refuses an add without seats, when full, for oneself or a person already seated", () => {
    const base = { owner: "rado@example.com", member: "mere@example.com", seats: 2, reason: null, members: [], taken: false } as const;
    expect(seatRefusal(base)).toBeNull();
    expect(seatRefusal({ ...base, seats: 0, reason: "plan" })).toBe("seats_none");
    expect(seatRefusal({ ...base, seats: 0, reason: "trial" })).toBe("seats_trial");
    expect(seatRefusal({ ...base, member: "rado@example.com" })).toBe("seat_self");
    expect(seatRefusal({ ...base, taken: true })).toBe("seat_taken");
    expect(seatRefusal({ ...base, members: [{ email: "a@example.com" }, { email: "b@example.com" }] })).toBe("seats_full");
  });

  it("takes a valid e-mail only, trimmed and lowercase", () => {
    expect(SeatEmailSchema.parse("  Mere.Rabe@Example.COM ")).toBe("mere.rabe@example.com");
    expect(SeatEmailSchema.safeParse("mere").success).toBe(false);
    expect(SeatEmailSchema.safeParse("").success).toBe(false);
    expect(FamilySeatActionSchema.safeParse({ action: "add", email: "pas un mail" }).success).toBe(false);
    expect(FamilySeatActionSchema.safeParse({ action: "remove", id: "x" }).success).toBe(false);
  });

  it("shows the first name of the subscriber, else their e-mail", () => {
    expect(seatOwnerName("Rado Rakoto", "rado@example.com")).toBe("Rado");
    expect(seatOwnerName("  ", "rado@example.com")).toBe("rado@example.com");
    expect(seatOwnerName(undefined, "rado@example.com")).toBe("rado@example.com");
  });

  it("writes the family line only for a plan with seats", () => {
    const t = (key: string, params?: Record<string, string | number>) => `${key}:${params?.count ?? ""}`;
    expect(familyLine(4, t, "fr")).toEqual(["plans.features.family:4"]);
    expect(familyLine(0, t, "fr")).toEqual([]);
    expect(familyLine(undefined, t, "fr")).toEqual([]);
  });
});

describe("an older Redis record", () => {
  it("gets the default seats on each plan and on the created plans", async () => {
    const { familySeats: _p, ...premium } = defaultPlansConfig.offers.premium;
    const famille = { id: "famille", name: { fr: "Famille", en: "Family" }, color: "teal", after: "premium", features: [], onSale: true, createdAt: NOW, priceMga: 1, yearPriceMga: 10, scans: 1, questionsPerDay: 1, parcels: 1, deepPerMonth: 1 };
    const etudiant = { ...famille, id: "etudiant", after: "lite" };
    await setPlansConfig({ ...defaultPlansConfig, offers: { ...defaultPlansConfig.offers, premium: premium as never }, customPlans: [famille, etudiant] as never });
    const config = await getPlansConfig();
    expect(config.offers.premium.familySeats).toBe(4);
    expect(config.offers.lite.familySeats).toBe(0);
    expect(config.customPlans.map((plan) => [plan.id, plan.familySeats])).toEqual([
      ["famille", 4],
      ["etudiant", 0],
    ]);
  });
});

describe("resolvePlan for a person on a family seat", () => {
  it("gives the subscriber's plan, its features and limits, until the subscription ends", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    state.seats = [seat("mere@example.com")];
    const plan = await memberPlan();
    expect(plan.current.plan).toBe("premium");
    expect(plan.current.endsAt).toBe(Date.parse(day(25)));
    expect(plan.features.has("multiPage")).toBe(true);
    expect(plan.limits.scans).toBe(defaultPlansConfig.offers.premium.scans);
    expect(plan.seat).toEqual({ owner: "Rado", ownerEmail: OWNER.email, endsAt: Date.parse(day(25)) });
  });

  it("gives nothing once the subscription ended", async () => {
    state.rows = [row(OWNER.email, "premium", -40, -10)];
    state.seats = [seat("mere@example.com")];
    const plan = await memberPlan();
    expect(plan.current.plan).toBe("free");
    expect(plan.seat).toBeNull();
    expect(plan.features.has("multiPage")).toBe(false);
  });

  it("gives nothing during the subscriber's free trial", async () => {
    state.rows = [row(OWNER.email, "premium", -1, 6, "trial")];
    state.seats = [seat("mere@example.com")];
    expect((await memberPlan()).current.plan).toBe("free");
  });

  it("keeps the person's own plan when better, takes the seat's when not", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25), row("mere@example.com", "pro", -1, 29)];
    state.seats = [seat("mere@example.com")];
    const better = await memberPlan();
    expect(better.current.plan).toBe("pro");
    expect(better.seat).toBeNull();
    state.rows = [row(OWNER.email, "premium", -5, 25), row("mere@example.com", "lite", -1, 29)];
    const worse = await memberPlan();
    expect(worse.current.plan).toBe("premium");
    expect(worse.seat?.owner).toBe("Rado");
  });

  it("gives nothing past the plan's seats (the Admin lowered the count)", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    state.seats = ["a", "b", "c", "d", "e"].map((name, index) => seat(`${name}@example.com`, index));
    expect((await memberPlan("d@example.com")).current.plan).toBe("premium");
    expect((await memberPlan("e@example.com")).current.plan).toBe("free");
  });

  it("a seat still waiting for its answer gives nothing", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    state.seats = [{ ...seat("mere@example.com"), pending: true }];
    expect((await memberPlan()).current.plan).toBe("free");
  });

  it("works as before the migration: the person's own plan", async () => {
    state.missing = true;
    state.rows = [row("mere@example.com", "lite", -1, 29)];
    expect((await memberPlan()).current.plan).toBe("lite");
  });
});

describe("POST /api/family-seats", () => {
  beforeEach(() => {
    state.account = OWNER;
  });

  it("needs a signed-in account", async () => {
    state.account = null;
    expect((await call("GET")).statusCode).toBe(401);
  });

  it("adds a person, counts the seat, removes it, each change in the admin log", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    const added = await call("POST", { action: "add", email: " Mere@Example.com " });
    expect(added.statusCode).toBe(200);
    expect(added.body.seats).toBe(4);
    expect(added.body.members?.map((member) => member.email)).toEqual(["mere@example.com"]);
    expect(state.seats[0].ownerName).toBe("Rado");
    const removed = await call("POST", { action: "remove", id: added.body.members?.[0].id });
    expect(removed.body.members).toEqual([]);
    expect(state.logged).toEqual(["family_seat_add", "family_seat_remove"]);
  });

  it("only invites: the person has nothing until they accept, then the plan, and they may refuse", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    const invited = await call("POST", { action: "add", email: "mere@example.com" });
    // The subscriber sees the person, waiting; the seat counts.
    expect(invited.body.members).toMatchObject([{ email: "mere@example.com", pending: true }]);
    expect((await memberPlan()).current.plan).toBe("free");
    expect((await memberPlan()).seat).toBeNull();

    state.account = { id: "member-1", email: "mere@example.com" };
    const seen = await call("GET");
    expect(seen.body).toMatchObject({ joined: null, invitation: { owner: "Rado", plan: "premium" } });
    expect((await call("POST", { action: "accept" })).body).toMatchObject({ joined: { owner: "Rado" }, invitation: null });
    expect((await memberPlan()).current.plan).toBe("premium");
    expect(state.logged).toEqual(["family_seat_add", "family_seat_accept"]);

    // Another person refuses theirs: the seat is free again, and nothing was given.
    state.account = OWNER;
    await call("POST", { action: "add", email: "fils@example.com" });
    state.account = { id: "member-2", email: "fils@example.com" };
    expect((await call("POST", { action: "decline" })).body).toMatchObject({ joined: null, invitation: null });
    expect(state.seats.map((entry) => entry.memberEmail)).toEqual(["mere@example.com"]);
    expect(state.logged).toContain("family_seat_decline");
  });

  it("accepts nothing without an invitation, and never another person's", async () => {
    state.account = { id: "member-1", email: "mere@example.com" };
    expect((await call("POST", { action: "accept" })).statusCode).toBe(404);
    state.seats = [seat("mere@example.com")];
    // Already accepted: nothing waits.
    expect((await call("POST", { action: "accept" })).statusCode).toBe(404);
    // An invitation for someone else stays theirs.
    state.seats = [{ ...seat("fils@example.com"), pending: true }];
    expect((await call("POST", { action: "accept" })).statusCode).toBe(404);
    expect(state.seats[0].pending).toBe(true);
    // A decline doesn't remove an accepted seat (that is leaving).
    state.seats = [seat("mere@example.com")];
    await call("POST", { action: "decline" });
    expect(state.seats).toHaveLength(1);
  });

  it("keeps a waiting invitation's seat taken (one seat or invitation per person)", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    state.seats = [{ ...seat("mere@example.com", 0, "other", "other@example.com"), pending: true }];
    expect((await call("POST", { action: "add", email: "mere@example.com" })).body.error?.code).toBe("seat_taken");
  });

  it("refuses when every seat is taken", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    state.seats = ["a", "b", "c", "d"].map((name, index) => seat(`${name}@example.com`, index));
    const full = await call("POST", { action: "add", email: "e@example.com" });
    expect(full.statusCode).toBe(409);
    expect(full.body.error?.code).toBe("seats_full");
  });

  it("refuses without a plan with seats, during a trial, for oneself or a person already seated", async () => {
    state.rows = [row(OWNER.email, "lite", -5, 25)];
    expect((await call("POST", { action: "add", email: "mere@example.com" })).body.error?.code).toBe("plan_required");
    state.rows = [row(OWNER.email, "premium", -1, 6, "trial")];
    expect((await call("POST", { action: "add", email: "mere@example.com" })).statusCode).toBe(403);
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    expect((await call("POST", { action: "add", email: OWNER.email })).body.error?.code).toBe("seat_self");
    state.seats = [seat("mere@example.com", 0, "other", "other@example.com")];
    expect((await call("POST", { action: "add", email: "mere@example.com" })).body.error?.code).toBe("seat_taken");
    expect((await call("POST", { action: "add", email: "pas-un-mail" })).statusCode).toBe(400);
  });

  it("doesn't remove another subscriber's seat", async () => {
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    state.seats = [seat("mere@example.com", 0, "other", "other@example.com")];
    expect((await call("POST", { action: "remove", id: crypto.randomUUID() })).statusCode).toBe(404);
    expect(state.seats).toHaveLength(1);
  });

  it("lets the person leave", async () => {
    state.seats = [seat("mere@example.com")];
    state.account = { id: "member-1", email: "mere@example.com" };
    expect((await call("GET")).body).toMatchObject({ joined: { owner: "Rado" } });
    expect((await call("POST", { action: "leave" })).statusCode).toBe(200);
    expect(state.seats).toEqual([]);
    expect(state.logged).toEqual(["family_seat_leave"]);
  });

  it("answers 409 migration_needed before migration 0016", async () => {
    state.missing = true;
    state.rows = [row(OWNER.email, "premium", -5, 25)];
    const response = await call("GET");
    expect(response.statusCode).toBe(409);
    expect(response.body.error?.code).toBe("migration_needed");
  });
});

describe("reminder pushes for a person on a family seat", () => {
  const sub = (email: string, plan: string, start: number, end: number | null, payment_method = "mvola") => ({ email, plan, starts_at: day(start), ends_at: end === null ? null : day(end), payment_method });
  const users = [{ id: "member-1", email: "mere@example.com" }];
  const seats = [{ id: "seat-1", ownerId: OWNER.id, ownerEmail: OWNER.email, memberEmail: "mere@example.com", createdAt: NOW - 1000 }];

  it("get them while the subscriber's subscription runs", () => {
    expect(paidReminderUsers(users, [sub(OWNER.email, "premium", -5, 25)], NOW, defaultPlansConfig, [], seats).has("member-1")).toBe(true);
  });

  it("not once it ended, during a trial, without a seat, or past the plan's seats", () => {
    expect(paidReminderUsers(users, [sub(OWNER.email, "premium", -40, -10)], NOW, defaultPlansConfig, [], seats).has("member-1")).toBe(false);
    expect(paidReminderUsers(users, [sub(OWNER.email, "premium", -1, 6, "trial")], NOW, defaultPlansConfig, [], seats).has("member-1")).toBe(false);
    expect(paidReminderUsers(users, [sub(OWNER.email, "premium", -5, 25)], NOW, defaultPlansConfig, []).has("member-1")).toBe(false);
    const lowered = { ...defaultPlansConfig, offers: { ...defaultPlansConfig.offers, premium: { ...defaultPlansConfig.offers.premium, familySeats: 0 } } };
    expect(paidReminderUsers(users, [sub(OWNER.email, "premium", -5, 25)], NOW, lowered, [], seats).has("member-1")).toBe(false);
  });

  it("not while the invitation waits for its answer", () => {
    expect(paidReminderUsers(users, [sub(OWNER.email, "premium", -5, 25)], NOW, defaultPlansConfig, [], [{ ...seats[0], pending: true }]).has("member-1")).toBe(false);
  });
});

describe("Admin → Offres from an older APK (no family seats sent)", () => {
  async function send(route: typeof plansRoute, method: string, body: unknown) {
    const { res, api } = reply();
    await route(request({ method, body }), api);
    return res;
  }
  const withoutSeats = <T extends { familySeats?: number }>({ familySeats: _f, ...rest }: T) => rest;

  it("saves the plans and keeps the seats saved before", async () => {
    await setPlansConfig({ ...defaultPlansConfig, offers: { ...defaultPlansConfig.offers, premium: { ...defaultPlansConfig.offers.premium, familySeats: 6 } } });
    const { offers, freeParcels, payment } = defaultPlansConfig;
    const body = { freeParcels, payment, offers: { lite: withoutSeats(offers.lite), premium: withoutSeats({ ...offers.premium, priceMga: 16000 }), pro: withoutSeats(offers.pro) } };
    expect((await send(plansRoute, "PUT", body)).statusCode).toBe(200);
    const saved = await getPlansConfig();
    expect(saved.offers.premium).toMatchObject({ priceMga: 16000, familySeats: 6 });
    expect(saved.offers.pro.familySeats).toBe(4);
    expect(saved.offers.lite.familySeats).toBe(0);
  });

  it("creates a plan with no seat, and keeps a plan's seats when changed without them", async () => {
    const plan = { id: "famille", name: { fr: "Famille", en: "Family" }, color: "teal", after: "premium", features: [], priceMga: 8000, yearPriceMga: 80000, scans: 100, questionsPerDay: 10, parcels: 5, deepPerMonth: 0 };
    expect((await send(customPlansRoute, "POST", plan)).statusCode).toBe(201);
    expect((await getPlansConfig()).customPlans[0].familySeats).toBe(0);
    expect((await send(customPlansRoute, "PUT", { ...plan, onSale: true, familySeats: 3 })).statusCode).toBe(200);
    expect((await send(customPlansRoute, "PUT", { ...plan, onSale: true, priceMga: 9000 })).statusCode).toBe(200);
    expect((await getPlansConfig()).customPlans[0]).toMatchObject({ priceMga: 9000, familySeats: 3 });
  });
});
