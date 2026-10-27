import { createRowSync } from "./rowSync";
import { vehicleStore, type Vehicle } from "./vehicleStore";

// Syncs "Mon garage" with the account (table "vehicles", see services/rowSync.ts).

const vehicles = createRowSync<Vehicle>("vehicles", vehicleStore);

export const syncVehicles = vehicles.sync;

/** Keeps "Mon garage" synced while signed in. Returns the stop function. */
export const startVehicleSync = vehicles.start;
