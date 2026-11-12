import { useEffect, useState } from "react";
import { measureStore, type Measure } from "@/services/measureStore";

/** "Mes mesures": every measure, kept up to date. */
export function useMeasures() {
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void measureStore.list().then((all) => {
        if (cancelled) return;
        setMeasures(all);
        setIsLoading(false);
      });
    load();
    const unsubscribe = measureStore.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { measures, isLoading };
}
