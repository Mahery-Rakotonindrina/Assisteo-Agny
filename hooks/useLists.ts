import { useEffect, useState } from "react";
import { listStore, type SavedList } from "@/services/listStore";

/** "Mes listes", kept up to date. */
export function useLists() {
  const [lists, setLists] = useState<SavedList[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void listStore.list().then((all) => {
        if (cancelled) return;
        setLists(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = listStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { lists, isLoading };
}
