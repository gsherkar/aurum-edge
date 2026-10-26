import type * as T from './types';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse';
export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, message: string, public status?: number, public detail?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchLike = typeof fetch;
export interface ClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  dataMode?: T.BackendDataMode;
  timeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new ApiError('parse', 'Backend returned JSON with an unexpected response shape.');
  return value;
};
const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const records = (value: unknown): JsonRecord[] => {
  const rows = asArray(value);
  if (rows.some((row) => !isRecord(row))) throw new ApiError('parse', 'Backend returned an array containing an unexpected value.');
  return rows as JsonRecord[];
};
const modeFrom = (value: unknown): T.BackendDataMode =>
  value === 'synthetic' ? 'synthetic' : 'historical_file';
const summaryRows = (value: unknown): JsonRecord[] => {
  if (!isRecord(value) || !Array.isArray(value.data_sets) || value.data_sets.some((row) => !isRecord(row))) {
    throw new ApiError('parse', 'Backend market summary is missing the data_sets array.');
  }
  return value.data_sets as JsonRecord[];
};
const selectedSummary = (value: unknown, mode: T.BackendDataMode): JsonRecord | undefined =>
  summaryRows(value).find((row) => row.data_mode === mode);

export function createClient({
  baseUrl = '',
  fetchImpl,
  dataMode = 'historical_file',
  timeoutMs = 15000,
}: ClientOptions = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const doFetch: FetchLike = (...args) => (fetchImpl ?? fetch)(...args);

  async function request(path: string, params?: Record<string, string | undefined>, init?: RequestInit): Promise<unknown> {
    const qs = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => { if (value) qs.set(key, value); });
    const url = `${base}${path}${qs.toString() ? `?${qs}` : ''}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url, {
        ...init,
        headers: { Accept: 'application/json', ...init?.headers },
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new ApiError('http', `Backend returned ${response.status} ${response.statusText}`.trim(), response.status, detail);
      }
      return await response.json() as unknown;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) {
        throw new ApiError('timeout', `The backend did not respond within ${timeoutMs / 1000} seconds.`);
      }
      if (error instanceof SyntaxError || (error instanceof Error && error.name === 'SyntaxError')) {
        throw new ApiError('parse', 'Backend returned a response that is not valid JSON.');
      }
      throw new ApiError('network', 'Cannot reach the AURUM EDGE backend.', undefined,
        error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadHistory(): Promise<T.HistoryResponse> {
    const rows = records(await request('/api/v1/market/observations', {
      data_mode: dataMode, limit: '1000',
    }));
    const bySymbol = new Map<string, T.HistoryResponse['series'][number]['points']>();
    let source: string | null = null;
    for (const row of rows) {
      const name = text(row.symbol);
      if (!name) continue;
      source ??= text(row.source_name);
      const points = bySymbol.get(name) ?? [];
      points.push({
        date: text(row.data_date) ?? '',
        normalized_price: num(row.normalized_close),
        raw_price: num(row.close) ?? num(row.settlement),
      });
      bySymbol.set(name, points);
    }
    const series = [...bySymbol.entries()].map(([name, points]) => ({
      symbol: name,
      points: points.sort((a, b) => a.date.localeCompare(b.date)),
    }));
    return {
      data_mode: dataMode,
      source,
      unit: '₹/g',
      raw_unit_note: 'Raw close and settlement values retain the uploaded file units.',
      series,
    };
  }

  async function loadImports(): Promise<T.ImportBatch[]> {
    return records(await request('/api/v1/data/imports', { limit: '50' })).map((row) => ({
      import_id: text(row.import_id) ?? '',
      file_name: text(row.file_name) ?? 'Unknown file',
      source_name: text(row.source_name) ?? 'Unknown source',
      data_mode: modeFrom(row.data_mode),
      status: text(row.status) ?? 'unknown',
      summary: isRecord(row.summary) ? row.summary : {},
      error: text(row.error),
      last_updated: text(row.last_updated),
    })).filter((batch) => batch.import_id.length > 0);
  }

  async function mapDataStatus(): Promise<T.DataStatus> {
    const [summary, imports] = await Promise.all([request('/api/v1/market/summary'), loadImports()]);
    const selected = selectedSummary(summary, dataMode);
    const latest = imports.find((item) => item.data_mode === dataMode);
    const invalidRows = (latest?.summary.validation_invalid_rows?.length ?? 0)
      + (latest?.summary.parse_invalid_rows?.length ?? 0);
    const validationStatus = !latest ? 'unknown'
      : latest.status === 'failed' ? 'invalid'
        : invalidRows > 0 ? 'warnings'
          : latest.status === 'completed' || latest.status === 'analysis_persisted' ? 'valid' : 'unknown';
    return {
      data_mode: selected ? dataMode : 'unknown',
      latest_data_date: text(selected?.data_date),
      source: text(selected?.source_name) ?? latest?.source_name ?? null,
      last_import_at: latest?.last_updated ?? text(selected?.last_updated),
      validation_status: validationStatus,
      records_imported: num(latest?.summary.valid_rows),
      warnings: [
        ...(latest?.error ? [latest.error] : []),
        ...(invalidRows > 0 ? [`${invalidRows} row(s) failed parsing or validation.`] : []),
      ],
      upload_supported: true,
      imports,
    };
  }

  async function upload(file: File, options: { dataDate?: string; columnMapping?: string } = {}): Promise<T.UploadResult> {
    const body = new FormData();
    body.append('file', file);
    const response = await request('/api/v1/data/files', {
      data_date: options.dataDate,
      column_mapping: options.columnMapping,
    }, { method: 'POST', body });
    if (!isRecord(response)) {
      throw new ApiError('parse', 'Backend upload response is missing its import ID or status.');
    }
    const importId = text(response.import_id);
    const status = text(response.status);
    if (!importId || !status) throw new ApiError('parse', 'Backend upload response is missing its import ID or status.');
    return {
      import_id: importId,
      status,
      data_mode: modeFrom(response.data_mode),
      source_name: text(response.source_name),
      summary: isRecord(response.summary) ? response.summary : {},
      duplicate_upload: response.duplicate_upload === true,
      ...(text(response.task_run_id) ? { task_run_id: text(response.task_run_id)! } : {}),
      ...(text(response.task_slug) ? { task_slug: text(response.task_slug)! } : {}),
      ...(text(response.provenance_note) ? { provenance_note: text(response.provenance_note)! } : {}),
    };
  }

  return {
    health: async (): Promise<T.Health> => {
      const value = await request('/health');
      if (!isRecord(value)) throw new ApiError('parse', 'Backend health response is missing status.');
      const status = text(value.status);
      if (!status) throw new ApiError('parse', 'Backend health response is missing status.');
      return { status, app: text(value.app) ?? undefined, database: text(value.database) ?? undefined };
    },
    overview: async (): Promise<T.Overview> => {
      const [summary, alerts] = await Promise.all([
        request('/api/v1/market/summary'),
        request('/api/v1/alerts', { data_mode: dataMode, limit: '100' }),
      ]);
      const row = selectedSummary(summary, dataMode);
      const dataDate = text(row?.data_date);
      const updated = text(row?.last_updated);
      const freshness = text(row?.freshness);
      const alertRows = records(alerts);
      return {
        last_updated: updated,
        market_data_date: dataDate,
        data_source: text(row?.source_name),
        data_mode: row ? dataMode : 'unknown',
        freshness: { status: freshness === 'stale' ? 'stale' : freshness === 'current' ? 'fresh' : 'unknown', age_hours: null },
        eligible_contracts: isRecord(row?.consensus) ? num(row.consensus.market_n) : null,
        alert_count: alertRows.filter((alert) => text(alert.data_date) === dataDate).length,
        latest_workflow: null,
      };
    },
    contracts: async (): Promise<T.ContractsResponse> => {
      const rows = records(await request('/api/v1/contracts', { data_mode: dataMode }));
      return {
        data_mode: dataMode,
        contracts: rows.map((row) => ({
          symbol: text(row.symbol) ?? 'Unknown',
          expiry: text(row.expiry_date),
          quantity: num(row.contract_quantity),
          quantity_unit: row.verification_status === 'demo-only' ? 'grams' : text(row.quotation_unit),
          quotation_basis: text(row.quotation_basis),
          purity: num(row.purity),
          delivery_location: text(row.delivery_location),
          spec_status: row.verification_status === 'verified' || row.verification_status === 'unverified' || row.verification_status === 'demo-only'
            ? row.verification_status : 'unverified',
          eligible: null,
        })),
      };
    },
    history: async (params: { symbols?: string[]; start?: string; end?: string } = {}) => {
      const history = await loadHistory();
      return {
        ...history,
        series: history.series
          .filter((series) => !params.symbols || params.symbols.includes(series.symbol))
          .map((series) => ({
            ...series,
            points: series.points.filter((point) => (!params.start || point.date >= params.start)
              && (!params.end || point.date <= params.end)),
          })),
      };
    },
    consensus: async (date?: string): Promise<T.ConsensusResponse> => {
      const [summary, history] = await Promise.all([request('/api/v1/market/summary'), loadHistory()]);
      const row = selectedSummary(summary, dataMode);
      const contracts = row ? records(row.contracts) : [];
      const latestBySymbol = new Map(history.series.map((series) => [
        series.symbol,
        series.points.find((point) => point.date === text(row?.data_date))?.normalized_price ?? null,
      ]));
      const equal = isRecord(row?.consensus) ? num(row.consensus.equal_weight_consensus) : null;
      return {
        data_mode: row ? dataMode : 'unknown',
        as_of: date ?? text(row?.data_date),
        unit: '₹/g',
        method: {
          name: 'equal_weighted',
          description: `${text(row?.normalization_note) ?? 'Consensus uses normalized backend observations.'} ${text(row?.liquidity_weighting_note) ?? ''}`.trim(),
        },
        consensus_price: equal,
        contracts: contracts.map((contract) => {
          const symbol = text(contract.symbol) ?? 'Unknown';
          const price = latestBySymbol.get(symbol) ?? null;
          return {
            symbol,
            normalized_price: price,
            residual_abs: price != null && equal != null ? price - equal : null,
            residual_pct: price != null && equal ? (price - equal) / equal * 100 : null,
            zscore: null,
            weight: null,
          };
        }),
        history: [...new Set(history.series.flatMap((series) => series.points.map((point) => point.date)))].sort()
          .map((historyDate) => {
            const prices = history.series.flatMap((series) => {
              const point = series.points.find((item) => item.date === historyDate);
              return point?.normalized_price == null ? [] : [point.normalized_price];
            });
            return {
              date: historyDate,
              consensus_price: prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : null,
            };
          }),
      };
    },
    signals: async (): Promise<T.SignalsResponse> => {
      const rows = records(await request('/api/v1/alerts', { data_mode: dataMode, limit: '100' }));
      return {
        data_mode: dataMode,
        as_of: rows.map((row) => text(row.data_date) ?? '').sort().slice(-1)[0] || null,
        signals: rows.map((row) => {
          const guards = isRecord(row.guards) ? row.guards : {};
          const normalized = num(row.normalized_price_per_gram);
          const consensus = num(row.consensus_price_per_gram);
          const band = text(row.anomaly_band) ?? 'unknown';
          const explanation = typeof row.explanation === 'string'
            ? row.explanation
            : Array.isArray(row.explanation) && row.explanation.every((item) => typeof item === 'string')
              ? row.explanation.join('; ')
              : JSON.stringify(row.explanation ?? {});
          const qualityWarnings = Array.isArray(row.explanation)
            ? row.explanation.filter((item): item is string => typeof item === 'string' && item.toLowerCase().includes('quality'))
            : [];
          return {
            id: String(row.id ?? `${text(row.symbol) ?? 'alert'}-${text(row.data_date) ?? ''}`),
            symbol: text(row.symbol) ?? 'Unknown',
            expiry: text(row.expiry_date),
            normalized_price: normalized,
            consensus_price: consensus,
            residual_abs: normalized != null && consensus != null ? normalized - consensus : null,
            residual_pct: num(row.residual_pct),
            zscore: num(row.historical_z_score),
            severity: band.toLowerCase().includes('guard') ? 'guarded' : band.toLowerCase().includes('watch') ? 'watch' : 'alert',
            anomaly_band: band,
            liquidity_status: guards.liquidity === true ? 'passed' : guards.liquidity === false ? 'not_passed' : 'unknown',
            expiry_warning: guards.expiry === false ? 'Expiry guard did not pass.' : null,
            data_quality_warnings: guards.data_quality === false
              ? qualityWarnings.length ? qualityWarnings : ['Backend data-quality guard did not pass.']
              : [],
            explanation,
            cost_adjusted: null,
          };
        }),
      };
    },
    backtest: async (params: { start_date?: string; end_date?: string } = {}): Promise<T.BacktestSummary> => {
      const value = await request('/api/v1/analysis/backtest', {
        data_mode: dataMode, start_date: params.start_date, end_date: params.end_date,
      });
      if (!isRecord(value)) throw new ApiError('parse', 'Backend backtest response has an unexpected shape.');
      const daily = records(value.daily_results);
      return {
        available: daily.length > 0,
        data_mode: dataMode,
        start_date: text(value.start_date),
        end_date: text(value.end_date),
        days_evaluated: num(value.days_evaluated) ?? 0,
        candidate_count: num(value.candidate_count) ?? 0,
        method: text(value.method) ?? 'Walk-forward diagnostics',
        liquidity_weighting_method: text(value.liquidity_weighting_method) ?? 'Unavailable',
        liquidity_weighting_note: text(value.liquidity_weighting_note) ?? 'Liquidity weighting is not available.',
        trading_performance_claimed: false,
        daily_results: daily.map((item) => ({
          data_date: text(item.data_date) ?? '',
          equal_weight_consensus: num(item.equal_weight_consensus),
          liquidity_weighted_consensus: num(item.liquidity_weighted_consensus),
          contracts_included: num(item.contracts_included) ?? 0,
          candidates: records(item.candidates).map((candidate) => ({
            symbol: text(candidate.symbol) ?? 'Unknown',
            z_score: num(candidate.z_score),
            residual_pct: num(candidate.residual_pct) ?? 0,
          })),
        })),
      };
    },
    dataStatus: mapDataStatus,
    imports: loadImports,
    createDemoData: async (): Promise<T.UploadResult> => {
      const value = await request('/api/v1/data/demo', undefined, { method: 'POST' });
      if (!isRecord(value)) {
        throw new ApiError('parse', 'Backend demo response is missing its import ID or status.');
      }
      const importId = text(value.import_id);
      const status = text(value.status);
      if (!importId || !status) throw new ApiError('parse', 'Backend demo response is missing its import ID or status.');
      return {
        import_id: importId,
        status,
        data_mode: 'synthetic',
        source_name: text(value.source_name),
        summary: isRecord(value.summary) ? value.summary : {},
        duplicate_upload: value.duplicate_upload === true,
      };
    },
    workflow: async (importId: string): Promise<T.WorkflowTriggerResponse> => {
      const value = await request(`/api/v1/workflows/imports/${encodeURIComponent(importId)}/run`, undefined, { method: 'POST' });
      if (!isRecord(value)) {
        throw new ApiError('parse', 'Backend workflow response is missing its submission details.');
      }
      const returnedId = text(value.import_id);
      const taskRunId = text(value.task_run_id);
      const taskSlug = text(value.task_slug);
      if (value.status !== 'submitted' || !returnedId || !taskRunId || !taskSlug) {
        throw new ApiError('parse', 'Backend workflow response is missing its submission details.');
      }
      return { status: 'submitted', import_id: returnedId, task_run_id: taskRunId, task_slug: taskSlug };
    },
    upload,
  };
}

export type ApiClient = ReturnType<typeof createClient>;

export const defaultBaseUrl: string = import.meta.env.VITE_API_BASE_URL ?? '';
export const defaultProxyTarget: string = import.meta.env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000';
