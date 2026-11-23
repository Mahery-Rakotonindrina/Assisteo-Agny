import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_TRACK_SCAN_ID, type TrackedParcel } from "@/lib/parcelTracking";

// The cron route against a small in-memory Supabase (tables parcels,
// user_settings, push_devices), the demo answers of 17TRACK (AI_DEMO_MODE),
// and recorded pushes.

type Row = Record<string, unknown> & { user_id: string; id?: string };
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  allowed: new Set<string>(),
  pushes: [] as Array<{ device: { user_id: string; device_id: string }; message: { title: string; body: string; target: unknown } }>,
  errors: [] as unknown[],
  /** Called before an update of "parcels" is applied: a device syncing meanwhile. */
  beforeUpdate: null as null | (() => void),
  /** Owners of the parcels read with their data (never those of other plans). */
  dataReads: [] as string[],
}));

vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/fcm", () => ({ pushEnabled: true, sendPush: async () => "sent" }));
vi.mock("@/lib/server/webPush", () => ({ webPushEnabled: false, sendWebPush: async () => "sent" }));
vi.mock("@/lib/server/reportError", () => ({ reportError: async (error: unknown) => void state.errors.push(error) }));
vi.mock("@/lib/server/featureUsers", () => ({
  usersWithFeature: async (_db: unknown, ids: string[], _now: number, feature: string) => {
    expect(feature).toBe("parcelAutoTrack");
    return new Set(ids.filter((id) => state.allowed.has(id)));
  },
}));
vi.mock("@/lib/server/pushSend", () => ({
  sendToDevice: async (device: { user_id: string; device_id: string }, message: { title: string; body: string; target: unknown }) => {
    state.pushes.push({ device, message });
    return "sent";
  },
}));
vi.mock("@/lib/server/supabaseAdmin", () => {
  // A query: filters on plain columns (eq, is, in) are applied; JSON paths, not() and order() are left to the route's own checks.
  function query(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let op: "select" | "update" | "delete" = "select";
    let values: Record<string, unknown> = {};
    let range: [number, number] | null = null;
    let single = false;
    let reads = false;
    const plain = (column: string) => !column.includes("->");
    const builder = {
      select: (columns = "*") => ((columns.includes("data") && op === "select" && (reads = true)), builder),
      update: (next: Record<string, unknown>) => ((op = "update"), (values = next), builder),
      delete: () => ((op = "delete"), builder),
      eq: (column: string, value: unknown) => (plain(column) && filters.push((row) => row[column] === value), builder),
      is: (column: string, value: unknown) => (plain(column) && filters.push((row) => (row[column] ?? null) === value), builder),
      in: (column: string, list: unknown[]) => (filters.push((row) => list.includes(row[column])), builder),
      not: () => builder,
      order: () => builder,
      range: (from: number, to: number) => ((range = [from, to]), builder),
      maybeSingle: () => ((single = true), builder),
      then(resolve: (value: { data: unknown; error: null }) => void) {
        const rows = (state.tables[table] ??= []);
        if (op === "update" && table === "parcels" && state.beforeUpdate) {
          const hook = state.beforeUpdate;
          state.beforeUpdate = null;
          hook();
        }
        const matching = rows.filter((row) => filters.every((filter) => filter(row)));
        if (op === "update") {
          for (const row of matching) Object.assign(row, structuredClone(values));
          return resolve({ data: matching.map((row) => ({ id: row.id })), error: null });
        }
        if (op === "delete") {
          state.tables[table] = rows.filter((row) => !matching.includes(row));
          return resolve({ data: null, error: null });
        }
        const picked = range ? matching.slice(range[0], range[1] + 1) : matching;
        if (reads && table === "parcels") state.dataReads.push(...picked.map((row) => row.user_id));
        const copy = structuredClone(picked);
        return resolve({ data: single ? (copy[0] ?? null) : copy, error: null });
      },
    };
    return builder;
  }
  return { accountsEnabled: true, supabaseAdmin: () => ({ from: query }) };
});

const NOW = new Date(2026, 10, 19, 12).getTime();
process.env.CRON_SECRET = "cron-secret-for-tests";
const { default: route } = await import("@/pages/api/cron/parcel-tracking");
const { resetTrack17Memory } = await import("@/lib/server/track17");

function call(authorized = true) {
  const req = { method: "GET", headers: authorized ? { authorization: "Bearer cron-secret-for-tests" } : {} } as unknown as NextApiRequest;
  const out: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = {
    setHeader: () => res,
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return res;
    },
  } as unknown as NextApiResponse;
  return Promise.resolve(route(req, res)).then(() => out);
}

