import type { AccountExport } from "./accountExport";

// "Télécharger une copie de mes données" (Réglages): the files of the copy,
// built from what the device keeps (services/dataExport.ts reads it) and,
// signed in, what only the server knows (compte.json). Readable JSON: dates
// in ISO, amounts in ariary as kept, photos apart in photos/ (or left out).
// Never a secret: the keys below are dropped wherever they are, and the
// stores that hold one are left out (EXPORT_DEVICE_SOURCES).

/** The JSON files of the copy, one per screen (named in French, like LISEZ-MOI.txt). */
export const copyFiles = ["historique", "en-attente", "depenses", "prets", "colis", "listes", "garage", "maison", "plantes", "boutique", "foyer", "reglages", "compte"] as const;
export type CopyFile = (typeof copyFiles)[number];

/**
 * Every IndexedDB database of the app (idb-keyval: one object store each),
 * and the file it goes to; null: left out. A test reads every
 * `createStore("…")` of the code and fails on a database missing here, then
 * checks each one reaches its file (tests/unit/dataExport.test.ts).
 */
export const EXPORT_DATABASES = {
  "pocket-assistant": { store: "history", file: "historique" },
  "pocket-assistant-queue": { store: "scans", file: "en-attente" },
  "assisteo-expenses": { store: "expenses", file: "depenses" },
  "assisteo-expense-reviews": { store: "reviews", file: "depenses" },
  "assisteo-loans": { store: "loans", file: "prets" },
  "assisteo-loan-proofs": { store: "images", file: "prets" },
  "assisteo-loan-shares": { store: "shares", file: "prets" },
  // Paths of photos still to remove from the account: bookkeeping.
  "assisteo-loan-proof-removals": { store: "paths", file: null },
  "assisteo-parcels": { store: "parcels", file: "colis" },
  "assisteo-lists": { store: "lists", file: "listes" },
  "assisteo-vehicles": { store: "vehicles", file: "garage" },
  "assisteo-home": { store: "items", file: "maison" },
  "assisteo-plants": { store: "plants", file: "plantes" },
  "assisteo-shop": { store: "shop", file: "boutique" },
  "assisteo-household": { store: "state", file: "foyer" },
  "assisteo-household-expenses": { store: "expenses", file: "foyer" },
  "assisteo-household-loans": { store: "loans", file: "foyer" },
} as const satisfies Record<string, { store: string; file: CopyFile | null }>;

export type ExportDatabase = keyof typeof EXPORT_DATABASES;

/**
 * Every source file that keeps something on the device outside IndexedDB
 * (localStorage, Preferences, secure storage), and what the copy does with
 * it. The same test fails on a file missing here.
 */
export const EXPORT_DEVICE_SOURCES: Record<string, CopyFile | `left out: ${string}`> = {
  "lib/settings/SettingsProvider.tsx": "reglages",
  "services/eveningReminder.ts": "reglages",
  "services/loanReminders.ts": "reglages",
  "services/objectAd.ts": "reglages",
  "services/fx.ts": "reglages",
  "services/pendingReferral.ts": "left out: a referral code received by a link, not the person's data",
  "services/weeklySummary.ts": "left out: only the id of a scheduled notification, a technical identifier",
  "services/aiKeyStore.ts": "left out: the personal AI key is a secret",
  "lib/supabase.ts": "left out: the session's tokens are secrets",
  "services/trial.ts": "left out: the install id, a technical identifier",
  "services/sync.ts": "left out: the sync cursor",
  "services/plan.ts": "left out: a copy of the server's answer (compte.json has the plan)",
  "services/planMemory.ts": "left out: which plan notice was seen",
  "services/expenseReminders.ts": "left out: the notifications scheduled on this device",
  "services/homeItemReminders.ts": "left out: the notifications scheduled on this device",
  "services/parcelReminders.ts": "left out: the notifications scheduled on this device",
  "services/plantReminders.ts": "left out: the notifications scheduled on this device",
  "services/medicationReminders.ts": "left out: the notifications scheduled on this device",
  "services/vehicleReminders.ts": "left out: the notifications scheduled on this device",
  "services/webPushTakeover.ts": "left out: a technical switch",
  "services/googleSignIn.ts": "left out: the page to go back to after signing in with Google",
  "hooks/useDismissed.ts": "left out: the tips closed",
  "components/UpdateGate/UpdateGate.tsx": "left out: the update notice closed",
  "pages/history.tsx": "left out: a tip shown",
};

type Item = Record<string, unknown>;

