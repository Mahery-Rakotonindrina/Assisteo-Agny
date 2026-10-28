import { createStore, del, get, set } from "idb-keyval";
import type { HouseholdAction, HouseholdInfo, HouseholdResponse } from "@/lib/household";
import { ApiError } from "@/types/api";
import { authHeaders } from "./account";
import { detachHousehold } from "./householdExpenseStore";
import { httpClient } from "./httpClient";

// The user's household ("Mes dépenses" shared), as the server last told it.
// Kept on the device so the shared budget shows offline; refreshed on launch,
// on sign-in and after every change (pages/api/household.ts).

export type HouseholdSnapshot = {
  /** The server said the request needs an account. */
  signedOut: boolean;
  userId: string | null;
  household: HouseholdInfo | null;
  /** The last refresh failed (offline…): what is shown may be old. */
  stale: boolean;
};

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-household", "state"));
const KEY = "state";

// Null until read from the device (and on the server): nothing is decided then.
let snapshot: HouseholdSnapshot | null = null;
let loading: Promise<void> | null = null;
// The household the shared expenses on this device belong to (kept through a lost session).
let householdOnDevice: string | null = null;
const listeners = new Set<() => void>();

function publish(next: HouseholdSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/**
 * Takes the server's answer. Out of the household (left, removed, deleted),
 * or in another one: the shared expenses here go, one's own back to the
 * personal ones (the server gives them back too, with the same ids).
 */
async function apply(response: HouseholdResponse) {
  const id = response.household?.id ?? null;
  if (!id || (householdOnDevice && householdOnDevice !== id)) await detachHousehold(response.userId);
  householdOnDevice = id;
  const next: HouseholdSnapshot = { signedOut: false, userId: response.userId, household: response.household, stale: false };
  await set(KEY, next, db()).catch(() => undefined);
  publish(next);
}

function load() {
  loading ??= get<HouseholdSnapshot>(KEY, db())
    .catch(() => undefined)
    .then((saved) => {
      householdOnDevice = saved?.household?.id ?? null;
      if (!snapshot) publish(saved ? { ...saved, stale: true } : { signedOut: false, userId: null, household: null, stale: true });
    });
  return loading;
}

export const householdStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => snapshot,

  /** Asks the server. Offline, the saved state stays (marked stale). */
  async refresh() {
    await load();
    try {
      await apply(await httpClient.get<HouseholdResponse>("/api/household", { headers: await authHeaders() }));
    } catch (error) {
      const signedOut = error instanceof ApiError && error.code === "sign_in_required";
      if (signedOut) publish({ signedOut: true, userId: null, household: null, stale: false });
      else if (snapshot) publish({ ...snapshot, stale: true });
    }
  },

  /** Creates, joins, invites, renames… Throws an ApiError the screen explains. */
  async act(action: HouseholdAction) {
    await load();
    await apply(await httpClient.post<HouseholdResponse>("/api/household", action, { headers: await authHeaders() }));
  },

  /** No session on this device: nothing to ask the server (what is saved stays for when it comes back). */
  async signedOut() {
    await load();
    publish({ signedOut: true, userId: null, household: null, stale: false });
  },

  /** Signing out or deleting the account. */
  async wipe() {
    householdOnDevice = null;
    await del(KEY, db()).catch(() => undefined);
    publish({ signedOut: true, userId: null, household: null, stale: false });
  },
};
