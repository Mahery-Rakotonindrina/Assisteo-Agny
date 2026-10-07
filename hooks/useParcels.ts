import { useEffect, useState } from "react";
import { parcelStore, type Parcel } from "@/services/parcelStore";

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
