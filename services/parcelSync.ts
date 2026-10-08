import { parcelStore, type Parcel } from "./parcelStore";
import { createRowSync } from "./rowSync";

// Syncs "Mes colis" with the account (table "parcels", see services/rowSync.ts).

const parcels = createRowSync<Parcel>("parcels", parcelStore);

export const syncParcels = parcels.sync;

/** Keeps "Mes colis" synced while signed in. Returns the stop function. */
export const startParcelSync = parcels.start;
