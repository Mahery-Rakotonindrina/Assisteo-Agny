import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page leaves its scan reminders to Web Push only when the server confirms
// this browser's row: a failed save, or a row missing, keeps them local.

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@/services/httpClient", () => ({ httpClient: http }));
vi.mock("@/services/account", () => ({ authHeaders: async () => ({ Authorization: "Bearer test" }) }));
vi.mock("@/services/trial", () => ({ getInstallId: async () => "install-123456" }));

/** A browser with push: the subscription it holds, and whether it was unsubscribed. */
function fakeBrowser(alreadySubscribed: boolean) {
  const state = { subscription: null as null | { unsubscribe: () => Promise<boolean>; toJSON: () => unknown } };
  const make = () => ({
    toJSON: () => ({ endpoint: "https://web.push.apple.com/x", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } }),
    unsubscribe: async () => {
      state.subscription = null;
      return true;
    },
  });
  if (alreadySubscribed) state.subscription = make();
  const pushManager = {
    getSubscription: async () => state.subscription,
    subscribe: async () => (state.subscription = make()),
  };
  const registration = { pushManager };
  vi.stubGlobal("navigator", { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => registration } });
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: async () => "granted" });
  vi.stubGlobal("window", { PushManager: function PushManager() {}, Notification: {} });
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) });
  return state;
}

beforeEach(async () => {
  vi.clearAllMocks();
  (await import("@/services/webPush")).resetWebPushStatus();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subscribeWebPush", () => {
  it("POST fails: no takeover, browser unsubscribed", async () => {
    const browser = fakeBrowser(false);
    http.post.mockRejectedValueOnce(new Error("503 migration_needed"));
    const { subscribeWebPush } = await import("@/services/webPush");
    const { readPushTakeover } = await import("@/services/webPushTakeover");
    expect(await subscribeWebPush("BKey")).toBe("error");
    expect(browser.subscription).toBeNull();
    expect(readPushTakeover()).toBe(false);
  });

  it("saved by the server: the push takes over", async () => {
    const browser = fakeBrowser(false);
    http.post.mockResolvedValueOnce(undefined);
    const { subscribeWebPush } = await import("@/services/webPush");
    const { readPushTakeover } = await import("@/services/webPushTakeover");
    expect(await subscribeWebPush("BKey")).toBe("subscribed");
    expect(browser.subscription).not.toBeNull();
    expect(readPushTakeover()).toBe(true);
  });
});

describe("refreshPushTakeover", () => {
  it("server has no row: no takeover, the button says Turn on", async () => {
    fakeBrowser(true);
    localStorage.setItem("assisteo.webPushReminders", "1");
    http.get.mockResolvedValue({ publicKey: "BKey", registered: false });
    const { refreshPushTakeover, fetchWebPushStatus, webPushSubscribed } = await import("@/services/webPush");
    const { readPushTakeover } = await import("@/services/webPushTakeover");
    await refreshPushTakeover();
    expect(http.get).toHaveBeenCalledWith("/api/push/web?deviceId=install-123456", expect.anything());
    expect(readPushTakeover()).toBe(false);
    expect(await webPushSubscribed((await fetchWebPushStatus()).registered)).toBe(false);
  });

  it("the server can't be read: local reminders kept", async () => {
    fakeBrowser(true);
    localStorage.setItem("assisteo.webPushReminders", "1");
    http.get.mockRejectedValue(new Error("offline"));
    const { refreshPushTakeover } = await import("@/services/webPush");
    const { readPushTakeover } = await import("@/services/webPushTakeover");
    await refreshPushTakeover();
    expect(readPushTakeover()).toBe(false);
  });

  it("subscribed and confirmed: the push takes over, asked once a session", async () => {
    fakeBrowser(true);
    http.get.mockResolvedValue({ publicKey: "BKey", registered: true });
    const { refreshPushTakeover } = await import("@/services/webPush");
    const { readPushTakeover } = await import("@/services/webPushTakeover");
    await refreshPushTakeover();
    await refreshPushTakeover();
    expect(readPushTakeover()).toBe(true);
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});
