import { useState, type FormEvent } from 'react';
import { useApp, useReportMode } from '../components/AppContext';
import { Async, Card, Empty, ModeBadge, Stat, Term } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { fmtDate, fmtInt, fmtNum } from '../lib/format';

export default function Backtest() {
  const { client, refreshKey } = useApp();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [applied, setApplied] = useState<{ start_date?: string; end_date?: string }>({});
  const [formError, setFormError] = useState('');
  const res = useResource(() => client.backtest(applied), [client, refreshKey, applied]);
  useReportMode('backtest', res.data?.data_mode);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (start && end && start > end) {
      setFormError('Start date must be on or before the end date.');
      return;
    }
    setFormError('');
    setApplied({ start_date: start || undefined, end_date: end || undefined });
  }
  return (
    <Card id="backtest" title={<><Term>Walk-forward backtest</Term></>} actions={<ModeBadge mode={res.data?.data_mode} />}>
      <form className="controls" onSubmit={submit}>
        <label>Start date <input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>End date <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <button className="btn" type="submit">Apply period</button>
      </form>
      {formError && <p className="error" role="alert">{formError}</p>}
      <Async res={res}>{(backtest) => !backtest.available ? (
        <Empty><strong>No walk-forward observations are available for this period.</strong> The backend has not returned daily results for the selected dataset and dates.</Empty>
      ) : (
        <>
          <div className="stats">
            <Stat label="Evaluation period" value={`${fmtDate(backtest.start_date)} – ${fmtDate(backtest.end_date)}`} />
            <Stat label="Days evaluated" value={fmtInt(backtest.days_evaluated)} />
            <Stat label="Candidates flagged" value={fmtInt(backtest.candidate_count)} />
            <Stat label="Strategy profitability" value="Not evaluated" />
          </div>
          <p className="note"><strong>Method:</strong> {backtest.method}</p>
          <p className="note"><strong>Liquidity weighting:</strong> {backtest.liquidity_weighting_method}. {backtest.liquidity_weighting_note}</p>
          <p className="note warn">These are historical statistical diagnostics only. The backend does not claim trading performance, returns, precision, or profitability.</p>
          <h3>Daily diagnostics</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Contracts included</th><th>Equal-weight consensus (₹/g)</th><th>Liquidity-weighted consensus (₹/g)</th><th>Flagged candidates</th></tr></thead>
            <tbody>{backtest.daily_results.map((day) => (
              <tr key={day.data_date}>
                <td>{fmtDate(day.data_date)}</td><td>{fmtInt(day.contracts_included)}</td>
                <td>{fmtNum(day.equal_weight_consensus)}</td><td>{fmtNum(day.liquidity_weighted_consensus)}</td>
                <td>{day.candidates.length ? day.candidates.map((candidate) => `${candidate.symbol} (z=${fmtNum(candidate.z_score)})`).join(', ') : 'None'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}</Async>
    </Card>
  );
}
