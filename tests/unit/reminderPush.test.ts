import { describe, expect, it } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { holdsReminder, isPending, nextReminderAt, planPushes, type DueRow, type PushDevice } from "@/lib/server/reminderPush";

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

describe("holdsReminder", () => {
  it("matches the id alone (older apps) or the id with this reminder's time", () => {
    const due = row("scan-1", "u1");
    const at = new Date(due.reminder_at).getTime();
    expect(holdsReminder(device("u1", "old", ["scan-1"]), due)).toBe(true);
    expect(holdsReminder(device("u1", "new", [`scan-1@${at}`]), due)).toBe(true);
    // Fired there last month: the next occurrence still needs a push.
    expect(holdsReminder(device("u1", "new", [`scan-1@${at - 30 * 86_400_000}`]), due)).toBe(false);
  });
});

describe("nextReminderAt", () => {
  // 31 January 09:00 in Madagascar (UTC+3), every month.
  const from = Date.UTC(2026, 0, 31, 6, 0);
  const monthly = { reminderRepeat: { every: "monthly", from, offset: 180 } };

  it("moves a recurring reminder on to its next occurrence, on the original day", () => {
    const due = row("r", "u1", { reminder_at: "2026-02-28T06:00:00.000Z", meta: monthly });
    expect(nextReminderAt(due, Date.parse("2026-02-28T06:02:00Z"))).toBe("2026-03-31T06:00:00.000Z");
  });

  it("follows a snoozed occurrence with the regular next one", () => {
    // Put off to 1 March: the next one is still 31 March.
    const due = row("r", "u1", { reminder_at: "2026-03-01T06:00:00.000Z", meta: monthly });
    expect(nextReminderAt(due, Date.parse("2026-03-01T06:01:00Z"))).toBe("2026-03-31T06:00:00.000Z");
  });

  it("leaves one-off reminders alone", () => {
    expect(nextReminderAt(row("r", "u1"), Date.now())).toBeNull();
    expect(nextReminderAt(row("r", "u1", { meta: { reminderRepeat: { every: "weekly", from } } }), Date.now())).toBeNull();
  });
});
