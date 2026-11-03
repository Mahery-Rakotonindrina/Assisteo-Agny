import "fake-indexeddb/auto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createStore, set } from "idb-keyval";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import fr from "@/locales/fr.json";
import type { AccountExport } from "@/lib/accountExport";
import { buildDataCopy, copyFileName, EXPORT_DATABASES, EXPORT_DEVICE_SOURCES, photosSize, readme, type ExportDatabase, type LocalData } from "@/lib/dataExport";

// The file handed over, caught instead of shared.
const shared = vi.hoisted(() => ({ files: [] as Array<{ name: string; bytes: ArrayBuffer }> }));
vi.mock("@/services/fileShare", () => ({
  shareFile: async (name: string, bytes: ArrayBuffer) => {
    shared.files.push({ name, bytes });
    return "downloaded";
  },
}));
const { downloadDataCopy, readDevice } = await import("@/services/dataExport");

// "t" over the French texts, like the app's.
const t = (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], fr);
  return typeof text === "string" ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)) : key;
};

const root = join(__dirname, "..", "..");
const photo = (letter: string) => `data:image/jpeg;base64,${letter.repeat(400)}`;

/** Every source file of the app (not the tests, nor what is built or installed). */
function sources(folder = root): string[] {
  return readdirSync(folder).flatMap((name) => {
    if (["node_modules", ".next", "out", "tests", "android", "ios", ".git", ".claude", "public", "scripts", "supabase"].includes(name)) return [];
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [relative(root, path).replace(/\\/g, "/")] : [];
  });
}

describe("every storage of the device is in the copy, or left out on purpose", () => {
  const files = sources().map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));

  it("knows every IndexedDB database of the code", () => {
    const found = files.flatMap(({ text }) => [...text.matchAll(/createStore\(\s*"([^"]+)",\s*"([^"]+)"\s*\)/g)].map((match) => `${match[1]}/${match[2]}`));
    expect(found.length).toBeGreaterThan(10);
    const known = Object.entries(EXPORT_DATABASES).map(([name, { store }]) => `${name}/${store}`);
    // A new database: add it to EXPORT_DATABASES (lib/dataExport.ts), with its file or null.
    expect(found.filter((database) => !known.includes(database))).toEqual([]);
    expect(known.filter((database) => !found.includes(database))).toEqual([]);
  });

  it("knows every other place the device keeps something", () => {
    const keeping = files.filter(({ text }) => /localStorage\.setItem|Preferences\.set\(|SecureStorage\.setItem|setItem: \(key/.test(text)).map(({ path }) => path);
    // A new place: add its file to EXPORT_DEVICE_SOURCES (lib/dataExport.ts), in reglages.json or left out with the reason.
    expect(keeping.filter((path) => !(path in EXPORT_DEVICE_SOURCES))).toEqual([]);
    expect(Object.keys(EXPORT_DEVICE_SOURCES).filter((path) => !keeping.includes(path))).toEqual([]);
  });

  it("puts each database's records in its file", async () => {
    for (const [name, { store }] of Object.entries(EXPORT_DATABASES)) {
      const value = name === "assisteo-household" ? { userId: "me", household: { name: `marker-${name}`, role: "owner" } } : { id: `id-${name}`, kind: "expense", note: `marker-${name}`, person: `marker-${name}` };
      await set(name === "assisteo-household" ? "state" : `id-${name}`, value, createStore(name, store));
    }
    const data = await readDevice({ locale: "fr" });
    const copy = buildDataCopy(data, { withPhotos: true, account: null, signedIn: false, t, date: "3 nov. 2026" });
    for (const [name, { file }] of Object.entries(EXPORT_DATABASES)) {
      const text = copy.files.find((item) => item.path === `${file}.json`)?.text ?? "";
      if (file) expect(text, name).toContain(`marker-${name}`);
      else expect(copy.files.map((item) => item.text).join("")).not.toContain(`marker-${name}`);
    }
  });
});

const empty: LocalData["databases"] = {};
const local = (databases: Partial<Record<ExportDatabase, unknown[]>>, settings: Record<string, unknown> = {}): LocalData => ({ databases: { ...empty, ...databases }, settings });

