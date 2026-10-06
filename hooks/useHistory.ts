import { useEffect, useState } from "react";
import { historyStore } from "@/services/historyStore";
import type { HistoryEntry } from "@/types/history";

/** All history entries, newest first, kept in sync with the store. */
export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      historyStore.list().then((list) => {
        if (cancelled) return;
        setEntries(list);
        setIsLoading(false);
      });

    void load();
    const unsubscribe = historyStore.subscribe(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { entries, isLoading };
}

/** A single entry; `undefined` while loading, `null` when it doesn't exist. */
export function useHistoryEntry(id: string | undefined) {
  const [entry, setEntry] = useState<HistoryEntry | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = () =>
      historyStore.get(id).then((found) => {
        if (!cancelled) setEntry(found ?? null);
      });

    void load();
    const unsubscribe = historyStore.subscribe(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);

  return entry;
}
