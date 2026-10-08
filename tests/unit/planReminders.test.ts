import { describe, expect, it } from "vitest";
import type { PaidPlanId, Subscription } from "@/lib/plans";
import { dueNotices, noticeKey, noticeMessage } from "@/lib/server/planReminders";

const DAY = 24 * 3600 * 1000;
const now = Date.UTC(2026, 9, 20, 9);
const row = (email: string, plan: PaidPlanId, start: number, end: number | null): Subscription => ({
  id: `${email}-${start}`,
  email,
  plan,
  startsAt: new Date(start).toISOString(),
  endsAt: end === null ? null : new Date(end).toISOString(),
  amountMga: 5000,
  paymentMethod: null,
  paymentRef: null,
  note: null,
  createdAt: new Date(start).toISOString(),
});

describe("plan reminders", () => {
  it("says it three days before, on the last day, and once it has ended", () => {
    const notices = dueNotices(
      [
        row("soon@x.mg", "premium", now - 27 * DAY, now + 2.5 * DAY),
        row("last@x.mg", "lite", now - 29 * DAY, now + 6 * 3600 * 1000),
        row("ended@x.mg", "pro", now - 31 * DAY, now - 3 * 3600 * 1000),
        row("far@x.mg", "lite", now - 10 * DAY, now + 20 * DAY),
        row("old@x.mg", "lite", now - 60 * DAY, now - 5 * DAY),
        row("admin@x.mg", "unlimited", now - 60 * DAY, null),
      ],
      now,
    );
    expect(notices.map(({ email, stage, plan }) => [email, stage, plan])).toEqual([
      ["soon@x.mg", "soon", "premium"],
      ["last@x.mg", "last", "lite"],
      ["ended@x.mg", "ended", "pro"],
    ]);
  });

  it("stays quiet when the plan was renewed without a gap", () => {
    const rows = [row("renewed@x.mg", "lite", now - 28 * DAY, now + DAY / 2), row("renewed@x.mg", "lite", now + DAY / 2, now + 30 * DAY)];
    expect(dueNotices(rows, now)).toEqual([]);
  });

  it("keys each moment of each period once, and words it in the user's language", () => {
    const notice = { email: "a@x.mg", plan: "premium" as const, endsAt: Date.UTC(2026, 10, 12, 21), stage: "soon" as const };
    expect(noticeKey(notice)).toBe(`plan:reminded:a@x.mg:${notice.endsAt}:soon`);
    // 21:00 UTC is midnight in Madagascar: the last day included is the 12th.
    expect(noticeMessage(notice, "fr")).toEqual({
      title: "Ton offre Premium se termine bientôt",
      body: "Elle s’arrête après le 12 novembre. Renouvelle-la pour garder tes avantages.",
    });
    expect(noticeMessage({ ...notice, stage: "ended" }, "en").title).toBe("Your Premium plan has ended");
  });
});
