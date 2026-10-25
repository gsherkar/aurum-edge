import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface Resource<T> { data: T | null; error: ApiError | Error | null; loading: boolean; reload: () => void }

/** Loads data via `fetcher`; re-runs when `deps` change or `reload()` is called. Errors are surfaced, never swallowed. */
export function useResource<T>(fetcher: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    fetcher()
      .then((d) => { if (id === latest.current) { setData(d); setError(null); } })
      .catch((e: Error) => { if (id === latest.current) setError(e); })
      .finally(() => { if (id === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
