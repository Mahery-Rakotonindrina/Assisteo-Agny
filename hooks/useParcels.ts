import { useEffect, useState } from "react";
import type { SharedParcelRecord } from "@/lib/householdShares";
import { parcelStore, type Parcel } from "@/services/parcelStore";
import { sharedParcelStore } from "@/services/sharedParcels";

/** Followed parcels, kept in sync with the store. */
export function useParcels() {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      parcelStore.list().then((list) => {
        if (cancelled) return;
        setParcels(list);
        setIsLoading(false);
      });
    void load();
    const unsubscribe = parcelStore.subscribe(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { parcels, isLoading };
}

/** The parcels shared with the household (every member's copies), kept up to date. */
export function useSharedParcels() {
  const [shared, setShared] = useState<SharedParcelRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void sharedParcelStore.list().then((list) => {
        if (!cancelled) setShared(list);
      });
    load();
    const unsubscribe = sharedParcelStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return shared;
}