const account: AccountExport = {
  email: "rado@example.mg",
  exportedAt: "2026-11-03T08:00:00.000Z",
  plan: { current: "premium", customPlan: null, endsAt: "2026-12-01T00:00:00.000Z" },
  subscriptions: [],
  featureGrants: [],
  offers: { trialUsed: true, pendingDiscount: null, referredBy: null },
  familySeats: { given: [], received: null },
  household: null,
  loanShareLinks: [],
  notificationDevices: [{ platform: "android", updatedAt: "2026-11-01T00:00:00.000Z" }],
};

describe("the copy", () => {
  const at = new Date(2026, 10, 3, 9).getTime();
  const data = local(
    {
      "pocket-assistant": [
        { id: "s1", createdAt: at, thumbnail: photo("A"), preview: photo("B"), analysis: { title: "Facture JIRAMA" }, dirty: true, remote: { preview: "u1/s1/p.jpg" }, reminderId: 12 },
        { id: "s2", createdAt: at, deletedAt: at, thumbnail: photo("C"), preview: photo("D"), analysis: { title: "removed-scan" } },
      ],
      "assisteo-expenses": [
        { id: "e1", kind: "expense", amountMga: 12000, createdAt: at },
        { id: "w1", kind: "wallet", name: "MVola", createdAt: at },
      ],
      "assisteo-loan-shares": [{ person: "Hery", token: "share-token-secret", lender: "Rado", createdAt: at }],
      "assisteo-loan-proofs": [{ id: "p1", loanId: "l1", preview: photo("E"), thumbnail: photo("F"), addedAt: at }],
      "assisteo-plants": [{ id: "pl1", name: "Basilic", thumbnail: photo("G"), checks: [{ id: "c1", at, thumbnail: photo("H") }] }],
      "assisteo-household": [{ userId: "me", household: { id: "h1", name: "Famille Rabe", role: "member", invite: { code: "INVITE7" }, members: [{ userId: "other", label: "So…@gmail.com" }] } }],
      "assisteo-household-expenses": [
        { id: "he1", userId: "me", amountMga: 5000, note: "my-household-line" },
        { id: "he2", note: "written-here-not-synced" },
        { id: "he3", userId: "other", amountMga: 9000, note: "other-member-line" },
      ],
      "assisteo-household-loans": [{ id: "hl1", kind: "loan", userId: "other", person: "other-member-loan" }],
    },
    { locale: "fr", textSize: "large", apiKey: "sk-personal-ai-key" },
  );
  const copy = (withPhotos: boolean, signedIn = false) => buildDataCopy(data, { withPhotos, account: { ...account, token: "server-token" } as AccountExport, signedIn, t, date: "3 nov. 2026" });
  const text = (result: ReturnType<typeof copy>) => result.files.map((file) => `${file.path}\n${file.text}`).join("\n");
  const json = (result: ReturnType<typeof copy>, file: string) => JSON.parse(result.files.find((item) => item.path === file)!.text);

  it("writes LISEZ-MOI first, then one readable JSON per screen with something in it", () => {
    const result = copy(true);
    expect(result.files.map((file) => file.path)).toEqual(["LISEZ-MOI.txt", "historique.json", "depenses.json", "prets.json", "plantes.json", "foyer.json", "reglages.json"]);
    const scans = json(result, "historique.json").analyses;
    expect(scans).toHaveLength(1);
    expect(scans[0].createdAt).toBe(new Date(at).toISOString());
    expect(json(result, "depenses.json").records).toEqual({ expense: [expect.objectContaining({ amountMga: 12000 })], wallet: [expect.objectContaining({ name: "MVola" })] });
  });

  it("keeps no secret, no bookkeeping, nothing of the other members", () => {
    const all = text(copy(true, true));
    for (const secret of ["share-token-secret", "sk-personal-ai-key", "server-token", "INVITE7", "other-member-line", "other-member-loan", "So…@gmail.com", "u1/s1/p.jpg", "removed-scan", "\"dirty\"", "\"reminderId\"", "\"userId\""]) {
      expect(all).not.toContain(secret);
    }
    const household = json(copy(true), "foyer.json");
    expect(household.household).toEqual({ name: "Famille Rabe", role: "member" });
    expect(household.expenses.map((line: { note: string }) => line.note)).toEqual(["my-household-line", "written-here-not-synced"]);
    expect(household.loans).toEqual([]);
    expect(json(copy(true), "prets.json").shareLinks).toEqual([{ person: "Hery", lender: "Rado", createdAt: new Date(at).toISOString() }]);
  });

  it("adds compte.json only when signed in", () => {
    expect(copy(true).files.some((file) => file.path === "compte.json")).toBe(false);
    const result = copy(true, true);
    expect(json(result, "compte.json")).toMatchObject({ email: "rado@example.mg", plan: { current: "premium" } });
    expect(result.files.at(-1)?.path).toBe("compte.json");
  });

  it("moves the photos to photos/, named in the JSON, or leaves them out", () => {
    const withPhotos = copy(true);
    expect(withPhotos.photos.map((item) => item.path).sort()).toEqual(
      ["photos/historique/s1-preview.jpg", "photos/plantes/pl1-thumbnail.jpg", "photos/plantes/pl1-checks-1-thumbnail.jpg", "photos/prets/preuve-p1-preview.jpg"].sort(),
    );
    expect(json(withPhotos, "historique.json").analyses[0].preview).toBe("photos/historique/s1-preview.jpg");
    // The thumbnail is the same photo, smaller.
    expect(json(withPhotos, "historique.json").analyses[0]).not.toHaveProperty("thumbnail");

    const without = copy(false);
    expect(without.photos).toEqual([]);
    expect(text(without)).not.toContain("data:image");
    expect(json(without, "historique.json").analyses[0]).not.toHaveProperty("preview");
    expect(photosSize(data)).toBe(4 * 300);
  });

  it("says in LISEZ-MOI what each file holds, and whether the account is in", () => {
    const signedOut = readme(["historique", "reglages"], { withPhotos: false, signedIn: false, t, date: "3 nov. 2026" });
    expect(signedOut).toContain("Assisteo Agny : copie de tes données");
    expect(signedOut).toContain("Faite le 3 nov. 2026.");
    expect(signedOut).toContain(fr.settings.dataCopy.readme.signedOut);
    expect(signedOut).toContain(`- historique.json : ${fr.settings.dataCopy.readme.files.historique}`);
    expect(signedOut).toContain(`- photos/ : ${fr.settings.dataCopy.readme.photosOut}`);
    expect(signedOut).not.toContain("compte.json");
    expect(signedOut).toContain("ariary");
    const signedIn = readme(["historique", "compte"], { withPhotos: true, signedIn: true, t, date: "3 nov. 2026" });
    expect(signedIn).toContain(fr.settings.dataCopy.readme.signedIn);
    expect(signedIn).toContain(`- compte.json : ${fr.settings.dataCopy.readme.files.compte}`);
  });

  it("is named after the day", () => {
    expect(copyFileName(new Date(2026, 10, 3, 23).getTime())).toBe("assisteo-mes-donnees-2026-11-03.zip");
  });
});

