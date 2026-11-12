import { createRowSync } from "./rowSync";
import { HEALTH_SPEND_TABLE, healthSpendStore, type HealthSpend } from "./healthSpendStore";

// Syncs Ma santé's own health expenses with the account (table
// "health_spending", migration 0025, see services/rowSync.ts). Fails quietly
// before the migration: the expenses stay on the device meanwhile.

// Incremental: they pile up month after month.
const spending = createRowSync<HealthSpend>(HEALTH_SPEND_TABLE, healthSpendStore, { incremental: true });

export const syncHealthSpending = spending.sync;

/** Keeps the health expenses synced while signed in. Returns the stop function. */
export const startHealthSpendSync = spending.start;
