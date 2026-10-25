import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const dataset = (mode = 'historical_file') => ({
  data_mode: mode,
  source_name: 'fixture-upload',
  data_date: '2025-01-03',
  last_updated: '2025-01-03T10:00:00Z',
  freshness: 'current',
  contracts: [{ symbol: 'GOLDM', expiry_date: '2025-02-05', close: 70000, settlement: null }],
  contracts_excluded_from_consensus: 0,
  consensus: { equal_weight_consensus: 7000, liquidity_weighted_consensus: 7000, market_n: 1 },
  normalization_note: 'Verified specifications only.',
  liquidity_weighting_method: 'raw_volume',
  liquidity_weighting_note: 'Experimental raw-volume weighting.',
});
const observation = (date: string, price: number, source = 'fixture-upload') => ({
  symbol: 'GOLDM', expiry_date: '2025-02-05', source_name: source, data_date: date, data_mode: 'historical_file',
  close: price * 10, settlement: null, normalized_close: price,
});

function mockBackend() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push({ url: url.toString(), init });
    if (url.pathname === '/health') return json({ status: 'ok', app: 'Aurum', database: 'connected' });
    if (url.pathname === '/api/v1/market/summary') return json({ data_sets: [dataset()] });
    if (url.pathname === '/api/v1/market/observations') return json([
      observation('2025-01-03', 7020), observation('2025-01-01', 7000),
    ]);
    if (url.pathname === '/api/v1/contracts') return json([{
      symbol: 'GOLDM', expiry_date: '2025-02-05', contract_quantity: 100, quotation_unit: 'grams',
      quotation_basis: 'per 10 grams', purity: 0.995, delivery_location: 'Mumbai', verification_status: 'verified',
    }]);
    if (url.pathname === '/api/v1/alerts') return json([{
      id: 14, symbol: 'GOLDM', expiry_date: '2025-02-05', data_date: '2025-01-03',
      consensus_price_per_gram: 7000, normalized_price_per_gram: 7020, residual_pct: 0.28,
      historical_z_score: 2.8, anomaly_band: 'research-watch',
      guards: { liquidity: true, expiry: false, stale_data: true, data_quality: true },
      explanation: ['expiry is unknown or within the expiry guard window'],
    }]);
    if (url.pathname === '/api/v1/analysis/backtest') return json({
      method: 'walk-forward residual z-score', start_date: '2025-01-01', end_date: '2025-01-03',
      days_evaluated: 2, candidate_count: 1, trading_performance_claimed: false,
      liquidity_weighting_method: 'raw_volume', liquidity_weighting_note: 'Experimental weighting.',
      daily_results: [{
        data_date: '2025-01-03', equal_weight_consensus: 7000, liquidity_weighted_consensus: null,
        contracts_included: 1, candidates: [{ symbol: 'GOLDM', z_score: 2.8, residual_pct: 0.28 }],
      }],
    });
    if (url.pathname === '/api/v1/data/imports') return json([{
      import_id: 'import-1', file_name: 'prices.csv', source_name: 'fixture-upload',
      data_mode: 'historical_file', status: 'completed', summary: { valid_rows: 2 }, error: null,
      last_updated: '2025-01-03T10:00:00Z',
    }]);
    if (url.pathname === '/api/v1/data/files') return json({
      import_id: 'import-2', status: 'workflow_submitted', data_mode: 'historical_file',
      source_name: 'prices.csv', summary: { valid_rows: 2 }, duplicate_upload: false,
      task_run_id: 'task-123', task_slug: 'market-ingestion',
    }, 202);
    if (url.pathname === '/api/v1/data/demo') return json({
      import_id: 'synthetic-1', status: 'completed', data_mode: 'synthetic', duplicate_upload: false, summary: {},
    });
    if (url.pathname === '/api/v1/workflows/imports/import-1/run') return json({
      status: 'submitted', import_id: 'import-1', task_run_id: 'task-456', task_slug: 'market-ingestion',
    }, 202);
    return new Response('missing route', { status: 404 });
  });
  return { calls, fetchImpl, client: createClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

describe('backend API adapter', () => {
  it('uses the backend health endpoint and checks the required status field', async () => {
    const { client, calls } = mockBackend();
    expect(await client.health()).toEqual({ status: 'ok', app: 'Aurum', database: 'connected' });
    expect(new URL(calls[0].url).pathname).toBe('/health');
  });

  it('maps market summary and backend alert count into the overview without inventing workflow state', async () => {
    const { client } = mockBackend();
    expect(await client.overview()).toMatchObject({
      market_data_date: '2025-01-03', data_source: 'fixture-upload', data_mode: 'historical_file',
      freshness: { status: 'fresh', age_hours: null }, eligible_contracts: 1, alert_count: 1, latest_workflow: null,
    });
  });

  it('requests the selected dataset and normalizes observations for chart display', async () => {
    const calls: URL[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push(url);
      return Promise.resolve(json([observation('2025-01-03', 7020), observation('2025-01-01', 7000)]));
    });
    const syntheticClient = createClient({ fetchImpl: fetchImpl as typeof fetch, dataMode: 'synthetic' });
    const history = await syntheticClient.history();
    expect(calls[0].searchParams.get('data_mode')).toBe('synthetic');
    expect(history.data_mode).toBe('synthetic');
    expect(history.series[0].points.map((point) => point.date)).toEqual(['2025-01-01', '2025-01-03']);
  });

  it('maps actual contract fields and never assumes eligibility', async () => {
    const { client } = mockBackend();
    expect(await client.contracts()).toMatchObject({
      data_mode: 'historical_file',
      contracts: [{ symbol: 'GOLDM', quantity: 100, quantity_unit: 'grams', purity: 0.995, spec_status: 'verified', eligible: null }],
    });
  });

  it('maps backend alert guards and keeps unsupported cost estimates unavailable', async () => {
    const { client } = mockBackend();
    expect(await client.signals()).toMatchObject({
      signals: [{
        symbol: 'GOLDM', residual_abs: 20, zscore: 2.8, severity: 'watch',
        liquidity_status: 'passed', expiry_warning: 'Expiry guard did not pass.', cost_adjusted: null,
      }],
    });
  });

  it('sends supported backtest parameters and exposes only returned diagnostic fields', async () => {
    const { client, calls } = mockBackend();
    const result = await client.backtest({ start_date: '2025-01-01', end_date: '2025-01-03' });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/v1/analysis/backtest');
    expect(url.searchParams.get('start_date')).toBe('2025-01-01');
    expect(result).toMatchObject({ available: true, days_evaluated: 2, candidate_count: 1, trading_performance_claimed: false });
    expect('precision' in result).toBe(false);
  });

  it('loads data status and imports from supported backend endpoints', async () => {
    const { client, calls } = mockBackend();
    const result = await client.dataStatus();
    expect(result).toMatchObject({ data_mode: 'historical_file', records_imported: 2, imports: [{ import_id: 'import-1' }] });
    expect(calls.map(({ url }) => new URL(url).pathname)).toContain('/api/v1/data/imports');
  });

  it('uses multipart upload, backend demo POST, and import-specific workflow submission', async () => {
    const { client, calls } = mockBackend();
    const file = new File(['symbol,close'], 'prices.csv', { type: 'text/csv' });
    expect(await client.upload(file, { dataDate: '2025-01-03', columnMapping: '{"symbol":"Symbol"}' }))
      .toMatchObject({ import_id: 'import-2', status: 'workflow_submitted', task_run_id: 'task-123' });
    expect(await client.createDemoData()).toMatchObject({ import_id: 'synthetic-1', data_mode: 'synthetic' });
    expect(await client.workflow('import-1')).toMatchObject({ status: 'submitted', task_run_id: 'task-456' });
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual([
      '/api/v1/data/files', '/api/v1/data/demo', '/api/v1/workflows/imports/import-1/run',
    ]);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect(new URL(calls[0].url).searchParams.get('data_date')).toBe('2025-01-03');
    expect(new URL(calls[0].url).searchParams.get('column_mapping')).toBe('{"symbol":"Symbol"}');
  });

  it('classifies network, HTTP, JSON parsing, malformed summary, and timeout failures', async () => {
    await expect(createClient({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('offline')) as typeof fetch }).health())
      .rejects.toMatchObject({ kind: 'network' });
    await expect(createClient({ fetchImpl: vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })) as typeof fetch }).health())
      .rejects.toMatchObject({ kind: 'http', status: 503 });
    await expect(createClient({ fetchImpl: vi.fn().mockResolvedValue(new Response('<html>')) as typeof fetch }).health())
      .rejects.toMatchObject({ kind: 'parse' });
    const malformed = createClient({ fetchImpl: vi.fn(() => Promise.resolve(json({ data_sets: 'bad' }))) as typeof fetch });
    await expect(malformed.overview()).rejects.toMatchObject({ kind: 'parse' });

    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
      const request = expect(createClient({ fetchImpl, timeoutMs: 50 }).health()).rejects.toMatchObject({ kind: 'timeout' });
      await vi.advanceTimersByTimeAsync(50);
      await request;
    } finally {
      vi.useRealTimers();
    }
  });
});
