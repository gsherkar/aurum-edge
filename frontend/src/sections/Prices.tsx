import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useApp, useReportMode } from '../components/AppContext';
import LazyChart from '../components/LazyChart';
import { Async, Card, Empty, ModeBadge, Term } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { loadWatchlist, saveWatchlist } from '../lib/preferences';
import { buildPriceTraces, countMissing, dateBounds, rangeStartDate, type ChartRange } from '../lib/transform';
import type { HistoryResponse } from '../api/types';

const RANGES: ChartRange[] = ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'];

function Chart({ h }: { h: HistoryResponse }) {
  const symbols = h.series.map((s) => s.symbol);
  const bounds = useMemo(() => dateBounds(h.series), [h.series]);
  const [selected, setSelected] = useState<string[]>(symbols);
  const [start, setStart] = useState(bounds.min ?? '');
  const [end, setEnd] = useState(bounds.max ?? '');
  const [range, setRange] = useState<ChartRange | null>('ALL');
  const initialWatchlist = useMemo(() => loadWatchlist(), []);
  const [watchlist, setWatchlist] = useState(initialWatchlist.symbols);
  const [storageError, setStorageError] = useState(initialWatchlist.error);
  const [query, setQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  useEffect(() => {
    setSelected(symbols);
    setStart(bounds.min ?? '');
    setEnd(bounds.max ?? '');
    setRange('ALL');
  }, [h]);

  const traces = useMemo(() => buildPriceTraces(h.series, selected, start || undefined, end || undefined), [h.series, selected, start, end]);
  const data = useMemo(() => traces.map((t) => ({ ...t, type: 'scatter', mode: 'lines', connectgaps: false,
    hovertemplate: '%{x|%d %b %Y}<br>₹%{y:,.2f}/g<extra>%{fullData.name}</extra>' })), [traces]);
  const layout = useMemo(() => ({
    yaxis: { title: { text: h.unit === 'INR/gram' ? '₹ per gram' : h.unit }, gridcolor: '#26324a', automargin: true },
    xaxis: { title: { text: 'Date' }, gridcolor: '#26324a', automargin: true },
    legend: { orientation: 'h', y: -0.25 },
  }), [h.unit]);
  const missing = countMissing(traces);
  const toggle = (s: string) => setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const watchlistTraces = watchlist.map((symbol) => buildPriceTraces(h.series, [symbol], start || undefined, end || undefined)[0]
    ?? { name: symbol, x: [] as string[], y: [] as (number | null)[] });
  function selectRange(next: ChartRange) {
    setRange(next);
    setStart(next === 'ALL' ? bounds.min ?? '' : rangeStartDate(bounds.max, next) ?? bounds.min ?? '');
    setEnd(bounds.max ?? '');
  }
  function changeWatchlist(next: string[]) {
    setWatchlist(next);
    try {
      saveWatchlist(next);
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not save the watchlist in this browser.');
    }
  }
  function addToWatchlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = symbols.find((item) => item.toLowerCase() === query.trim().toLowerCase());
    if (!symbol) {
      setSearchError('No exact match in the symbols returned by the backend.');
      return;
    }
    setSearchError('');
    if (!watchlist.includes(symbol)) changeWatchlist([...watchlist, symbol]);
    setSelected((current) => current.includes(symbol) ? current : [...current, symbol]);
    setQuery('');
  }

  const latestDate = bounds.max;
  const watchRows = watchlistTraces.map((trace) => {
    const available = trace.y.flatMap((price, index) => price == null ? [] : [{ price, date: trace.x[index] }]);
    const first = available[0];
    const latest = available[available.length - 1];
    const changePct = available.length >= 2 && first && latest && first.price !== 0
      ? ((latest.price - first.price) / first.price) * 100
      : null;
    return { symbol: trace.name, first, latest, changePct };
  });

  return (
    <>
      <div className="market-meta">
        <span className="status-dot" aria-hidden="true" />
        <span>{h.data_mode === 'synthetic' ? 'Synthetic demonstration data' : 'Uploaded historical data'}</span>
        <span className="meta-separator">·</span>
        <span>Latest observation: {latestDate ?? 'Unavailable'}</span>
        <span className="meta-separator">·</span>
        <span>Source: {h.source ?? 'Unavailable'}</span>
      </div>
      <div className="range-controls" role="group" aria-label="Historical chart range">
        {RANGES.map((item) => (
          <button key={item} className={`range-btn${range === item ? ' active' : ''}`} aria-pressed={range === item}
            onClick={() => selectRange(item)}>{item}</button>
        ))}
        <span className="range-caption">Ranges reflect available historical observations; no prices are interpolated.</span>
      </div>
      <div className="controls">
        <fieldset><legend>Contracts</legend>
          {symbols.map((s) => <label key={s} className="chk"><input type="checkbox" checked={selected.includes(s)} onChange={() => toggle(s)} /> {s}</label>)}
        </fieldset>
        <label>From <input type="date" value={start} min={bounds.min} max={end || bounds.max} onChange={(e) => { setRange(null); setStart(e.target.value); }} /></label>
        <label>To <input type="date" value={end} min={start || bounds.min} max={bounds.max} onChange={(e) => { setRange(null); setEnd(e.target.value); }} /></label>
      </div>
      <p className="note">Prices are <Term>Normalized price</Term>s in ₹ per gram. {h.raw_unit_note ?? 'Raw exchange quotes use different lot sizes and units, so they are intentionally not plotted on this axis.'}</p>
      {selected.length === 0 || traces.every((t) => t.x.length === 0)
        ? <Empty>No observations for the selected contracts and date range.</Empty>
        : <LazyChart data={data} layout={layout} label="Normalized gold prices in rupees per gram by contract over time" />}
      {missing > 0 && <p className="note warn">{missing} missing observation(s) shown as gaps – not interpolated.</p>}
      <div className="watchlist-panel">
        <div className="subsection-head">
          <div><h3>Watchlist</h3><p className="note">Saved in this browser. Price changes use only the selected historical range.</p></div>
          <form className="search-form" onSubmit={addToWatchlist}>
            <label className="sr-only" htmlFor="asset-search">Search available contracts</label>
            <input id="asset-search" type="search" list="available-symbols" value={query} placeholder="Search symbol"
              onChange={(event) => { setQuery(event.target.value); setSearchError(''); }} />
            <datalist id="available-symbols">{symbols.map((symbol) => <option key={symbol} value={symbol} />)}</datalist>
            <button className="btn" type="submit">Add</button>
          </form>
        </div>
        {searchError && <p className="error" role="alert">{searchError}</p>}
        {storageError && <p className="error" role="alert">Watchlist preference could not be read or saved: {storageError}</p>}
        {watchRows.length === 0 ? <Empty>Search for a symbol present in the returned history to add it to your watchlist.</Empty> : (
          <div className="table-wrap"><table className="watch-table">
            <thead><tr><th>Contract</th><th>Latest normalized price</th><th>Period change</th><th>As of</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{watchRows.map(({ symbol, first, latest, changePct }) => (
              <tr key={symbol}>
                <td><button className="symbol-link" onClick={() => setSelected((current) => current.includes(symbol) ? current : [...current, symbol])}>{symbol}</button></td>
                <td>{latest ? `₹${latest.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}/g` : 'Unavailable'}</td>
                <td className={changePct == null ? '' : changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : ''}>
                  {changePct == null ? 'Unavailable' : `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`}
                </td>
                <td>{latest?.date ?? first?.date ?? 'Unavailable'}</td>
                <td><button className="btn small" aria-label={`Remove ${symbol} from watchlist`}
                  onClick={() => changeWatchlist(watchlist.filter((item) => item !== symbol))}>Remove</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

export default function Prices() {
  const { client, refreshKey } = useApp();
  const res = useResource(() => client.history(), [client, refreshKey]);
  useReportMode('history', res.data?.data_mode);
  return (
    <Card id="prices" title="Normalized gold prices (₹/g)" actions={<><ModeBadge mode={res.data?.data_mode} />{res.data?.source && <span className="badge">{res.data.source}</span>}</>}>
      <Async res={res} isEmpty={(h) => h.series.length === 0} emptyText="No price history available yet. Run an analysis or import data.">{(h) => <Chart h={h} />}</Async>
    </Card>
  );
}
