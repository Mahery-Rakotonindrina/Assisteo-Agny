import { expenseResetIds, type ResetScreen } from "@/lib/screenReset";
import { expenseStore } from "./expenseStore";
import { historyStore } from "./historyStore";
import { loanSharing } from "./loanSharing";
import { loanStore } from "./loanStore";
import { keepParcelThumbnails } from "./parcelLinking";
import { parcelStore } from "./parcelStore";
import { shopStore } from "./shopStore";

// "Remettre à zéro" (Réglages): one screen's personal data removed, through
// each store's synced removal (signed in, tombstones reach the other devices).
// The household's stores are never touched. The reminders and notifications
// follow on their own: their keepers reconcile on every change of the store.
// What goes and what stays: lib/screenReset.ts.

/** Thrown when the loans' links can't be stopped (offline): nothing is removed. */
export class ResetOfflineError extends Error {
  constructor() {
    super("The loans' share links could not be stopped.");
    this.name = "ResetOfflineError";
  }
}

export async function resetScreen(screen: ResetScreen) {
  switch (screen) {
    case "history":
      // The parcels keep their own photo: they stay recognisable without their scans.
      await keepParcelThumbnails().catch(() => undefined);
      await historyStore.clear();
      return;
    case "expenses":
      await expenseStore.removeMany(expenseResetIds(await expenseStore.list(), "expenses"));
      // The scans, parcels and the garage keep their lines: "Mes dépenses" no longer shows those from before.
      await expenseStore.markReset();
      return;
    case "pockets":
      // The lines that named a pocket become "without pocket" (lib/wallets.ts ignores an unknown one).
      await expenseStore.removeMany(expenseResetIds(await expenseStore.list(), "pockets"));
      return;
    case "loans":
      // The links first: a borrower must never keep reading a copy of loans removed.
      if (!(await loanSharing.stopAll())) throw new ResetOfflineError();
      await loanStore.removeAll();
      return;
    case "parcels":
      await parcelStore.removeAll();
      return;
    case "shop":
      await shopStore.removeAll();
      return;
    case "health":
      // The emergency card and the appointments are settings: ScreenReset empties them (useSettings), dated so the emptying syncs.
      return;
  }
}
