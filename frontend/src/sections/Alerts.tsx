import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApp, useReportMode } from '../components/AppContext';
import { Async, Card, ModeBadge, Term } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { fmtDate, fmtNum, fmtPct, fmtSigned } from '../lib/format';
import { loadLocalAlertRules, saveLocalAlertRules, type LocalAlertRule } from '../lib/preferences';
import type { Signal } from '../api/types';

const SEV: Record<Signal['severity'], string> = { info: 'Info', watch: 'Watch', alert: 'Statistical alert', guarded: 'Guarded' };
const LIQUIDITY: Record<Signal['liquidity_status'], string> = { passed: 'Passed', not_passed: 'Did not pass', unknown: 'Unknown' };

function Details({ s, onClose }: { s: Signal; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    btn.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.current.focus();
      } else if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" ref={dialog} role="dialog" aria-modal="true" aria-label={`Alert details for ${s.symbol}`}
        tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>{s.symbol} – why this was flagged</h3>
        <p>{s.explanation || 'The backend did not provide an explanation for this alert.'}</p>
        <dl>
          <dt><Term>Residual</Term></dt><dd>{fmtSigned(s.residual_abs)} ₹/g ({s.residual_pct == null ? 'unavailable' : `${fmtSigned(s.residual_pct)}%`})</dd>
          <dt><Term>Z-score</Term></dt><dd>{fmtSigned(s.zscore)}</dd>
          <dt><Term>Liquidity guard</Term></dt><dd>{LIQUIDITY[s.liquidity_status]}</dd>
          <dt><Term>Expiry guard</Term></dt><dd>{s.expiry_warning ?? 'No expiry warning'}</dd>
          <dt>Data quality</dt><dd>{s.data_quality_warnings.length ? s.data_quality_warnings.join('; ') : 'No warnings'}</dd>
          <dt>Cost-adjusted assessment</dt>
          <dd>Not provided by the backend. This statistical deviation is not a validated profitable opportunity.</dd>
        </dl>
        <button className="btn" ref={btn} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function LocalRules() {
  const { client, refreshKey } = useApp();
  const history = useResource(() => client.history(), [client, refreshKey]);
  const initial = useState(() => loadLocalAlertRules())[0];
  const [rules, setRules] = useState(initial.rules);
  const [storageError, setStorageError] = useState(initial.error);
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<LocalAlertRule['direction']>('above');
  const [target, setTarget] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const symbols = history.data?.series.map((item) => item.symbol) ?? [];

  function updateRules(next: LocalAlertRule[]) {
    setRules(next);
    try {
      saveLocalAlertRules(next);
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not save rules in this browser.');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validSymbol = symbols.find((item) => item.toLowerCase() === symbol.trim().toLowerCase());
    const numericTarget = Number(target);
    if (!validSymbol) {
      setFormError('Choose an available contract symbol from the current dataset.');
      return;
    }
    if (!Number.isFinite(numericTarget) || numericTarget <= 0) {
      setFormError('Enter a target price greater than zero.');
      return;
    }
    const nextRule: LocalAlertRule = {
      id: editingId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      symbol: validSymbol,
      direction,
      target: numericTarget,
    };
    updateRules(editingId
      ? rules.map((rule) => rule.id === editingId ? nextRule : rule)
      : [...rules, nextRule]);
    setSymbol('');
    setTarget('');
    setEditingId(null);
    setFormError('');
  }

  function edit(rule: LocalAlertRule) {
    setEditingId(rule.id);
    setSymbol(rule.symbol);
    setDirection(rule.direction);
    setTarget(String(rule.target));
    setFormError('');
  }

  return (
    <div className="local-rules">
      <div className="subsection-head">
        <div><h3>Saved price rules</h3><span className="badge local-badge">Local only · not monitored</span></div>
      </div>
      <p className="note">Rules are stored in this browser only. They do not run in the background, send notifications, or create backend alerts.</p>
      {history.error && !history.data && <p className="note warn">Cannot offer symbol choices until market history is available.</p>}
      <form className="rule-form" onSubmit={submit}>
        <label>Contract
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)} disabled={symbols.length === 0}>
            <option value="">Select an available contract</option>
            {symbols.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Condition
          <select value={direction} onChange={(event) => setDirection(event.target.value as LocalAlertRule['direction'])}>
            <option value="above">At or above</option><option value="below">At or below</option>
          </select>
        </label>
        <label>Target price (₹/g)
          <input type="number" inputMode="decimal" min="0.01" step="any" value={target}
            onChange={(event) => setTarget(event.target.value)} required />
        </label>
        <button className="btn" type="submit" disabled={symbols.length === 0}>{editingId ? 'Save changes' : 'Save rule'}</button>
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setSymbol(''); setTarget(''); setFormError(''); }}>Cancel</button>}
      </form>
      {formError && <p className="error" role="alert">{formError}</p>}
      {storageError && <p className="error" role="alert">Could not persist local rules: {storageError}</p>}
      {rules.length === 0 ? <p className="empty">No local rules saved.</p> : (
        <ul className="rule-list">{rules.map((rule) => (
          <li key={rule.id}>
            <span><strong>{rule.symbol}</strong> {rule.direction} ₹{rule.target.toLocaleString('en-IN')}/g</span>
            <span className="rule-actions">
              <button className="btn small" onClick={() => edit(rule)}>Edit</button>
              <button className="btn small" aria-label={`Delete ${rule.symbol} price rule`}
                onClick={() => { updateRules(rules.filter((item) => item.id !== rule.id)); if (editingId === rule.id) setEditingId(null); }}>Delete</button>
            </span>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

export default function Alerts() {
  const { client, refreshKey } = useApp();
  const res = useResource(() => client.signals(), [client, refreshKey]);
  useReportMode('signals', res.data?.data_mode);
  const [open, setOpen] = useState<Signal | null>(null);
  return (
    <Card id="alerts" title="Anomaly alerts" actions={<ModeBadge mode={res.data?.data_mode} />}>
      <Async res={res} isEmpty={(d) => d.signals.length === 0} emptyText="No statistical alerts for the latest analysis.">{(d) => (
        <>
          <p className="note">Alerts mark statistically unusual deviations from the consensus. They are not trade recommendations.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Contract</th><th>Expiry</th><th>Normalized</th><th>Consensus</th><th>Residual</th><th><Term>Z-score</Term></th><th>Status</th><th>Liquidity</th><th>Expiry warning</th><th>Data quality</th><th /></tr></thead>
            <tbody>{d.signals.map((s) => (
              <tr key={s.id}><td>{s.symbol}</td><td>{fmtDate(s.expiry)}</td><td>{fmtNum(s.normalized_price)}</td><td>{fmtNum(s.consensus_price)}</td>
                <td>{fmtSigned(s.residual_abs)} ({s.residual_pct == null ? fmtPct(null) : `${fmtSigned(s.residual_pct)}%`})</td><td>{fmtSigned(s.zscore)}</td>
                <td><span className={`badge sev-${s.severity}`}>{SEV[s.severity]}</span></td><td>{LIQUIDITY[s.liquidity_status]}</td>
                <td>{s.expiry_warning ?? '—'}</td><td>{s.data_quality_warnings.length ? `${s.data_quality_warnings.length} warning(s)` : '—'}</td>
                <td><button className="btn small" onClick={() => setOpen(s)} aria-label={`Explain alert for ${s.symbol}`}>Explain</button></td></tr>))}</tbody>
          </table></div>
        </>
      )}</Async>
      <LocalRules />
      {open && <Details s={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}