describe("the ZIP", () => {
  it("syncs first when signed in, then holds the files and, if asked, the photos", async () => {
    await set("z1", { id: "z1", createdAt: 1, thumbnail: photo("Z"), preview: photo("Y"), analysis: {} }, createStore("pocket-assistant", "history"));
    const steps: string[] = [];
    const syncAll = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(account), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const run = (withPhotos: boolean, signedIn: boolean) =>
        downloadDataCopy({ withPhotos, settings: {}, signedIn, syncAll, texts: { t, date: "3 nov. 2026", title: "x" }, onStep: (step) => steps.push(step), now: new Date(2026, 10, 3).getTime() });

      expect(await run(true, true)).toBe("downloaded");
      expect(syncAll).toHaveBeenCalledOnce();
      expect(steps).toEqual(["sync", "account", "device", "zip", "save"]);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/account/export");
      const zip = await JSZip.loadAsync(shared.files.at(-1)!.bytes);
      expect(shared.files.at(-1)!.name).toBe("assisteo-mes-donnees-2026-11-03.zip");
      expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["LISEZ-MOI.txt", "historique.json", "compte.json", "photos/historique/z1-preview.jpg"]));
      expect(await zip.file("photos/historique/z1-preview.jpg")!.async("base64")).toBe("Y".repeat(400));

      await run(false, false);
      const light = await JSZip.loadAsync(shared.files.at(-1)!.bytes);
      expect(Object.keys(light.files).some((path) => path.startsWith("photos/"))).toBe(false);
      expect(light.file("compte.json")).toBeNull();
      expect(syncAll).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
