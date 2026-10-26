import { createContext, useContext, useEffect } from 'react';
import type { ApiClient } from '../api/client';
import type { BackendDataMode, DataMode } from '../api/types';

export interface AppCtx {
  client: ApiClient;
  refreshKey: number;          // bump to refetch every section
  refreshAll: () => void;
  reportMode: (section: string, mode: DataMode | null) => void;
  dataMode: BackendDataMode;
  setDataMode: (mode: BackendDataMode) => void;
  sampleMode: boolean;
}
export const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('AppContext missing');
  return c;
}
/** Lets each section tell the app which data mode its response used (for mixed-mode detection). */
export function useReportMode(section: string, mode: DataMode | undefined) {
  const { reportMode } = useApp();
  useEffect(() => {
    reportMode(section, mode ?? null);
    return () => reportMode(section, null);
  }, [section, mode, reportMode]);
}
