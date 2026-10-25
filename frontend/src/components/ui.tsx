import { Component, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { Resource } from '../hooks/useResource';
import type { DataMode } from '../api/types';
import { MODE_LABEL } from '../lib/format';

export const GLOSSARY: Record<string, string> = {
  'Normalized price': 'Contract price converted to a common ₹ per gram basis so different lot sizes and quotation units can be compared.',
  Consensus: 'A single reference price computed from all eligible contracts (method shown next to each result).',
  Residual: 'Contract normalized price minus the consensus price, shown in ₹/g and as a percentage.',
  'Z-score': 'How many standard deviations a residual is from its historical typical value. Large absolute values are statistically unusual – not necessarily tradable.',
  'Liquidity guard': 'Flags contracts with thin trading so alerts on them are treated with caution.',
  'Expiry guard': 'Flags contracts close to expiry, where prices can behave differently.',
  'Walk-forward backtest': 'Evaluation that repeatedly fits on past data and tests on the next unseen period, avoiding look-ahead bias.',
};

export function Term({ children }: { children: string }) {
  const def = GLOSSARY[children];
  if (!def) return <>{children}</>;
  return <span className="term" tabIndex={0} data-tip={def} aria-label={`${children}: ${def}`}>{children}</span>;
}

export function Card({ title, id, actions, children }: { title: ReactNode; id?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <header className="card-head"><h2 id={id ? `${id}-h` : undefined}>{title}</h2><div className="card-actions">{actions}</div></header>
      {children}
    </section>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton" role="status" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <div key={i} className="sk-line" />)}</div>;
}
export function Empty({ children }: { children: ReactNode }) { return <p className="empty">{children}</p>; }

export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <div className="error" role="alert">
      <strong>{api?.kind === 'timeout' ? 'Backend request timed out' : api?.kind === 'network' ? 'Backend unreachable' : 'Could not load this data'}</strong>
      <p>{error.message}{api?.status === 404 ? ' (endpoint not implemented yet – see API_CONTRACT.md)' : ''}</p>
      {api?.detail && <pre>{api.detail}</pre>}
      <button className="btn" onClick={onRetry}>Retry</button>
    </div>
  );
}

/** Renders loading skeleton / error with retry / empty state / content. */
export function Async<T>({ res, isEmpty, emptyText, children }: {
  res: Resource<T>; isEmpty?: (d: T) => boolean; emptyText?: string; children: (d: T) => ReactNode;
}) {
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!res.data) return <Skeleton />;
  return (
    <>
      {res.error && <ErrorState error={res.error} onRetry={res.reload} />}
      {isEmpty?.(res.data) ? <Empty>{emptyText ?? 'No data available.'}</Empty> : children(res.data)}
    </>
  );
}

export function ModeBadge({ mode }: { mode: DataMode | undefined }) {
  if (!mode) return null;
  return <span className={`badge mode-${mode}`}>{MODE_LABEL[mode] ?? mode}</span>;
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode; name?: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return <div className="error" role="alert"><strong>{this.props.name ?? 'This section'} failed to render</strong><p>{this.state.err.message}</p>
        <button className="btn" onClick={() => this.setState({ err: null })}>Try again</button></div>;
    }
    return this.props.children;
  }
}
