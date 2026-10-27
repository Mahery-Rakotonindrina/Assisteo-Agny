import { useEffect, useState } from "react";
import { vehicleStore, type Vehicle } from "@/services/vehicleStore";

/** "Mon garage", kept up to date. */
export function useVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void vehicleStore.list().then((all) => {
        if (cancelled) return;
        setVehicles(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = vehicleStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { vehicles, isLoading };
}
