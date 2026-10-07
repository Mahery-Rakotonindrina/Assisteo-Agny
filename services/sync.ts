import { Preferences } from "@capacitor/preferences";
import { AnalysisSchema, normalizeStoredAnalysis, type ScanMode } from "@/lib/ai/schema";
import { supabase } from "@/lib/supabase";
import type { HistoryEntry } from "@/types/history";
import { historyStore } from "./historyStore";

// Two-way sync of the history between this device and the user's account.
//
// - Local-first: the app always reads and writes IndexedDB; sync runs after.
// - Pull, then push. Pull uses a cursor on server_updated_at (set by the
//   database, so device clocks don't matter for "what changed").
// - Conflicts (same entry edited on two devices): the newer updated_at wins.
// - Deletions travel as tombstones (deleted_at) and are purged once synced.
// - Photos go to the private "scans" bucket: <user id>/<entry id>/{preview,thumbnail}.jpg

export type SyncStatus = { state: "off" | "idle" | "syncing" | "error" | "offline"; lastSyncAt?: number };

type Row = {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  mode: string;
  analysis: unknown;
  meta: HistoryEntry["meta"];
  reminder_at: string | null;
  preview_path: string | null;
  thumbnail_path: string | null;
  chat: HistoryEntry["chat"] | null;
  server_updated_at: string;
};

const PAGE = 100;
const BUCKET = "scans";

let userId: string | null = null;
let status: SyncStatus = { state: "off" };
let running: Promise<void> | null = null;
let again = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let unsubscribeHistory: (() => void) | null = null;
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}

const cursorKey = (uid: string) => `sync.cursor.${uid}`;
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : undefined);

