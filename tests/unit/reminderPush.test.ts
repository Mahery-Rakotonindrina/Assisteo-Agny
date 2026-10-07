import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { isPending, planPushes, type DueRow, type PushDevice } from "@/lib/server/reminderPush";

const row = (id: string, user: string, patch: Partial<DueRow> = {}): DueRow => ({
  user_id: user,
  id,
  analysis: mockAnalysis("food", "fr"),
  reminder_at: "2026-10-07T09:00:00+00:00",
  reminder_pushed_at: null,
  ...patch,
});
const device = (user: string, deviceId: string, scheduled: string[] = []): PushDevice => ({ user_id: user, device_id: deviceId, token: `tok-${deviceId}`, scheduled });

describe("planPushes", () => {
  it("pushes to the owner's devices that don't hold the reminder locally", () => {
    const plan = planPushes([row("scan-1", "u1")], [device("u1", "phone", ["scan-1"]), device("u1", "tablet"), device("u2", "other")], new Map());
    expect(plan.map((push) => push.device.device_id)).toEqual(["tablet"]);
    expect(plan[0]).toMatchObject({ entryId: "scan-1", title: expect.any(String), body: expect.any(String) });
  });

  it("writes insurance reminders in the user's language", () => {
    const base = mockAnalysis("document", "en");
    const insurance = { ...base, title: "Car policy", document: { ...base.document!, isInsurance: true, expiresOn: "2026-10-19" } };
    const plan = planPushes([row("ins", "u1", { analysis: insurance })], [device("u1", "phone")], new Map([["u1", "en"]]));
    expect(plan[0].title).toBe("Insurance: Car policy");
    expect(plan[0].body).toContain("19 October");
  });

  it("skips reminders already pushed for this time, but not ones moved since", () => {
    expect(isPending(row("a", "u1", { reminder_pushed_at: "2026-10-07T09:05:00+00:00" }))).toBe(false);
    expect(isPending(row("a", "u1", { reminder_pushed_at: "2026-10-06T09:05:00+00:00" }))).toBe(true);
  });

  it("ignores rows whose analysis can't be read", () => {
    expect(planPushes([row("bad", "u1", { analysis: { nope: true } })], [device("u1", "phone")], new Map())).toEqual([]);
  });
});
