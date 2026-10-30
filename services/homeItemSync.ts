import { createRowSync } from "./rowSync";
import { homeItemStore, type HomeItem } from "./homeItemStore";

// Syncs "Ma maison" with the account (table "home_items", see services/rowSync.ts).
// Before migration 0014 is applied, the table is missing: the sync fails quietly
// and the items stay on the device.

const homeItems = createRowSync<HomeItem>("home_items", homeItemStore);

export const syncHomeItems = homeItems.sync;

/** Keeps "Ma maison" synced while signed in. Returns the stop function. */
export const startHomeItemSync = homeItems.start;
