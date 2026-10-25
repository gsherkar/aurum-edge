export type BackendDataMode = 'historical_file' | 'synthetic';
export type DataMode = BackendDataMode | 'unknown';

export interface Health { status: string; app?: string; database?: string }

export interface Overview {
  last_updated: string | null;
  market_data_date: string | null;
  data_source: string | null;
  data_mode: DataMode;
  freshness: { status: 'fresh' | 'stale' | 'unknown'; age_hours: number | null };
  eligible_contracts: number | null;
  alert_count: number | null;
  latest_workflow: null;
}

export interface Contract {
  symbol: string;
  expiry: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  quotation_basis: string | null;
  purity: number | null;
  delivery_location: string | null;
  spec_status: 'verified' | 'unverified' | 'unavailable' | 'demo-only';
  eligible: boolean | null;
}
export interface ContractsResponse { data_mode: DataMode; contracts: Contract[] }

export interface HistoryPoint { date: string; normalized_price: number | null; raw_price: number | null }
export interface HistorySeries { symbol: string; points: HistoryPoint[] }
export interface HistoryResponse {
  data_mode: DataMode; source: string | null; unit: string; raw_unit_note: string | null; series: HistorySeries[];
}

export interface ConsensusContract {
  symbol: string; normalized_price: number | null; residual_abs: number | null;
  residual_pct: number | null; zscore: number | null; weight: number | null;
}
export interface ConsensusResponse {
  data_mode: DataMode; as_of: string | null; unit: string;
  method: { name: 'equal_weighted' | 'liquidity_weighted'; description: string };
  consensus_price: number | null;
  contracts: ConsensusContract[];
  history: { date: string; consensus_price: number | null }[];
}

export interface CostAdjusted {
  valid: boolean; net_edge_inr_per_gram: number | null; assumptions: string[];
}
export interface Signal {
  id: string; symbol: string; expiry: string | null;
  normalized_price: number | null; consensus_price: number | null;
  residual_abs: number | null; residual_pct: number | null; zscore: number | null;
  severity: 'info' | 'watch' | 'alert' | 'guarded';
  anomaly_band: string;
  liquidity_status: 'passed' | 'not_passed' | 'unknown';
  expiry_warning: string | null;
  data_quality_warnings: string[];
  explanation: string;
  cost_adjusted: null;
}
export interface SignalsResponse { data_mode: DataMode; as_of: string | null; signals: Signal[] }

export interface BacktestDay {
  data_date: string;
  equal_weight_consensus: number | null;
  liquidity_weighted_consensus: number | null;
  contracts_included: number;
  candidates: { symbol: string; z_score: number | null; residual_pct: number }[];
}
export interface BacktestSummary {
  available: boolean;
  data_mode: DataMode;
  start_date: string | null;
  end_date: string | null;
  days_evaluated: number;
  candidate_count: number;
  method: string;
  liquidity_weighting_method: string;
  liquidity_weighting_note: string;
  trading_performance_claimed: false;
  daily_results: BacktestDay[];
}

export interface ImportSummary {
  total_rows?: number;
  valid_rows?: number;
  records_skipped?: number;
  parse_invalid_rows?: unknown[];
  validation_invalid_rows?: unknown[];
  [key: string]: unknown;
}
export interface ImportBatch {
  import_id: string;
  file_name: string;
  source_name: string;
  data_mode: BackendDataMode;
  status: string;
  summary: ImportSummary;
  error: string | null;
  last_updated: string | null;
}
export interface DataStatus {
  data_mode: DataMode;
  latest_data_date: string | null;
  source: string | null;
  last_import_at: string | null;
  validation_status: 'valid' | 'warnings' | 'invalid' | 'unknown';
  records_imported: number | null;
  warnings: string[];
  upload_supported: boolean;
  imports: ImportBatch[];
}
export interface UploadResult {
  import_id: string;
  status: string;
  data_mode: BackendDataMode;
  source_name: string | null;
  summary: ImportSummary;
  duplicate_upload: boolean;
  task_run_id?: string;
  task_slug?: string;
  provenance_note?: string;
}

export interface WorkflowTriggerResponse {
  status: 'submitted';
  import_id: string;
  task_run_id: string;
  task_slug: string;
}
