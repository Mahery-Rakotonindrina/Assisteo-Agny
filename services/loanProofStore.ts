import { clear, createStore, del, get, keys, set, values } from "idb-keyval";
import type { LoanProof } from "@/lib/loans";
import { historyStore } from "./historyStore";

// "Prêts": the images of the photo proofs, on this device (the loan only keeps
// the list, lib/loanProof.ts). Compressed like the scans: a preview and a
// thumbnail. Synced to the account by services/loanProofSync.ts. A proof
// taken from the history is read from there, never copied.

export type ProofImage = { id: string; loanId: string; preview: string; thumbnail: string; addedAt: number };

let images: ReturnType<typeof createStore> | null = null;
const db = () => (images ??= createStore("assisteo-loan-proofs", "images"));
// The account's files left to remove (a proof or a loan removed), until the next sync.
let removals: ReturnType<typeof createStore> | null = null;
const removalsDb = () => (removals ??= createStore("assisteo-loan-proof-removals", "paths"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const loanProofStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  notify,
  async put(image: ProofImage) {
    await set(image.id, image, db());
    notify();
  },
  get: (id: string) => get<ProofImage>(id, db()),
  async remove(id: string) {
    await del(id, db());
    notify();
  },
  raw: () => values<ProofImage>(db()),

  /** The image of a proof: its own photo, or the scan's from the history (null when gone). */
  async image(proof: LoanProof): Promise<{ preview: string; thumbnail: string } | null> {
    if (proof.kind === "scan") {
      const entry = proof.scanId ? await historyStore.get(proof.scanId) : undefined;
      return entry?.thumbnail ? { preview: entry.preview || entry.thumbnail, thumbnail: entry.thumbnail } : null;
    }
    const image = await get<ProofImage>(proof.id, db());
    return image ? { preview: image.preview, thumbnail: image.thumbnail } : null;
  },

  async queueRemoval(paths: string[]) {
    await Promise.all(paths.map((path) => set(path, true, removalsDb())));
  },
  pendingRemovals: () => keys<string>(removalsDb()),
  async clearRemovals(paths: string[]) {
    await Promise.all(paths.map((path) => del(path, removalsDb())));
  },

  /** Signing out or deleting the account. */
  async wipe() {
    await Promise.all([clear(db()), clear(removalsDb())]);
  },
};
