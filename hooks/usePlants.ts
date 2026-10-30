import { useEffect, useState } from "react";
import { plantStore, type Plant } from "@/services/plantStore";

/** "Mes plantes", kept up to date. */
export function usePlants() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void plantStore.list().then((all) => {
        if (cancelled) return;
        setPlants(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = plantStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { plants, isLoading };
}
