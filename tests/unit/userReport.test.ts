import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/redis", () => ({ redis: null }));
// "Bearer good" and "Bearer other": confirmed e-mails; "Bearer unconfirmed": signed in, e-mail not confirmed.
vi.mock("@/lib/server/supabaseAdmin", () => ({
  verifyAccount: async (req: NextApiRequest) => {
    const token = req.headers.authorization;
    if (token === "Bearer good") return { id: "u1", email: "a@example.com" };
    if (token === "Bearer other") return { id: "u2", email: "b@example.com" };
    if (token === "Bearer busy") return { id: "u4", email: "c@example.com" };
    if (token === "Bearer unconfirmed") return { id: "u3", email: null };
    return null;
  },
}));

const { addUserReport, deleteUserReportsOf, readUserReports, REPORTS_KEEP_MS, REPORTS_MAX, resetUserReports, setUserReportStatus, userReportsOf } = await import("@/lib/server/userReports");
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

const fields = { kind: "problem" as const, email: null, accountId: null, contact: null, screen: null, appVersion: null, device: null };
const valid = { kind: "idea", message: "hello there" };

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
    const now = Date.now();
    const first = await addUserReport({ ...fields, message: "one" }, now - 2000);
    await addUserReport({ ...fields, message: "two" }, now - 1000);
    expect((await readUserReports()).map((report) => report.message)).toEqual(["two", "one"]);
    expect(first.status).toBe("new");
    expect(await setUserReportStatus(first.id, "done")).toBe(true);
    expect((await readUserReports()).find((report) => report.id === first.id)?.status).toBe("done");
    expect(await setUserReportStatus("nope", "read")).toBe(false);
  });

  it("keeps only the newest ones", async () => {
    const now = Date.now();
    for (let index = 1; index <= REPORTS_MAX + 5; index += 1) await addUserReport({ ...fields, message: `m${index}` }, now - 100000 + index);
    const kept = await readUserReports();
    expect(kept).toHaveLength(REPORTS_MAX);
    expect(kept[0].message).toBe(`m${REPORTS_MAX + 5}`);
  });

  it("erases a report after 12 months", async () => {
    const now = Date.now();
    await addUserReport({ ...fields, message: "old" }, now - REPORTS_KEEP_MS - 1000);
    await addUserReport({ ...fields, message: "recent" }, now - 1000);
    expect((await readUserReports()).map((report) => report.message)).toEqual(["recent"]);
    expect(await readUserReports(now + REPORTS_KEEP_MS)).toEqual([]);
  });

  it("erases and exports the reports of one account only, and never shows the account id", async () => {
    const now = Date.now();
    await addUserReport({ ...fields, accountId: "u1", message: "mine" }, now - 3000);
    await addUserReport({ ...fields, accountId: "u2", message: "theirs" }, now - 2000);
    await addUserReport({ ...fields, message: "anonymous" }, now - 1000);
    expect((await userReportsOf("u1")).map((report) => report.message)).toEqual(["mine"]);
    expect(JSON.stringify(await readUserReports())).not.toContain("accountId");
    await deleteUserReportsOf("u1");
    expect((await readUserReports()).map((report) => report.message)).toEqual(["anonymous", "theirs"]);
  });
});

describe("POST /api/reports", () => {
  it("stores the message with the e-mail of the session, never one from the body", async () => {
    const result = await call({ kind: "problem", message: "Le scan plante", email: "evil@example.com", screen: "/parcels" }, { authorization: "Bearer good" }, "2.2.2.2");
    expect(result.status).toBe(204);
    const [report] = await readUserReports();
    expect(report).toMatchObject({ message: "Le scan plante", email: "a@example.com", screen: "/parcels" });
    expect(await userReportsOf("u1")).toHaveLength(1);
  });

  it("accepts an anonymous message with a contact, and refuses a bad one", async () => {
    expect((await call({ ...valid, message: "Ajoute le malgache", contact: "034 00 000 00" }, {}, "3.3.3.3")).status).toBe(204);
    expect((await readUserReports())[0]).toMatchObject({ email: null, contact: "034 00 000 00" });
    expect((await call({ kind: "idea", message: "x" }, {}, "3.3.3.3")).status).toBe(400);
  });

  it("limits the messages per address without an account, and a refused message costs no try", async () => {
    for (let index = 0; index < 30; index += 1) expect((await call({ kind: "idea", message: "x" }, {}, "4.4.4.4")).status).toBe(400);
    for (let index = 0; index < 20; index += 1) expect((await call(valid, {}, "4.4.4.4")).status).toBe(204);
    expect((await call(valid, {}, "4.4.4.4")).status).toBe(429);
  });

  it("counts a signed-in person by account, not by the address they share", async () => {
    for (let index = 0; index < 10; index += 1) expect((await call(valid, { authorization: "Bearer busy" }, "5.5.5.5")).status).toBe(204);
    expect((await call(valid, { authorization: "Bearer busy" }, "5.5.5.5")).status).toBe(429);
    // Another account behind the same address is not affected.
    expect((await call(valid, { authorization: "Bearer other" }, "5.5.5.5")).status).toBe(204);
    // Without a confirmed e-mail, the address counts.
    expect((await call(valid, { authorization: "Bearer unconfirmed" }, "6.6.6.6")).status).toBe(204);
    expect((await readUserReports())[0]).toMatchObject({ email: null });
  });
});