/** A synced parcel row; its number's last digit picks the demo answer (1: in transit, 9: delivered). */
function parcelRow(userId: string, id: string, fields: { number?: string; status?: string; receivedAt?: number; extra?: Record<string, unknown> } = {}): Row {
  const status = fields.status ?? "shipped";
  return {
    user_id: userId,
    id,
    updated_at: new Date(NOW - 86_400_000).toISOString(),
    deleted_at: null,
    data: {
      id,
      title: `Colis ${id}`,
      info: {
        platform: "Temu",
        orderNumber: null,
        trackingNumber: fields.number ?? "YT2400000001",
        carrier: null,
        status,
        statusLabel: "Expédié",
        lastEvent: { description: "Pris en charge", location: null, at: "2026-11-15 08:00" },
        items: [],
        total: null,
        seller: null,
        orderedAt: null,
        shippedAt: null,
        estimatedDelivery: null,
        destinationCity: null,
        shippingMode: null,
      },
      scanIds: ["scan-1"],
      timeline: [{ at: NOW - 4 * 86_400_000, status, statusLabel: "Expédié", event: null, scanId: "scan-1" }],
      createdAt: NOW - 5 * 86_400_000,
      updatedAt: NOW - 86_400_000,
      ...(fields.receivedAt && { receivedAt: fields.receivedAt }),
      ...fields.extra,
    },
  };
}

type StoredParcel = TrackedParcel & { priceMga?: number; client?: string; fees?: unknown };
const rowOf = (id: string) => state.tables.parcels.find((row) => row.id === id) as Row & { data: StoredParcel; updated_at: string };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.AI_DEMO_MODE = "true";
  delete process.env.TRACK17_API_KEY;
  resetTrack17Memory();
  state.allowed = new Set(["premium-user"]);
  state.pushes = [];
  state.errors = [];
  state.beforeUpdate = null;
  state.dataReads = [];
  state.tables = {
    parcels: [],
    user_settings: [{ user_id: "premium-user", locale: "fr", parcelNotify: null }],
    push_devices: [{ user_id: "premium-user", device_id: "phone", token: "fcm-token", scheduled: [], platform: "android" }],
  };
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.AI_DEMO_MODE;
});

