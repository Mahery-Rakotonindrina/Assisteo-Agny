import { createRowSync } from "./rowSync";
import { plantStore, type Plant } from "./plantStore";

// Syncs "Mes plantes" with the account (table "plants", see services/rowSync.ts).

const plants = createRowSync<Plant>("plants", plantStore);

export const syncPlants = plants.sync;

/** Keeps "Mes plantes" synced while signed in. Returns the stop function. */
export const startPlantSync = plants.start;
