// Ways to narrow the history down: favourites and folders the user made.

type Filed = { favorite?: boolean; folder?: string };

/** "all", "favorites", or a folder as "folder:<name>". */
export type Collection = "all" | "favorites" | `folder:${string}`;

/** A folder name as typed: trimmed, single spaces, at most 40 characters. */
export function cleanFolder(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

/** The user's folders, by name, with how many scans each holds. */
export function folderList(entries: Filed[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry.folder) counts.set(entry.folder, (counts.get(entry.folder) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export function inCollection(entry: Filed, collection: Collection) {
  if (collection === "all") return true;
  if (collection === "favorites") return Boolean(entry.favorite);
  return entry.folder === collection.slice("folder:".length);
}
