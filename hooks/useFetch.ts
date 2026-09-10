import { useEffect, useState } from "react";
import { ApiError } from "@/types/api";

type FetchState<T> = {
  data: T | null;
  error: ApiError | Error | null;
  isLoading: boolean;
};

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    error: null,
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    fetcher()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, isLoading: false });
      })
      .catch((error: ApiError | Error) => {
        if (!cancelled) setState({ data: null, error, isLoading: false });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
