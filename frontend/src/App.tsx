import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient, defaultBaseUrl, defaultProxyTarget, type ApiClient } from './api/client';
import { createSampleFetch } from './api/sampleData';
import type { DataMode } from './api/types';
import { AppContext } from './components/AppContext';
import { ApiError } from './api/client';
import { ErrorBoundary } from './components/ui';
import { useResource } from './hooks/useResource';
import Alerts from './sections/Alerts';
import Backtest from './sections/Backtest';
import Consensus from './sections/Consensus';
import Contracts from './sections/Contracts';
import DataStatus from './sections/DataStatus';
import Glossary from './sections/Glossary';
import Overview from './sections/Overview';
import Prices from './sections/Prices';
import Workflow from './sections/Workflow';

const NAV = [['overview', 'Overview'], ['prices', 'Prices'], ['consensus', 'Consensus'], ['alerts', 'Alerts'], ['contracts', 'Contracts'], ['backtest', 'Backtest'], ['data', 'Data'], ['workflow', 'Workflow'], ['glossary', 'Glossary']];

export default function App({ client: injected }: { client?: ApiClient }) {
  const sampleMode = !injected && import.meta.env.VITE_DATA_SOURCE !== 'api';
  const [dataMode, setDataMode] = useState<'historical_file' | 'synthetic'>(sampleMode ? 'synthetic' : 'historical_file');
  const [activeSection, setActiveSection] = useState(() => window.location.hash.slice(1) || 'overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [modes, setModes] = useState<Record<string, DataMode>>({});
  const client = useMemo(() => injected ?? createClient({
    baseUrl: defaultBaseUrl,
    dataMode,
    fetchImpl: sampleMode ? createSampleFetch() : undefined,
  }), [injected, dataMode, sampleMode]);
  const refreshAll = useCallback(() => setRefreshKey((k) => k + 1), []);
  const reportMode = useCallback((s: string, m: DataMode | null) => setModes((prev) => {
    if ((prev[s] ?? null) === m) return prev;
    const next = { ...prev };
    if (m) next[s] = m; else delete next[s];
    return next;
  }), []);

  const health = useResource(() => client.health(), [client, refreshKey]);
  const values = Object.values(modes);
  const hasDemo = !sampleMode && values.includes('synthetic');
  const mixed = values.some((m) => m !== 'unknown' && m !== dataMode);
  const down = !sampleMode && health.error !== null;

  useEffect(() => {
    const updateActiveSection = () => setActiveSection(window.location.hash.slice(1) || 'overview');
    window.addEventListener('hashchange', updateActiveSection);
    return () => window.removeEventListener('hashchange', updateActiveSection);
  }, []);

  return (
    <AppContext.Provider value={{ client, refreshKey, refreshAll, reportMode, dataMode, setDataMode, sampleMode }}>
      <header className="top">
        <div className="brand"><span className="logo">AURUM EDGE</span><span className="tag">Explainable MCX gold futures intelligence</span></div>
        <nav aria-label="Sections">{NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined}>{label}</a>
        ))}</nav>
        <span className={`connection-status ${sampleMode ? 'sample' : health.data?.status === 'ok' ? 'connected' : down ? 'offline' : 'checking'}`}
          role="status">{sampleMode ? 'Sample preview' : health.data?.status === 'ok' ? 'Backend connected' : down ? 'Backend unavailable' : 'Checking backend'}</span>
        {!sampleMode && <label className="mode-select">Dataset
          <select value={dataMode} onChange={(event) => setDataMode(event.target.value as 'historical_file' | 'synthetic')}>
            <option value="historical_file">Uploaded historical</option>
            <option value="synthetic">Synthetic demo</option>
          </select>
        </label>}
        <button className="btn" onClick={refreshAll}>Refresh</button>
      </header>
      <a className="skip-link" href="#overview">Skip to dashboard</a>
      {sampleMode && <div className="banner demo" role="status"><strong>STATIC SAMPLE PREVIEW</strong> — illustrative fixture values only; not live, current, or backend market data. Backend actions are disabled.</div>}
      {hasDemo && !mixed && <div className="banner demo" role="status"><strong>SYNTHETIC DATA</strong> – backend-generated demonstration values only; they do not represent real MCX market conditions.</div>}
      {mixed && <div className="banner bad" role="alert"><strong>Mixed data modes detected.</strong> Some sections do not match the selected backend dataset. Do not compare them until refreshed.</div>}
      {down && (
        <div className="banner bad" role="alert">
          <strong>{health.error instanceof ApiError && health.error.kind === 'http' && health.error.status === 502 && import.meta.env.DEV && !defaultBaseUrl
            ? 'Local API proxy returned 502'
            : health.error instanceof ApiError && health.error.kind === 'http'
            ? `Backend health check failed${health.error.status ? ` (HTTP ${health.error.status})` : ''}`
            : `Cannot reach the backend${defaultBaseUrl ? ` at ${defaultBaseUrl}` : ''}.`}</strong>
          {health.error instanceof ApiError && health.error.kind === 'http' && health.error.status === 502 && import.meta.env.DEV && !defaultBaseUrl
            ? <> Vite is proxying API requests to <code>{defaultProxyTarget}</code>. Start the backend on that address or set <code>VITE_DEV_PROXY_TARGET</code> to its actual address, then retry.</>
            : <> Check that the backend is running and exposes the documented API. No local prices are substituted.</>}
          <button className="btn small" onClick={refreshAll}>Retry</button>
        </div>
      )}
      <main>
        <ErrorBoundary name="Overview"><Overview /></ErrorBoundary>
        <ErrorBoundary name="Prices"><Prices /></ErrorBoundary>
        <ErrorBoundary name="Consensus"><Consensus /></ErrorBoundary>
        <ErrorBoundary name="Alerts"><Alerts /></ErrorBoundary>
        <ErrorBoundary name="Contracts"><Contracts /></ErrorBoundary>
        <ErrorBoundary name="Backtest"><Backtest /></ErrorBoundary>
        <ErrorBoundary name="Data status"><DataStatus /></ErrorBoundary>
        <ErrorBoundary name="Workflow"><Workflow /></ErrorBoundary>
        <Glossary />
      </main>
      <footer>Quantitative research tool – not investment advice. No profit is guaranteed.</footer>
    </AppContext.Provider>
  );
}
