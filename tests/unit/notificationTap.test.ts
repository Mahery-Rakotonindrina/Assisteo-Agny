import { describe, expect, it, vi } from "vitest";
import { handleNotificationTap, tapTarget } from "@/services/notificationTap";

const actions = (snoozedAt: number | null) => ({
  snooze: vi.fn(async () => snoozedAt),
  open: vi.fn(),
  snoozed: vi.fn(),
});

describe("handleNotificationTap", () => {
  it("puts the reminder off from the notification's buttons, without opening anything", async () => {
    const run = actions(1234);
    await handleNotificationTap("scan-1", "snooze-tomorrow", 42, run);
    expect(run.snooze).toHaveBeenCalledWith("scan-1", "snooze-tomorrow", 42);
    expect(run.snoozed).toHaveBeenCalledWith(1234);
    expect(run.open).not.toHaveBeenCalled();
  });

  it("opens the scan, offering to put it off, on a plain tap", async () => {
    const run = actions(1234);
    await handleNotificationTap("scan-1", "tap", 42, run);
    expect(run.snooze).not.toHaveBeenCalled();
    expect(run.open).toHaveBeenCalledWith({ pathname: "/result", query: { id: "scan-1", reminded: "1" } });
  });

  it("opens the scan when the snooze couldn't be done (no permission, entry gone)", async () => {
    const run = actions(null);
    await handleNotificationTap("scan-1", "snooze-hour", 42, run);
    expect(run.snoozed).not.toHaveBeenCalled();
    expect(run.open).toHaveBeenCalledWith(tapTarget("scan-1"));
  });

  it("opens Mes colis for a parcel notification", async () => {
    const run = actions(1234);
    await handleNotificationTap("parcel:abc", "tap", 1, run);
    expect(run.open).toHaveBeenCalledWith({ pathname: "/parcels" });
  });

  it("ignores names that only look like actions", async () => {
    const run = actions(1234);
    await handleNotificationTap("scan-1", "constructor", 1, run);
    expect(run.snooze).not.toHaveBeenCalled();
    expect(run.open).toHaveBeenCalled();
  });
});
