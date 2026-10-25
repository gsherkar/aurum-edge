import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createClient } from './api/client';

vi.mock('./components/PlotlyChart', () => ({ default: ({ label }: { label: string }) => <div data-testid="chart">{label}</div> }));

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const dataset = (mode: string) => ({
  data_mode: mode, source_name: 'uploaded-fixture', data_date: '2025-01-03',
  last_updated: '2025-01-03T10:00:00Z', freshness: 'current',
  contracts: [{ symbol: 'GOLDM', expiry_date: '2025-02-05', close: 70000, settlement: null }],
  contracts_excluded_from_consensus: 0,
  consensus: { equal_weight_consensus: 7000, liquidity_weighted_consensus: 7000, market_n: 1 },
  normalization_note: 'Verified specifications only.',
  liquidity_weighting_method: 'raw_volume', liquidity_weighting_note: 'Experimental raw-volume weighting.',
});
const observation = (date: string, price: number) => ({
  symbol: 'GOLDM', expiry_date: '2025-02-05', source_name: 'uploaded-fixture',
  data_date: date, data_mode: 'historical_file', close: price * 10, settlement: null, normalized_close: price,
});

function backend(options: { singleObservation?: boolean } = {}) {
  const calls: { method: string; path: string }[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname });
    if (url.pathname === '/health') return json({ status: 'ok', app: 'Aurum', database: 'connected' });
    if (url.pathname === '/api/v1/market/summary') return json({ data_sets: [dataset('historical_file'), dataset('synthetic')] });
    if (url.pathname === '/api/v1/market/observations') return json(options.singleObservation
      ? [observation('2025-01-03', 7020)]
      : [observation('2025-01-03', 7020), observation('2025-01-01', 7000)]);
    if (url.pathname === '/api/v1/contracts') return json([{
      symbol: 'GOLDM', expiry_date: '2025-02-05', contract_quantity: 100, quotation_unit: 'grams',
      quotation_basis: 'per 10 grams', purity: 0.995, delivery_location: 'Mumbai', verification_status: 'verified',
    }]);
    if (url.pathname === '/api/v1/alerts') return json([]);
    if (url.pathname === '/api/v1/analysis/backtest') return json({
      method: 'walk-forward residual z-score', start_date: null, end_date: null, days_evaluated: 0,
      candidate_count: 0, trading_performance_claimed: false, daily_results: [],
      liquidity_weighting_method: 'raw_volume', liquidity_weighting_note: 'Experimental.',
    });
    if (url.pathname === '/api/v1/data/imports') return json([{
      import_id: 'import-1', file_name: 'prices.csv', source_name: 'uploaded-fixture',
      data_mode: 'historical_file', status: 'completed', summary: { valid_rows: 2 }, error: null,
      last_updated: '2025-01-03T10:00:00Z',
    }]);
    if (url.pathname === '/api/v1/data/files') return json({
      import_id: 'import-2', status: 'completed', data_mode: 'historical_file',
      source_name: 'prices.csv', summary: { valid_rows: 2 }, duplicate_upload: false,
    });
    if (url.pathname === '/api/v1/data/demo') return json({
      import_id: 'synthetic-1', status: 'completed', data_mode: 'synthetic', duplicate_upload: false, summary: {},
    });
    if (url.pathname === '/api/v1/workflows/imports/import-1/run') return json({
      status: 'submitted', import_id: 'import-1', task_run_id: 'task-123', task_slug: 'market-ingestion',
    }, 202);
    return Promise.resolve(new Response('missing backend route', { status: 404 }));
  });
  return { calls, client: createClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

describe('dashboard interactions against backend contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('explains a local 502 as a backend proxy connectivity problem', async () => {
    const client = createClient({
      fetchImpl: vi.fn(() => json({ error: 'upstream unavailable' }, 502)) as typeof fetch,
    });
    render(<App client={client} />);
    expect(await screen.findByText('Local API proxy returned 502')).toBeInTheDocument();
    expect(screen.getByText(/Start the backend on that address or set/)).toBeInTheDocument();
  });

  it('starts in a backend-independent static sample preview and disables backend operations', async () => {
    render(<App />);
    expect(await screen.findByText('STATIC SAMPLE PREVIEW')).toBeInTheDocument();
    expect(screen.getByText('Sample preview')).toBeInTheDocument();
    expect((await screen.findAllByText('Static frontend sample (not market data)')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: 'Explain alert for GOLDM' })).toBeInTheDocument();
    expect(screen.getByText(/File upload and dataset creation require the backend/)).toBeInTheDocument();
    expect(screen.getByText('No backend imports are available in sample preview.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit workflow' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/MCX data file/)).not.toBeInTheDocument();
    expect(screen.queryByText('Backend unavailable')).not.toBeInTheDocument();
  });

  it('opens alert details accessibly and restores focus on Escape', async () => {
    render(<App />);
    const explain = await screen.findByRole('button', { name: 'Explain alert for GOLDM' });
    explain.focus();
    fireEvent.click(explain);
    expect(await screen.findByRole('dialog', { name: 'Alert details for GOLDM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(explain).toHaveFocus();
  });

  it('loads backend summary/observations and does not call the former proposed endpoints', async () => {
    const { client, calls } = backend();
    render(<App client={client} />);
    await screen.findByLabelText('Search available contracts');
    expect(screen.getAllByText('uploaded-fixture').length).toBeGreaterThan(0);
    expect(calls.map((call) => call.path)).toContain('/api/v1/market/summary');
    expect(calls.map((call) => call.path)).toContain('/api/v1/market/observations');
    expect(calls.every(({ method }) => method === 'GET')).toBe(true);
    expect(calls.some(({ path }) => ['/api/v1/market/overview', '/api/v1/market/history', '/api/v1/signals', '/api/v1/workflows/status'].includes(path))).toBe(false);
  });

  it('allows a stale saved watchlist symbol to be removed', async () => {
    window.localStorage.setItem('aurum-edge.watchlist.v1', JSON.stringify(['OLD-FUT']));
    const { client } = backend();
    render(<App client={client} />);
    expect(await screen.findByRole('button', { name: 'Remove OLD-FUT from watchlist' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: 'Remove OLD-FUT from watchlist' }).closest('tr');
    expect(row).not.toBeNull();
    expect(row?.querySelectorAll('td')[2].textContent).toBe('Unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Remove OLD-FUT from watchlist' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove OLD-FUT from watchlist' })).not.toBeInTheDocument());
  });

  it('shows percent change unavailable when the selected history has only one observation', async () => {
    window.localStorage.setItem('aurum-edge.watchlist.v1', JSON.stringify(['GOLDM']));
    render(<App client={backend({ singleObservation: true }).client} />);
    const button = await screen.findByRole('button', { name: 'Remove GOLDM from watchlist' });
    const row = button.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getByText('₹7,020/g')).toBeInTheDocument();
    expect(within(row as HTMLTableRowElement).getAllByText('Unavailable')).toHaveLength(1);
  });

  it('searches returned market symbols and persists additions to the browser watchlist', async () => {
    const { client } = backend();
    const view = render(<App client={client} />);
    const search = await screen.findByLabelText('Search available contracts');
    fireEvent.change(search, { target: { value: 'NOT-REAL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('No exact match in the symbols returned by the backend.')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'goldm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('button', { name: 'Remove GOLDM from watchlist' })).toBeInTheDocument();
    expect(window.localStorage.getItem('aurum-edge.watchlist.v1')).toContain('GOLDM');
    view.unmount();
    render(<App client={client} />);
    expect(await screen.findByRole('button', { name: 'Remove GOLDM from watchlist' })).toBeInTheDocument();
  });

  it('filters contracts by instrument, expiry, and delivery location', async () => {
    render(<App />);
    const contracts = screen.getByRole('region', { name: 'Contract details' });
    const search = await within(contracts).findByLabelText('Search contracts');
    expect(within(contracts).getByText('GOLDM')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'GOLDPETAL' } });
    expect(within(contracts).getByText('GOLDPETAL')).toBeInTheDocument();
    expect(within(contracts).queryByText('GOLDM')).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'no-match' } });
    expect(within(contracts).getByText(/No contracts match/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(within(contracts).getByText('GOLDM')).toBeInTheDocument();
  });

  it('keeps every navigation link mapped to a real section and updates the active location', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(9);
    for (const link of links) {
      const target = link.getAttribute('href');
      expect(target).toMatch(/^#/);
      expect(document.querySelector(target as string)).not.toBeNull();
    }
    fireEvent.click(within(nav).getByRole('link', { name: 'Prices' }));
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Prices' })).toHaveAttribute('aria-current', 'location'));
  });

  it('creates, edits, and deletes a clearly browser-only price rule', async () => {
    const { client } = backend();
    const view = render(<App client={client} />);
    await screen.findByRole('option', { name: 'GOLDM' });
    fireEvent.change(screen.getByLabelText('Contract'), { target: { value: 'GOLDM' } });
    const ruleForm = screen.getByLabelText('Contract').closest('form');
    expect(ruleForm).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Target price (₹/g)'), { target: { value: '0' } });
    fireEvent.submit(ruleForm as HTMLFormElement);
    expect(await screen.findByText('Enter a target price greater than zero.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Target price (₹/g)'), { target: { value: '7000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(await screen.findByRole('button', { name: 'Delete GOLDM price rule' })).toBeInTheDocument();
    view.unmount();
    render(<App client={client} />);
    expect(await screen.findByRole('button', { name: 'Delete GOLDM price rule' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Target price (₹/g)'), { target: { value: '7500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText((_, element) => element?.textContent === 'GOLDM above ₹7,500/g')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete GOLDM price rule' }));
    expect(await screen.findByText('No local rules saved.')).toBeInTheDocument();
  });

  it('validates backtest date bounds and filters the sample diagnostic period', async () => {
    render(<App />);
    const start = await screen.findByLabelText('Start date');
    const end = screen.getByLabelText('End date');
    fireEvent.change(start, { target: { value: '2025-01-14' } });
    fireEvent.change(end, { target: { value: '2025-01-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply period' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Start date must be on or before the end date.');
    fireEvent.change(start, { target: { value: '2025-01-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply period' }));
    const rows = screen.getAllByRole('row').filter((row) => /13 Jan 2025|14 Jan 2025/.test(row.textContent ?? ''));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('submits an existing import and clearly does not claim completion or poll unsupported endpoints', async () => {
    const { client, calls } = backend();
    render(<App client={client} />);
    const select = await screen.findByLabelText('Import to process');
    fireEvent.change(select, { target: { value: 'import-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit workflow' }));
    expect(await screen.findByText(/Workflow submitted for import import-1/)).toBeInTheDocument();
    expect(screen.getByText(/does not expose a workflow-status endpoint/)).toBeInTheDocument();
    expect(calls).toContainEqual({ method: 'POST', path: '/api/v1/workflows/imports/import-1/run' });
    expect(calls.some(({ path }) => path.includes('/workflows/status'))).toBe(false);
  });

  it('uploads a selected file to the implemented backend endpoint', async () => {
    const { client, calls } = backend();
    render(<App client={client} />);
    const file = new File(['symbol,close'], 'prices.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText(/MCX data file/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import file' }));
    expect(await screen.findByText(/Import completed/)).toBeInTheDocument();
    expect(calls).toContainEqual({ method: 'POST', path: '/api/v1/data/files' });
  });
});
