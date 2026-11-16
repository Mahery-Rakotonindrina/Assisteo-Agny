import { createRowSync } from "./rowSync";
import { MEASURE_TABLE, measureStore, type Measure } from "./measureStore";

// Syncs "Mes mesures" with the account (table "health_measures", migration
// 0024, see services/rowSync.ts). Fails quietly before the migration: the
// measures stay on the device meanwhile.

// Incremental: measures pile up (several a day, for years).
const measures = createRowSync<Measure>(MEASURE_TABLE, measureStore, { incremental: true });

export const syncMeasures = measures.sync;

/** Keeps "Mes mesures" synced while signed in. Returns the stop function. */
export const startMeasureSync = measures.start;
