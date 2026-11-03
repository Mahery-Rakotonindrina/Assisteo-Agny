import { createStore, values } from "idb-keyval";
import type { AccountExport } from "@/lib/accountExport";
import { buildDataCopy, copyFileName, EXPORT_DATABASES, type CopyOptions, type ExportDatabase, type LocalData } from "@/lib/dataExport";
import type { ForeignCurrency } from "@/lib/money";
import { authHeaders } from "./account";
import { eveningSetting } from "./eveningReminder";
import { shareFile } from "./fileShare";
import { ownRate } from "./fx";
import { httpClient } from "./httpClient";
import { loanReminderSetting } from "./loanReminders";
import { adPlace } from "./objectAd";

// "Télécharger une copie de mes données" (Réglages): reads every database of
// the device as it is (lib/dataExport.ts lists them), adds the account's part
// from the server, and hands the ZIP over like the other exports
// (services/fileShare.ts: a download on computers, save or share in the app).

const currencies: ForeignCurrency[] = ["EUR", "USD", "CNY"];

/** Every database's values, untouched (the copy shapes them). */
export async function readDevice(settings: Record<string, unknown>): Promise<LocalData> {
  const entries = await Promise.all(
    (Object.entries(EXPORT_DATABASES) as Array<[ExportDatabase, (typeof EXPORT_DATABASES)[ExportDatabase]]>)
      .filter(([, { file }]) => file !== null)
      .map(async ([name, { store }]) => [name, await values(createStore(name, store)).catch(() => [])] as const),
  );
  const rates = Object.fromEntries(
    currencies.flatMap((currency) => {
      const rate = ownRate(currency);
      return rate ? [[currency, rate]] : [];
    }),
  );
  return {
    databases: Object.fromEntries(entries),
    settings: {
      ...settings,
      eveningReminder: eveningSetting.get(),
      loanReminders: loanReminderSetting.get(),
      adPlace: adPlace.get() || undefined,
      ownRates: Object.keys(rates).length ? rates : undefined,
    },
  };
}

/** What only the server knows about the account (pages/api/account/export.ts). */
export const fetchAccountExport = async (signal?: AbortSignal) => httpClient.get<AccountExport>("/api/account/export", { headers: await authHeaders(), signal });

export type CopyStep = "sync" | "account" | "device" | "zip" | "save";

export class CopyCancelled extends Error {
  constructor() {
    super("The copy was cancelled.");
    this.name = "CopyCancelled";
  }
}

/**
 * Makes the ZIP and hands it over. Signed in: a sync first, then the
 * account's part (a failure stops the copy rather than leave it out
 * silently). `onStep` tells the screen where it is; `signal` stops it
 * before the file is handed over.
 */
export async function downloadDataCopy(options: {
  withPhotos: boolean;
  settings: Record<string, unknown>;
  signedIn: boolean;
  syncAll: () => Promise<void>;
  texts: Pick<CopyOptions, "t" | "date"> & { title: string };
  onStep?: (step: CopyStep) => void;
  signal?: AbortSignal;
  now?: number;
}) {
  const { withPhotos, signedIn, texts, onStep, signal, now = Date.now() } = options;
  const check = () => {
    if (signal?.aborted) throw new CopyCancelled();
  };
  let account: AccountExport | null = null;
  if (signedIn) {
    onStep?.("sync");
    await options.syncAll();
    check();
    onStep?.("account");
    account = await fetchAccountExport(signal);
    check();
  }
  onStep?.("device");
  const data = await readDevice(options.settings);
  check();
  onStep?.("zip");
  const copy = buildDataCopy(data, { withPhotos, account, signedIn, t: texts.t, date: texts.date });
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of copy.files) zip.file(file.path, file.text);
  // Photos are already compressed (JPEG): stored as they are, quicker on a phone.
  for (const photo of copy.photos) zip.file(photo.path, photo.dataUrl.slice(photo.dataUrl.indexOf(",") + 1), { base64: true, compression: "STORE" });
  const bytes = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  check();
  onStep?.("save");
  return shareFile(copyFileName(now), bytes, "application/zip", texts.title);
}
