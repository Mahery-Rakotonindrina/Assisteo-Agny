import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import { hasFeature, planFor } from "@/lib/plans";
import { paidReminderUsers, type SubscriptionRow } from "@/lib/server/reminderPush";
import type { HistoryEntry } from "@/types/history";

// Reminders are for paid plans (Lite and up): the device cancels its
// notifications below Lite and schedules them again with a paid plan; the
// cron pushes only to paid users.

const notifications = vi.hoisted(() => ({
  notify: vi.fn(async () => 42),
  cancelNotification: vi.fn(async (id: number) => void id),
}));

vi.mock("@/services/notifications", () => ({
  REMINDER_ACTION_TYPE: "reminder",
  getNotificationPermission: async () => "granted",
  requestNotificationPermission: async () => "granted",
  notify: notifications.notify,
  cancelNotification: notifications.cancelNotification,
  dismissNotification: async () => undefined,
  registerNotificationActions: async () => undefined,
  pendingNotificationIds: async () => null,
}));
vi.mock("@/services/push", () => ({ reportScheduledReminders: async () => undefined }));

const { historyStore } = await import("@/services/historyStore");
const { reconcileReminders } = await import("@/services/reminders");
const { plannedParcelReminders } = await import("@/services/parcelReminders");

const texts = { insurance: () => ({ title: "Assurance", body: "" }), other: () => ({ title: "Rappel", body: "" }) };

const entry = (patch: Partial<HistoryEntry>): HistoryEntry => ({
  id: "scan-1",
  createdAt: 1,
  mode: "food",
  thumbnail: "data:image/jpeg;base64,AA==",
  preview: "",
  analysis: mockAnalysis("food", "fr"),
  meta: { model: "demo", demo: true, durationMs: 0 },
  ...patch,
});

describe("reminders are a paid feature", () => {
  it("from Lite, the Premium trial included", () => {
    expect(planFor("reminders")).toBe("lite");
    expect(hasFeature("free", "reminders")).toBe(false);
    expect(hasFeature("lite", "reminders")).toBe(true);
    expect(hasFeature("premium", "reminders")).toBe(true);
  });
});

describe("scan reminders on the device", () => {
  beforeEach(async () => {
    await historyStore.wipe();
    notifications.notify.mockClear();
    notifications.cancelNotification.mockClear();
  });

  it("are cancelled below Lite, kept, and scheduled again with a paid plan", async () => {
    const at = Date.now() + 86_400_000;
    await historyStore.rawPut(entry({ reminderAt: at, reminderId: 7, reminderScheduledAt: at }), { silent: true });

    await reconcileReminders(texts, { paid: false });
    expect(notifications.cancelNotification).toHaveBeenCalledWith(7);
    const paused = await historyStore.get("scan-1");
    expect(paused?.reminderAt).toBe(at);
    expect(paused?.reminderId).toBeUndefined();

    await reconcileReminders(texts, { paid: true });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect((await historyStore.get("scan-1"))?.reminderId).toBe(42);
  });
});

describe("parcel notifications", () => {
  it("are planned only with a paid plan", () => {
    const parcel = {
      id: "p",
      title: "Colis",
      scanIds: [],
      timeline: [],
      createdAt: 0,
      updatedAt: 0,
      info: { estimatedDelivery: "2099-01-10", status: "in_transit" },
    } as unknown as Parameters<typeof plannedParcelReminders>[0][number];
    const now = new Date(2099, 0, 1).getTime();
    expect(plannedParcelReminders([parcel], { enabled: true, hour: 8, paid: true }, now).size).toBe(1);
    expect(plannedParcelReminders([parcel], { enabled: true, hour: 8, paid: false }, now).size).toBe(0);
  });
});

describe("reminder cron", () => {
  const now = Date.parse("2026-10-27T10:00:00Z");
  const row = (email: string, plan: SubscriptionRow["plan"], starts: string, ends: string | null): SubscriptionRow => ({ email, plan, starts_at: starts, ends_at: ends });

  it("pushes only to users with an active paid plan", () => {
    const users = [
      { id: "lite", email: "Lite@Example.com" },
      { id: "trial", email: "trial@example.com" },
      { id: "ended", email: "ended@example.com" },
      { id: "free", email: "free@example.com" },
      { id: "no-email", email: null },
    ];
    const paid = paidReminderUsers(
      users,
      [
        row("lite@example.com", "lite", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"),
        row("trial@example.com", "premium", "2026-10-25T00:00:00Z", "2026-11-01T00:00:00Z"),
        row("ended@example.com", "premium", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"),
      ],
      now,
    );
    expect([...paid].sort()).toEqual(["lite", "trial"]);
  });
});