describe("cron: automatic parcel tracking", () => {
  it("is for the scheduler only", async () => {
    expect((await call(false)).status).toBe(401);
  });

  it("sleeps without a 17TRACK key (and outside the demo mode)", async () => {
    delete process.env.AI_DEMO_MODE;
    state.tables.parcels = [parcelRow("premium-user", "p1")];
    const out = await call();
    expect(out).toEqual({ status: 200, body: { skipped: "tracking not configured" } });
    expect(rowOf("p1").data.autoTrack).toBeUndefined();
  });

  it("writes a new status into the row, keeps the user's fields, and notifies once", async () => {
    state.tables.parcels = [parcelRow("premium-user", "p1", { extra: { priceMga: 45000, client: "Rado", fees: [{ id: "f", label: "Fret", amountMga: 9000 }] } })];
    const before = structuredClone(rowOf("p1"));
    const out = await call();
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ checked: 1, changed: 1, sent: 1 });

    const after = rowOf("p1");
    expect(after.data.info.status).toBe("in_transit");
    expect(after.data.info.statusLabel).toBe("En transit");
    expect(after.data.info.lastEvent).toEqual({ description: "Arrived at the sorting centre", location: "Guangzhou", at: "2026-11-19 08:00" });
    expect(after.data.timeline.at(-1)).toMatchObject({ status: "in_transit", scanId: AUTO_TRACK_SCAN_ID, at: NOW });
    expect(after.data.autoTrack).toEqual({ checkedAt: NOW, number: "YT2400000001" });
    // The user's own fields, untouched; updated_at moves by 1 ms (devices take the row, a pending edit still wins).
    expect(after.data.priceMga).toBe(45000);
    expect(after.data.client).toBe("Rado");
    expect(after.data.fees).toEqual(before.data.fees);
    expect(after.data.updatedAt).toBe(before.data.updatedAt);
    expect(Date.parse(after.updated_at)).toBe(Date.parse(before.updated_at) + 1);

    expect(state.pushes).toHaveLength(1);
    expect(state.pushes[0].message).toEqual({ title: "Colis p1 : En transit", body: "Arrived at the sorting centre", target: { route: "/parcels?open=p1" } });

    // The next run, too soon: not asked again.
    expect((await call()).body).toMatchObject({ checked: 0, sent: 0 });
    // Later, nothing new: only the time of the check moves.
    vi.setSystemTime(NOW + 3 * 3600_000);
    expect((await call()).body).toMatchObject({ checked: 1, changed: 0, sent: 0 });
    expect(rowOf("p1").data.autoTrack?.checkedAt).toBe(NOW + 3 * 3600_000);
    expect(rowOf("p1").data.timeline).toHaveLength(2);
  });

  it("doesn't notify the same status twice when a device sends back its older copy", async () => {
    state.tables.parcels = [parcelRow("premium-user", "p1")];
    await call();
    expect(state.pushes).toHaveLength(1);
    // A phone with an edit made offline pushes its whole row: the status is back to "shipped".
    const row = rowOf("p1");
    const older = parcelRow("premium-user", "p1", { extra: { title: "Baskets", autoTrack: { checkedAt: NOW - 4 * 3600_000, number: "YT2400000001" } } });
    Object.assign(row, { data: older.data, updated_at: new Date(NOW + 60_000).toISOString() });
    expect((await call()).body).toMatchObject({ checked: 1, changed: 1, sent: 0 });
    expect(rowOf("p1").data.info.status).toBe("in_transit");
    expect(rowOf("p1").data.title).toBe("Baskets");
  });

  it("merges onto the row as it is now when a device synced meanwhile", async () => {
    state.tables.parcels = [parcelRow("premium-user", "p1")];
    state.beforeUpdate = () => {
      const row = rowOf("p1");
      row.data = { ...row.data, title: "Renamed on the phone", priceMga: 12000 };
      row.updated_at = new Date(NOW - 60_000).toISOString();
    };
    expect((await call()).body).toMatchObject({ checked: 1, changed: 1 });
    const after = rowOf("p1");
    expect(after.data.title).toBe("Renamed on the phone");
    expect(after.data.priceMga).toBe(12000);
    expect(after.data.info.status).toBe("in_transit");
    expect(after.updated_at).toBe(new Date(NOW - 60_000 + 1).toISOString());
    expect(state.pushes[0].message.title).toBe("Renamed on the phone : En transit");
  });

  it("leaves out other plans, parcels in hand or delivered, and respects parcel notifications turned off", async () => {
    state.tables.parcels = [
      parcelRow("free-user", "free"),
      parcelRow("premium-user", "received", { receivedAt: NOW - 3600_000 }),
      parcelRow("premium-user", "delivered", { status: "delivered" }),
      parcelRow("quiet-user", "quiet"),
    ];
    state.allowed.add("quiet-user");
    state.tables.user_settings.push({ user_id: "quiet-user", locale: "en", parcelNotify: "false" });
    state.tables.push_devices.push({ user_id: "quiet-user", device_id: "phone", token: "t", scheduled: [], platform: "android" });
    const out = await call();
    expect(out.body).toMatchObject({ checked: 1, changed: 1, sent: 0 });
    expect(rowOf("free").data.autoTrack).toBeUndefined();
    expect(rowOf("received").data.autoTrack).toBeUndefined();
    expect(rowOf("delivered").data.autoTrack).toBeUndefined();
    // Updated in the user's language, without a push.
    expect(rowOf("quiet").data.info.statusLabel).toBe("In transit");
    expect(state.pushes).toHaveLength(0);
  });

  it("reads the parcels of the users with the tracking only, whatever the number of the others", async () => {
    state.tables.parcels = [...Array.from({ length: 30 }, (_, index) => parcelRow("free-user", `free-${index}`)), parcelRow("premium-user", "zz-premium")];
    expect((await call()).body).toMatchObject({ checked: 1, changed: 1 });
    expect(new Set(state.dataReads)).toEqual(new Set(["premium-user"]));
    expect(rowOf("zz-premium").data.autoTrack?.checkedAt).toBe(NOW);
  });

  it("notes the check of a number 17TRACK refuses, and doesn't send it again", async () => {
    delete process.env.AI_DEMO_MODE;
    process.env.TRACK17_API_KEY = "test-key";
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      sent.push(`${url.split("/").pop()} ${init.body}`);
      const rejected = (JSON.parse(init.body) as Array<{ number: string }>).map(({ number }) => ({ number, error: { code: -18019903, message: "The carrier can not be detected." } }));
      return new Response(JSON.stringify({ code: 0, data: { accepted: [], rejected } }));
    });
    try {
      state.tables.parcels = [parcelRow("premium-user", "odd", { number: "ODD12345" })];
      expect((await call()).body).toMatchObject({ checked: 1, changed: 0, sent: 0 });
      expect(sent).toEqual(['register [{"number":"ODD12345"}]']);
      // Checked: behind the others in the queue, not first again.
      expect(rowOf("odd").data.autoTrack).toEqual({ checkedAt: NOW, number: "ODD12345", refused: true });
      vi.setSystemTime(NOW + 3 * 3600_000);
      expect((await call()).body).toMatchObject({ checked: 1 });
      expect(sent).toHaveLength(1);
      expect(rowOf("odd").data.autoTrack?.refused).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.TRACK17_API_KEY;
    }
  });

  it("notes the check without changing anything when 17TRACK has nothing yet", async () => {
    state.tables.parcels = [parcelRow("premium-user", "p0", { number: "YT2400000000" })];
    expect((await call()).body).toMatchObject({ checked: 1, changed: 0, sent: 0 });
    expect(rowOf("p0").data.info.status).toBe("shipped");
    expect(rowOf("p0").data.autoTrack).toEqual({ checkedAt: NOW, number: "YT2400000000" });
    expect(state.errors).toEqual([]);
  });
});
