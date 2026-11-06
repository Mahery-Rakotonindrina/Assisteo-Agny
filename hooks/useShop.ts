import { useEffect, useState } from "react";
import { shopStore, type ShopRecord } from "@/services/shopStore";

/** "Ma boutique": every record, kept up to date. */
export function useShop() {
  const [records, setRecords] = useState<ShopRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void shopStore.list().then((all) => {
        if (cancelled) return;
        setRecords(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = shopStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { records, isLoading };
}
