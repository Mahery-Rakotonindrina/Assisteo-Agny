import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/supabaseAdmin", () => ({
  verifyAccount: async (req: NextApiRequest) => (req.headers.authorization === "Bearer good" ? { id: "u1", email: "a@example.com" } : null),
}));

const { addUserReport, readUserReports, REPORTS_MAX, resetUserReports, setUserReportStatus } = await import("@/lib/server/userReports");
const { default: reportRoute } = await import("@/pages/api/reports");
const { deviceLabel, UserReportSchema } = await import("@/lib/userReport");

function call(body: unknown, headers: Record<string, string> = {}, ip = "1.1.1.1") {
  const req = { method: "POST", body, headers: { "x-forwarded-for": ip, ...headers } } as unknown as NextApiRequest;
  const out = { status: 0, body: undefined as unknown };
  const res = {
    setHeader: () => res,
    status: (code: number) => {
      out.status = code;
      return res;
    },
    json: (value: unknown) => {
      out.body = value;
      return res;
    },
    end: () => res,
  } as unknown as NextApiResponse;
  return reportRoute(req, res).then(() => out);
}

const fields = { kind: "problem" as const, email: null, contact: null, screen: null, appVersion: null, device: null };

beforeEach(() => resetUserReports());

describe("user report schema", () => {
  it("bounds the text and trims it", () => {
    expect(UserReportSchema.safeParse({ kind: "idea", message: "  ok ok ok  " }).data?.message).toBe("ok ok ok");
    expect(UserReportSchema.safeParse({ kind: "idea", message: "no" }).success).toBe(false);
    expect(UserReportSchema.safeParse({ kind: "idea", message: "x".repeat(1001) }).success).toBe(false);
    expect(UserReportSchema.safeParse({ kind: "other", message: "hello there" }).success).toBe(false);
  });

  it("makes a short device label", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
    expect(deviceLabel(ua, "android")).toBe("android · Android 14 · Chrome");
  });
});

describe("report store", () => {
  it("lists the newest first and changes a state", async () => {
    const first = await addUserReport({ ...fields, message: "one" }, 1000);
    await addUserReport({ ...fields, message: "two" }, 2000);
    expect((await readUserReports()).map((report) => report.message)).toEqual(["two", "one"]);
    expect(first.status).toBe("new");
    expect(await setUserReportStatus(first.id, "done")).toBe(true);
    expect((await readUserReports()).find((report) => report.id === first.id)?.status).toBe("done");
    expect(await setUserReportStatus("nope", "read")).toBe(false);
  });

  it("keeps only the newest ones", async () => {
    for (let at = 1; at <= REPORTS_MAX + 5; at += 1) await addUserReport({ ...fields, message: `m${at}` }, at);
    const kept = await readUserReports();
    expect(kept).toHaveLength(REPORTS_MAX);
    expect(kept[0].message).toBe(`m${REPORTS_MAX + 5}`);
  });
});

describe("POST /api/reports", () => {
  it("stores the message with the e-mail of the session, never one from the body", async () => {
    const result = await call({ kind: "problem", message: "Le scan plante", email: "evil@example.com", screen: "/parcels" }, { authorization: "Bearer good" }, "2.2.2.2");
    expect(result.status).toBe(204);
    const [report] = await readUserReports();
    expect(report).toMatchObject({ message: "Le scan plante", email: "a@example.com", screen: "/parcels" });
  });

  it("accepts an anonymous message with a contact, and refuses a bad one", async () => {
    expect((await call({ kind: "idea", message: "Ajoute le malgache", contact: "034 00 000 00" }, {}, "3.3.3.3")).status).toBe(204);
    expect((await readUserReports())[0]).toMatchObject({ email: null, contact: "034 00 000 00" });
    expect((await call({ kind: "idea", message: "x" }, {}, "3.3.3.3")).status).toBe(400);
  });

  it("limits the messages per address", async () => {
    for (let index = 0; index < 5; index += 1) expect((await call({ kind: "idea", message: "hello there" }, {}, "4.4.4.4")).status).toBe(204);
    expect((await call({ kind: "idea", message: "hello there" }, {}, "4.4.4.4")).status).toBe(429);
  });
});
