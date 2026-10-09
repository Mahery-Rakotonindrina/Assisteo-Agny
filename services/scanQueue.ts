import { createStore, del, get, set, values } from "idb-keyval";
import type { ScanErrorKind } from "@/hooks/useScan";
import { createId } from "./historyStore";
import type { ScanJob } from "./scanPipeline";

// Scans taken without network wait here, on the device, and leave on their
// own once it is back (components/ScanQueueRunner). Each keeps its photos,
// mode and language; a scan the server refuses (no scans left…) stays here
// as failed until the user retries or removes it.

export type QueuedScan = ScanJob & {
  id: string;
  createdAt: number;
  status: "waiting" | "sending" | "failed";
  error?: ScanErrorKind;
};

let store: ReturnType<typeof createStore> | null = null;
function db() {
  store ??= createStore("pocket-assistant-queue", "scans");
  return store;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const wakers = new Set<() => void>();

export const scanQueue = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<QueuedScan[]> {
    const items = await values<QueuedScan>(db());
    return items.filter((item) => item?.id && item.first?.upload).sort((a, b) => a.createdAt - b.createdAt);
  },

  async add(job: ScanJob) {
    const item: QueuedScan = { ...job, id: createId(), createdAt: Date.now(), status: "waiting" };
    await set(item.id, item, db());
    notify();
    return item.id;
  },

  async update(id: string, patch: Partial<Pick<QueuedScan, "status" | "error">>) {
    const current = await get<QueuedScan>(id, db());
    if (!current) return;
    await set(id, { ...current, ...patch }, db());
    notify();
  },

  async remove(id: string) {
    await del(id, db());
    notify();
  },

  /** The runner listens: "send now" (a retry from the screen). */
  onWake(listener: () => void) {
    wakers.add(listener);
    return () => {
      wakers.delete(listener);
    };
  },

  wake() {
    wakers.forEach((listener) => listener());
  },
};
