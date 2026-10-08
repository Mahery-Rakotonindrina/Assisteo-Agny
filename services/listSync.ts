import { listStore, type SavedList } from "./listStore";
import { createRowSync } from "./rowSync";

// Syncs "Mes listes" with the account (table "lists", see services/rowSync.ts).

const lists = createRowSync<SavedList>("lists", listStore);

export const syncLists = lists.sync;

/** Keeps "Mes listes" synced while signed in. Returns the stop function. */
export const startListSync = lists.start;