/** What the device keeps, read by services/dataExport.ts: every database's values, and the settings. */
export type LocalData = {
  databases: Partial<Record<ExportDatabase, unknown[]>>;
  /** The settings and the other choices kept on this device (reglages.json). */
  settings: Item;
};

/** Keys never written: secrets, bookkeeping of the sync and of this device, copies of a photo. */
const DROPPED = new Set([
  // Secrets.
  "token",
  "tokenHash",
  "token_hash",
  "apiKey",
  "api_key",
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "invite",
  // Bookkeeping.
  "dirty",
  "remote",
  "compactRemote",
  "previewPending",
  "reminderId",
  "reminderScheduledAt",
  "deletedAt",
  "userId",
  // The photo again: base64 of a data URL, the bigger copy sent to the AI.
  "base64",
  "upload",
]);

const isPhoto = (value: unknown): value is string => typeof value === "string" && value.startsWith("data:image/");
const isDateKey = (key: string) => key === "at" || key === "since" || /At$/.test(key);
const safe = (text: string) => text.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "x";

/** The bytes of a data URL's image. */
export const photoSize = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

export type CopyPhoto = { path: string; dataUrl: string };

type Photos = { list: CopyPhoto[] | null; taken: Set<string> };

/**
 * A value made readable: the keys above dropped, dates in ISO, every photo
 * (a data URL) moved to photos/<folder>/ and named in its place, or left out.
 * A thumbnail beside a preview is the same photo, smaller: left out.
 */
function readable(value: unknown, folder: string, name: string[], photos: Photos): unknown {
  if (isPhoto(value)) {
    if (!photos.list) return undefined;
    const extension = value.slice(11, value.indexOf(";")).replace("jpeg", "jpg") || "jpg";
    const base = `photos/${folder}/${name.map(safe).join("-")}`;
    let path = `${base}.${extension}`;
    for (let index = 2; photos.taken.has(path); index += 1) path = `${base}-${index}.${extension}`;
    photos.taken.add(path);
    photos.list.push({ path, dataUrl: value });
    return path;
  }
  if (Array.isArray(value)) return value.map((item, index) => readable(item, folder, [...name, String(index + 1)], photos)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const object = value as Item;
    const result: Item = {};
    for (const [key, field] of Object.entries(object)) {
      if (DROPPED.has(key) || field === undefined) continue;
      if (key === "thumbnail" && isPhoto(object.preview)) continue;
      if (isDateKey(key) && typeof field === "number" && field > 1e11) {
        result[key] = new Date(field).toISOString();
        continue;
      }
      const next = readable(field, folder, [...name, key], photos);
      if (next !== undefined) result[key] = next;
    }
    return result;
  }
  return value;
}

const asItems = (values: unknown[] | undefined) => (values ?? []).filter((value): value is Item => Boolean(value) && typeof value === "object");

/** Records still there (a removal kept to be synced is not data). */
const alive = (items: Item[]) => items.filter((item) => !item.deletedAt);

/** One's own lines in the household: written here (no author yet) or by this account. */
const mine = (items: Item[], me: unknown) => items.filter((item) => !item.userId || item.userId === me);

