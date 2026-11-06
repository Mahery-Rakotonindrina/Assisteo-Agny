import { useEffect, useState } from "react";
import { listStore, sharedListStore, type SavedList } from "@/services/listStore";

function useListStore(store: typeof listStore) {
  const [lists, setLists] = useState<SavedList[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void store.list().then((all) => {
        if (cancelled) return;
        setLists(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = store.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [store]);

  return { lists, isLoading };
}

/** "Mes listes", kept up to date. */
export function useLists() {
  return useListStore(listStore);
}

/** The lists shared with the household (every member's), kept up to date. */
export function useSharedLists() {
  return useListStore(sharedListStore);
}
