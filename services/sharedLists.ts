import { acceptSharedList, isOwnShare, listIdOfShare, listShareId } from "@/lib/householdShares";
import { listStore, sharedListStore, type SavedList } from "./listStore";
import { createRowSync } from "./rowSync";

// "Mes listes" shared with the household (table "household_shares", kind
// "list"): a list shared leaves the personal ones for the household's, where
// every member ticks and adds items; the newest change wins, like the
// personal lists. Its author stops sharing it: it comes back to them. Out of
// the household, one's own come back and the others' go.

/** Shares a personal list with the household: written there first, then removed here (never lost, never in both). */
export async function shareList(list: SavedList, householdId: string, me: string) {
  const shared: SavedList = { ...list, id: listShareId(list.id), householdId, userId: me };
  delete shared.scanId;
  await sharedListStore.adopt(shared);
  await listStore.remove(list.id);
}

/** Stops sharing one's own list: back with the personal ones (its first id), out of the household. */
export async function unshareList(list: SavedList, me: string | null) {
  if (!isOwnShare(list, me)) return false;
  const personal: SavedList = { ...list, id: listIdOfShare(list.id) };
  delete personal.householdId;
  delete personal.userId;
  delete personal.dirty;
  await listStore.adopt(personal);
  await sharedListStore.remove(list.id);
  return true;
}

/** Out of the household: one's own shared lists come back (the server gives them back too, same ids), the others' go. */
export async function detachSharedLists(me: string | null) {
  for (const list of await sharedListStore.list()) {
    if (!isOwnShare(list, me)) continue;
    const personal: SavedList = { ...list, id: listIdOfShare(list.id) };
    delete personal.householdId;
    delete personal.userId;
    delete personal.dirty;
    await listStore.adopt(personal);
  }
  await sharedListStore.wipe();
}

const listSync = (householdId: string) =>
  createRowSync<SavedList>("household_shares", sharedListStore, {
    match: { household_id: householdId, kind: "list" },
    withAuthor: (record, userId) => (userId ? { ...record, userId } : record),
    accept: (record) => acceptSharedList(record) as SavedList | null,
  });

/** Keeps the household's lists synced while a member. Returns the stop function. */
export const startSharedListSync = (uid: string, householdId: string) => listSync(householdId).start(uid);

/** One sync now (before signing out). */
export const syncSharedLists = (uid: string, householdId: string) => listSync(householdId).sync(uid);