async function dataUrlToBlob(dataUrl: string) {
  return (await fetch(dataUrl)).blob();
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---- Pull ----------------------------------------------------------------------

async function downloadPhotos(row: Row) {
  const paths = [row.preview_path, row.thumbnail_path].filter((path): path is string => Boolean(path));
  if (paths.length < 2) return null;
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrls(paths, 120);
  if (error || !data) return null;
  const [preview, thumbnail] = await Promise.all(
    data.map(async (item) => (item.signedUrl ? blobToDataUrl(await (await fetch(item.signedUrl)).blob()) : null)),
  );
  return preview && thumbnail ? { preview, thumbnail } : null;
}

async function applyRemote(row: Row) {
  const local = await historyStore.rawGet(row.id);
  const remoteUpdated = time(row.updated_at) ?? 0;
  // A newer local edit wins: it will be pushed right after.
  if (local?.dirty && (local.updatedAt ?? 0) > remoteUpdated) return;

  if (row.deleted_at) {
    if (local) await historyStore.rawDelete(row.id, { silent: true });
    return;
  }

  const analysis = AnalysisSchema.safeParse(normalizeStoredAnalysis(row.analysis));
  if (!analysis.success) return;

  // Photos are immutable: only download them for entries this device lacks.
  const photos = local?.preview && local.thumbnail ? { preview: local.preview, thumbnail: local.thumbnail } : await downloadPhotos(row);
  if (!photos) return;

  await historyStore.rawPut(
    {
      id: row.id,
      createdAt: time(row.created_at) ?? Date.now(),
      mode: row.mode as ScanMode,
      analysis: analysis.data,
      meta: row.meta,
      reminderAt: time(row.reminder_at),
      chat: Array.isArray(row.chat) && row.chat.length > 0 ? row.chat : undefined,
      // Notifications are scheduled per device: keep this device's own one.
      reminderId: local?.reminderId,
      reminderScheduledAt: local?.reminderScheduledAt,
      ...photos,
      updatedAt: remoteUpdated,
      // A pending remote shrink (see photoStorage) must survive this pull.
      dirty: Boolean(local?.compactRemote),
      compactRemote: local?.compactRemote,
      remote: { preview: row.preview_path!, thumbnail: row.thumbnail_path! },
    },
    { silent: true },
  );
}

async function pull(uid: string) {
  const stored = await Preferences.get({ key: cursorKey(uid) });
  let cursor = stored.value ?? "1970-01-01T00:00:00Z";
  for (;;) {
    const { data, error } = await supabase()
      .from("analyses")
      .select("*")
      .gt("server_updated_at", cursor)
      .order("server_updated_at", { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    for (const row of rows) await applyRemote(row);
    if (rows.length > 0) {
      cursor = rows[rows.length - 1].server_updated_at;
      await Preferences.set({ key: cursorKey(uid), value: cursor });
      historyStore.notify();
    }
    if (rows.length < PAGE) break;
  }
}

// ---- Push ----------------------------------------------------------------------

async function pushEntry(uid: string, entry: HistoryEntry) {
  const db = supabase();

  if (entry.deletedAt) {
    const { error } = await db.from("analyses").upsert({
      user_id: uid,
      id: entry.id,
      created_at: new Date(entry.createdAt).toISOString(),
      updated_at: new Date(entry.updatedAt ?? Date.now()).toISOString(),
      deleted_at: new Date(entry.deletedAt).toISOString(),
      mode: entry.mode,
      analysis: entry.analysis,
      meta: entry.meta,
      preview_path: null,
      thumbnail_path: null,
    });
    if (error) throw error;
    if (entry.remote) await db.storage.from(BUCKET).remove([entry.remote.preview, entry.remote.thumbnail]);
    await historyStore.rawDelete(entry.id, { silent: true });
    return;
  }

  let remote = entry.remote;
  if (remote && entry.compactRemote) {
    // Old scan whose preview was reduced on this device: shrink the account's copy too.
    const { error } = await db.storage
      .from(BUCKET)
      .upload(remote.preview, await dataUrlToBlob(entry.thumbnail), { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
  }
  if (!remote) {
    const folder = `${uid}/${entry.id}`;
    remote = { preview: `${folder}/preview.jpg`, thumbnail: `${folder}/thumbnail.jpg` };
    const uploads = await Promise.all([
      db.storage.from(BUCKET).upload(remote.preview, await dataUrlToBlob(entry.preview), { contentType: "image/jpeg", upsert: true }),
      db.storage.from(BUCKET).upload(remote.thumbnail, await dataUrlToBlob(entry.thumbnail), { contentType: "image/jpeg", upsert: true }),
    ]);
    const failed = uploads.find((upload) => upload.error);
    if (failed?.error) throw failed.error;
  }

  const { error } = await db.from("analyses").upsert({
    user_id: uid,
    id: entry.id,
    created_at: new Date(entry.createdAt).toISOString(),
    updated_at: new Date(entry.updatedAt ?? entry.createdAt).toISOString(),
    deleted_at: null,
    mode: entry.mode,
    analysis: entry.analysis,
    meta: entry.meta,
    reminder_at: entry.reminderAt ? new Date(entry.reminderAt).toISOString() : null,
    chat: entry.chat ?? [],
    preview_path: remote.preview,
    thumbnail_path: remote.thumbnail,
  });
  if (error) throw error;

  // Only clear the flag if nothing changed locally while uploading.
  const latest = await historyStore.rawGet(entry.id);
  if (latest && (latest.updatedAt ?? 0) === (entry.updatedAt ?? 0)) {
    await historyStore.rawPut({ ...latest, dirty: false, remote, compactRemote: undefined }, { silent: true });
  } else if (latest) {
    await historyStore.rawPut({ ...latest, remote, compactRemote: undefined }, { silent: true });
  }
}

async function push(uid: string) {
  // Entries saved before accounts existed have no flag: they count as dirty,
  // which is how a first sign-in imports the device's history.
  const pending = (await historyStore.raw()).filter((entry) => entry.dirty !== false);
  for (const entry of pending) await pushEntry(uid, entry);
  if (pending.length > 0) historyStore.notify();
}

// ---- Orchestration ----------------------------------------------------------------

async function runOnce() {
  const uid = userId;
  if (!uid) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setStatus({ ...status, state: "offline" });
    return;
  }
  setStatus({ ...status, state: "syncing" });
  try {
    await pull(uid);
    await push(uid);
    if (userId === uid) setStatus({ state: "idle", lastSyncAt: Date.now() });
  } catch (error) {
    console.warn("[sync]", error instanceof Error ? error.message : error);
    if (userId === uid) setStatus({ ...status, state: "error" });
  }
}

export const sync = {
  status: () => status,

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Runs a sync now; concurrent calls are coalesced into one follow-up run. */
  async now() {
    if (!userId) return;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await runOnce();
      } while (again && userId);
    })().finally(() => {
      running = null;
    });
    return running;
  },

  start(uid: string) {
    if (userId === uid) return;
    userId = uid;
    historyStore.setKeepTombstones(true);
    setStatus({ state: "idle" });
    // Local changes are pushed a moment later, batched.
    unsubscribeHistory = historyStore.subscribe(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void sync.now(), 1500);
    });
    void sync.now();
  },

  /** Signing out: stop syncing and forget this account's data on the device. */
  async stop({ wipe }: { wipe: boolean }) {
    const uid = userId;
    userId = null;
    clearTimeout(debounce);
    unsubscribeHistory?.();
    unsubscribeHistory = null;
    await running?.catch(() => undefined);
    historyStore.setKeepTombstones(false);
    if (wipe) {
      await historyStore.wipe();
      if (uid) await Preferences.remove({ key: cursorKey(uid) });
    }
    setStatus({ state: "off" });
  },
};