/** The JSON of each file (empty screens left out). */
function contents({ databases, settings }: LocalData, account: AccountExport | null, photos: Photos): Partial<Record<CopyFile, unknown>> {
  const read = (database: ExportDatabase) => alive(asItems(databases[database]));
  const list = (items: Item[], folder: string) => items.map((item, index) => readable(item, folder, [String(item.id ?? item.month ?? index + 1)], photos));
  const some = (...lists: unknown[][]) => lists.some((items) => items.length > 0);

  // "Mes dépenses" by kind (expense, income, wallet, transfer, correction, budget, goal, tontine, recurring, category…).
  const records: Record<string, unknown[]> = {};
  for (const item of read("assisteo-expenses")) (records[String(item.kind ?? "other")] ??= []).push(...list([item], "depenses"));
  const reviews = list(read("assisteo-expense-reviews"), "depenses");

  const loans = list(read("assisteo-loans"), "prets");
  const proofPhotos = read("assisteo-loan-proofs").map((image) => readable(image, "prets", ["preuve", String(image.id)], photos));
  // A link made here: to whom and when; its token stays on the device.
  const shareLinks = read("assisteo-loan-shares").map(({ person, lender, createdAt }) => readable({ person, lender, createdAt }, "prets", [], photos));

  // The household as last told by the server: its name and one's role only, and one's own lines.
  const state = asItems(databases["assisteo-household"])[0] as { userId?: string; household?: { name?: string; role?: string } | null } | undefined;
  const me = state?.userId ?? null;
  const household = state?.household?.name
    ? {
        household: { name: state.household.name, role: state.household.role },
        expenses: list(mine(read("assisteo-household-expenses"), me), "foyer"),
        loans: list(mine(read("assisteo-household-loans"), me), "foyer"),
      }
    : undefined;

  const files: Partial<Record<CopyFile, unknown>> = {
    historique: some(read("pocket-assistant")) ? { analyses: list(read("pocket-assistant"), "historique") } : undefined,
    "en-attente": some(read("pocket-assistant-queue")) ? { scans: list(read("pocket-assistant-queue"), "en-attente") } : undefined,
    depenses: some(Object.keys(records), reviews) ? { records, reviews } : undefined,
    prets: some(loans, proofPhotos, shareLinks) ? { loans, proofPhotos, shareLinks } : undefined,
    colis: some(read("assisteo-parcels")) ? { parcels: list(read("assisteo-parcels"), "colis") } : undefined,
    listes: some(read("assisteo-lists")) ? { lists: list(read("assisteo-lists"), "listes") } : undefined,
    garage: some(read("assisteo-vehicles")) ? { vehicles: list(read("assisteo-vehicles"), "garage") } : undefined,
    maison: some(read("assisteo-home")) ? { items: list(read("assisteo-home"), "maison") } : undefined,
    plantes: some(read("assisteo-plants")) ? { plants: list(read("assisteo-plants"), "plantes") } : undefined,
    boutique: some(read("assisteo-shop")) ? { records: list(read("assisteo-shop"), "boutique") } : undefined,
    foyer: household,
    reglages: readable(settings, "reglages", [], { list: null, taken: photos.taken }),
    compte: account ? readable(account, "compte", [], { list: null, taken: photos.taken }) : undefined,
  };
  return Object.fromEntries(Object.entries(files).filter(([, value]) => value !== undefined)) as Partial<Record<CopyFile, unknown>>;
}

/** What the photos would weigh, for "Avec les photos (≈ 12 Mo)". */
export function photosSize(data: LocalData) {
  const photos: Photos = { list: [], taken: new Set() };
  contents(data, null, photos);
  return (photos.list ?? []).reduce((total, photo) => total + photoSize(photo.dataUrl), 0);
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** `account` null while signed in: the server couldn't be reached (offline), the copy is made without compte.json and says so. */
export type CopyOptions = { withPhotos: boolean; account: AccountExport | null; signedIn: boolean; t: Translate; date: string };

/** LISEZ-MOI.txt: what the copy is, when it was made, and what each file holds. */
export function readme(present: readonly CopyFile[], { withPhotos, signedIn, t, date }: Pick<CopyOptions, "withPhotos" | "signedIn" | "t" | "date">) {
  const account = !signedIn ? "signedOut" : present.includes("compte") ? "signedIn" : "accountMissing";
  const lines = [
    t("settings.dataCopy.readme.title"),
    "",
    t("settings.dataCopy.readme.made", { date }),
    t(`settings.dataCopy.readme.${account}`),
    "",
    t("settings.dataCopy.readme.filesTitle"),
    ...present.map((file) => `- ${file}.json : ${t(`settings.dataCopy.readme.files.${file}`)}`),
    `- photos/ : ${t(withPhotos ? "settings.dataCopy.readme.photosIn" : "settings.dataCopy.readme.photosOut")}`,
    "",
    t("settings.dataCopy.readme.format"),
    t("settings.dataCopy.readme.safe"),
    "",
  ];
  return lines.join("\r\n");
}

export type DataCopy = { files: Array<{ path: string; text: string }>; photos: CopyPhoto[] };

/** Every file of the copy: LISEZ-MOI.txt, one JSON per screen, and the photos when asked. */
export function buildDataCopy(data: LocalData, options: CopyOptions): DataCopy {
  const photos: Photos = { list: options.withPhotos ? [] : null, taken: new Set() };
  const json = contents(data, options.signedIn ? options.account : null, photos);
  const present = copyFiles.filter((file) => file in json);
  return {
    files: [
      { path: "LISEZ-MOI.txt", text: readme(present, options) },
      ...present.map((file) => ({ path: `${file}.json`, text: `${JSON.stringify(json[file], null, 2)}\n` })),
    ],
    photos: photos.list ?? [],
  };
}

/** assisteo-mes-donnees-2026-11-03.zip (the local day). */
export function copyFileName(now: number) {
  const day = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `assisteo-mes-donnees-${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.zip`;
}
