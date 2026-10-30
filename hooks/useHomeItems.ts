import { useEffect, useState } from "react";
import { homeItemStore, type HomeItem } from "@/services/homeItemStore";

/** "Ma maison", kept up to date. */
export function useHomeItems() {
  const [items, setItems] = useState<HomeItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void homeItemStore.list().then((all) => {
        if (cancelled) return;
        setItems(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = homeItemStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { items, isLoading };
}
