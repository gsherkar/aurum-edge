import { useMemo } from 'react';
import { useApp, useReportMode } from '../components/AppContext';
import LazyChart from '../components/LazyChart';
import { Async, Card, ModeBadge, Term } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { fmtDate, fmtInr, fmtNum, fmtPct, fmtSigned } from '../lib/format';
import { sortByAbsZ } from '../lib/transform';
import type { ConsensusResponse } from '../api/types';

const METHOD: Record<string, string> = { median: 'Median', equal_weighted: 'Equal-weighted', liquidity_weighted: 'Liquidity-weighted' };

function Body({ c }: { c: ConsensusResponse }) {
  const rows = useMemo(() => sortByAbsZ(c.contracts), [c.contracts]);
  const data = useMemo(() => [
    { type: 'bar', name: 'Contract', x: rows.map((r) => r.symbol), y: rows.map((r) => r.normalized_price), marker: { color: '#c9a24b' },
      hovertemplate: '%{x}: ₹%{y:,.2f}/g<extra></extra>' },
    { type: 'scatter', mode: 'lines', name: 'Consensus', x: rows.map((r) => r.symbol), y: rows.map(() => c.consensus_price),
      line: { color: '#5fb4ff', dash: 'dash' }, hovertemplate: 'Consensus: ₹%{y:,.2f}/g<extra></extra>' },
  ], [rows, c.consensus_price]);
  const layout = useMemo(() => ({ yaxis: { title: { text: '₹ per gram' }, gridcolor: '#26324a', autorange: true }, hovermode: 'closest' }), []);
  return (
    <>
      <p className="note"><strong><Term>Consensus</Term> method: {METHOD[c.method.name] ?? c.method.name}.</strong> {c.method.description}</p>
      <div className="stats"><div className="stat"><span className="stat-label">Consensus price ({fmtDate(c.as_of)})</span><span className="stat-value">{fmtInr(c.consensus_price)}</span></div></div>
      <LazyChart data={data} layout={layout} label="Normalized contract prices compared with the consensus price" />
      <div className="table-wrap"><table>
        <thead><tr><th>Contract</th><th>Normalized (₹/g)</th><th><Term>Residual</Term> (₹/g)</th><th>Residual %</th><th><Term>Z-score</Term></th><th>Weight</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.symbol}><td>{r.symbol}</td><td>{fmtNum(r.normalized_price)}</td><td>{fmtSigned(r.residual_abs)}</td>
            <td>{r.residual_pct == null ? fmtPct(null) : `${fmtSigned(r.residual_pct)}%`}</td><td>{fmtSigned(r.zscore)}</td><td>{fmtNum(r.weight, 3)}</td></tr>))}</tbody>
      </table></div>
    </>
  );
}

export default function Consensus() {
  const { client, refreshKey } = useApp();
  const res = useResource(() => client.consensus(), [client, refreshKey]);
  useReportMode('consensus', res.data?.data_mode);
  return (
    <Card id="consensus" title="Consensus analysis" actions={<ModeBadge mode={res.data?.data_mode} />}>
      <Async res={res} isEmpty={(c) => c.contracts.length === 0} emptyText="No consensus result yet.">{(c) => <Body c={c} />}</Async>
    </Card>
  );
}
