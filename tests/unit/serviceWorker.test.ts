import { createRequire } from "node:module";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// public/sw.js: what it answers, and that offline it never serves a page whose
// files are not all in the cache (a page of an old deployment).

type Listener = (event: unknown) => void;
type Sw = {
  strategyFor: (request: Request, origin: string) => string | null;
  buildOf: (html: string) => string | null;
  assetsOf: (html: string) => string[];
  pageKey: (url: string) => string;
  keepPage: (cache: FakeCache, path: string, html: string) => Promise<boolean>;
  offlinePage: (cache: FakeCache, path: string) => Promise<Response>;
  CACHE: string;
  OFFLINE_PAGE: string;
};

const ORIGIN = "https://agny.example";

class FakeCache {
  entries = new Map<string, string>();
  async match(key: string | Request) {
    const url = new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname;
    const body = this.entries.get(url);
    return body === undefined ? undefined : new Response(body, { headers: { "Content-Type": "text/html" } });
  }
  async put(key: string | Request, response: Response) {
    this.entries.set(new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname, await response.text());
  }
  async add(key: string) {
    this.entries.set(key, "offline");
  }
}

const listeners = new Map<string, Listener>();
const stores = new Map<string, FakeCache>();
const fakeCaches = {
  open: async (name: string) => {
    if (!stores.has(name)) stores.set(name, new FakeCache());
    return stores.get(name)!;
  },
  keys: async () => [...stores.keys()],
  delete: async (name: string) => stores.delete(name),
};
const claim = vi.fn(async () => undefined);

let sw: Sw;

beforeAll(() => {
  vi.stubGlobal("self", {
    location: { href: `${ORIGIN}/sw.js?build=b1`, origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    clients: { claim },
    skipWaiting: async () => undefined,
  });
  vi.stubGlobal("caches", fakeCaches);
  sw = createRequire(import.meta.url)("../../public/sw.js") as Sw;
});

beforeEach(() => {
  stores.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(`file ${url}`)));
});

const page = (build: string) =>
  `<html><head><link rel="stylesheet" href="/_next/static/css/a.css"/></head><body><script src="/_next/static/chunks/main-1.js"></script>` +
  `<script id="__NEXT_DATA__" type="application/json">{"page":"/pockets","buildId":"${build}"}</script></body></html>`;

describe("public/sw.js", () => {
  it("answers the site's pages and files, never the API nor another site", () => {
    const get = (url: string, mode: RequestMode = "cors") => ({ method: "GET", url, mode }) as Request;
    expect(sw.strategyFor(get(`${ORIGIN}/pockets?add=1`, "navigate"), ORIGIN)).toBe("page");
    expect(sw.strategyFor(get(`${ORIGIN}/_next/static/chunks/main-1.js`), ORIGIN)).toBe("static");
    expect(sw.strategyFor(get(`${ORIGIN}/icons/icon-192.png`), ORIGIN)).toBe("asset");
    expect(sw.strategyFor(get(`${ORIGIN}/api/plan`), ORIGIN)).toBeNull();
    expect(sw.strategyFor(get(`${ORIGIN}/api/plan`, "navigate"), ORIGIN)).toBeNull();
    expect(sw.strategyFor(get("https://x.supabase.co/rest/v1/expenses"), ORIGIN)).toBeNull();
    expect(sw.strategyFor({ method: "POST", url: `${ORIGIN}/expenses`, mode: "navigate" } as Request, ORIGIN)).toBeNull();
    expect(sw.strategyFor(get(`${ORIGIN}/sw.js`), ORIGIN)).toBeNull();
  });

  it("reads a page's build and files, and keeps a page by its path", () => {
    expect(sw.buildOf(page("b1"))).toBe("b1");
    expect(sw.buildOf("<html></html>")).toBeNull();
    expect(sw.assetsOf(page("b1"))).toEqual(["/_next/static/css/a.css", "/_next/static/chunks/main-1.js"]);
    expect(sw.pageKey(`${ORIGIN}/expenses?add=expense#x`)).toBe("/expenses");
    expect(sw.CACHE).toBe("assisteo-offline-b1");
  });

  it("keeps a page of its build with all its files, and refuses another build's", async () => {
    const cache = await fakeCaches.open(sw.CACHE);
    expect(await sw.keepPage(cache, "/old", page("b0"))).toBe(false);
    expect(cache.entries.has("/old")).toBe(false);

    expect(await sw.keepPage(cache, "/pockets", page("b1"))).toBe(true);
    expect([...cache.entries.keys()].sort()).toEqual(["/_next/static/chunks/main-1.js", "/_next/static/css/a.css", "/pockets"]);
  });

  it("does not keep a page when one of its files can't be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response("", { status: url.endsWith(".css") ? 404 : 200 })));
    const cache = await fakeCaches.open(sw.CACHE);
    expect(await sw.keepPage(cache, "/pockets", page("b1"))).toBe(false);
    expect(cache.entries.has("/pockets")).toBe(false);
  });

  it("offline, serves a kept page only with all its files, else the offline page", async () => {
    const cache = await fakeCaches.open(sw.CACHE);
    await cache.add(sw.OFFLINE_PAGE);
    await sw.keepPage(cache, "/pockets", page("b1"));
    expect(await (await sw.offlinePage(cache, "/pockets")).text()).toContain('"buildId":"b1"');

    cache.entries.delete("/_next/static/chunks/main-1.js");
    expect(await (await sw.offlinePage(cache, "/pockets")).text()).toBe("offline");
    expect(await (await sw.offlinePage(cache, "/never-seen")).text()).toBe("offline");
  });

  it("a new build deletes the old caches when it takes over", async () => {
    await fakeCaches.open("assisteo-offline-b0");
    await fakeCaches.open(sw.CACHE);
    await fakeCaches.open("someone-else");
    let done: Promise<unknown> = Promise.resolve();
    listeners.get("activate")!({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
    await done;
    expect([...stores.keys()].sort()).toEqual([sw.CACHE, "someone-else"].sort());
    expect(claim).toHaveBeenCalled();
  });

  it("keeps the Web Push handlers", () => {
    expect(listeners.has("push")).toBe(true);
    expect(listeners.has("notificationclick")).toBe(true);
    expect(listeners.has("fetch")).toBe(true);
  });
});
