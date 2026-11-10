import { useEffect, useState } from "react";
import type { SharedParcelRecord } from "@/lib/householdShares";
import { parcelStore, type Parcel } from "@/services/parcelStore";
import { sharedParcelStore } from "@/services/sharedParcels";

// The last list read: a component mounted later (a parcel opened: its freight
// fields) starts with it instead of an empty list, then reads it again.
// Never on the server, nor at hydration: nothing is read before an effect.
let lastRead: Parcel[] | null = null;
// Any change (a sync, signing out: wipe), even with no screen showing the
// parcels, forgets it: never a list of before, nor another account's.
parcelStore.subscribe(() => {
  lastRead = null;
});

/** Followed parcels, kept in sync with the store. */
export function useParcels() {
  const [parcels, setParcels] = useState<Parcel[]>(() => lastRead ?? []);
  const [isLoading, setIsLoading] = useState(() => lastRead === null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      parcelStore.list().then((list) => {
        lastRead = list;
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
