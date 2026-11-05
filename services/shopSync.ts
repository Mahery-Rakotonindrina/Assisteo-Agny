import { createRowSync } from "./rowSync";
import { shopStore, type ShopRecord } from "./shopStore";

// Syncs "Ma boutique" with the account (table "shop", see services/rowSync.ts).

const shop = createRowSync<ShopRecord>("shop", shopStore);

export const syncShop = shop.sync;

/** Keeps "Ma boutique" synced while signed in. Returns the stop function. */
export const startShopSync = shop.start;
