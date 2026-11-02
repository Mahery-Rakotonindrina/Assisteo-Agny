import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The in-page scan reminders on a browser where Web Push is on: left to the
// push (no double reminder); back to local notifications once unsubscribed.
// The Android app keeps its local notifications whatever happens.

const platform = vi.hoisted(() => ({ native: false }));
const schedule = vi.hoisted(() => vi.fn(async () => ({ notifications: [] })));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => platform.native, getPlatform: () => (platform.native ? "android" : "web") } }));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: { checkPermissions: async () => ({ display: "granted" }), schedule },
}));

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("window", { Notification: function Notification() {} });
  platform.native = false;
  schedule.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const at = new Date("2026-11-10T09:00:00Z");

describe("pushTakesOver", () => {
  it("only for a later scan reminder, on the web, with push on", async () => {
    const { pushTakesOver } = await import("@/services/webPushTakeover");
    const base = { native: false, takeover: true, scanReminder: true, later: true };
    expect(pushTakesOver(base)).toBe(true);
    expect(pushTakesOver({ ...base, native: true })).toBe(false);
    expect(pushTakesOver({ ...base, takeover: false })).toBe(false);
    expect(pushTakesOver({ ...base, scanReminder: false })).toBe(false);
    expect(pushTakesOver({ ...base, later: false })).toBe(false);
  });
});

describe("notify with Web Push on this browser", () => {
  it("leaves the scan reminder to the push, then schedules it again once unsubscribed", async () => {
    const { notify, REMINDER_ACTION_TYPE } = await import("@/services/notifications");
    const { onPushTakeoverChange, setPushTakeover } = await import("@/services/webPushTakeover");
    const changed = vi.fn();
    const stop = onPushTakeoverChange(changed);

    setPushTakeover(true);
    expect(changed).toHaveBeenCalledTimes(1);
    // An id all the same: the reminder counts as scheduled here, the push shows it.
    expect(await notify({ title: "Facture", body: "Texte", at, entryId: "scan-1", actionTypeId: REMINDER_ACTION_TYPE })).toEqual(expect.any(Number));
    expect(schedule).not.toHaveBeenCalled();
    // Parcels, expenses and the like are not pushed by the server: still local.
    await notify({ title: "Colis", body: "Texte", at, entryId: "parcel:1" });
    expect(schedule).toHaveBeenCalledTimes(1);

    setPushTakeover(false);
    expect(changed).toHaveBeenCalledTimes(2);
    await notify({ title: "Facture", body: "Texte", at, entryId: "scan-1", actionTypeId: REMINDER_ACTION_TYPE });
    expect(schedule).toHaveBeenCalledTimes(2);
    // Unchanged: no listener call.
    setPushTakeover(false);
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
  });

  it("never touches the Android app's local notifications", async () => {
    platform.native = true;
    const { notify, REMINDER_ACTION_TYPE } = await import("@/services/notifications");
    const { setPushTakeover } = await import("@/services/webPushTakeover");
    setPushTakeover(true);
    await notify({ title: "Facture", body: "Texte", at, entryId: "scan-1", actionTypeId: REMINDER_ACTION_TYPE });
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
