# AURUM EDGE frontend API compatibility

The browser client in `src/api/client.ts` maps the registered backend payloads into the frontend's display models. The root [API_CONTRACT.md](../API_CONTRACT.md) remains authoritative for backend routes and response schemas.

## Configuration

- All endpoints are relative to the backend origin (or `VITE_API_BASE_URL`).
- Local Vite development proxies `/api` and `/health` to `VITE_DEV_PROXY_TARGET`, which defaults to `http://localhost:8000`.
- The backend's `CORS_ALLOWED_ORIGINS` setting is a comma-separated exact-origin allowlist. Local defaults include Vite's `localhost:5173` and `127.0.0.1:5173`; for a hosted frontend, configure its exact Render origin on the backend. Wildcard origins are not used.
- `data_mode` is `historical_file` or `synthetic`. It is passed to contracts, observations, alerts, and backtest requests where supported. The summary contains datasets for each mode.
- Uploaded files and backend-generated synthetic examples are the supported data sources. This backend does not fetch real-time MCX prices; synthetic values are labeled as such.

## Backend endpoints used by this frontend

| Method and path | Request | Backend response / frontend behavior |
|---|---|---|
| `GET /health` | — | `{status, app, database}` |
| `GET /api/v1/contracts` | `data_mode=historical_file\|synthetic` | Array of contract specification records. The frontend maps the backend's `contract_quantity`, `quotation_unit`, `verification_status`, and related fields. Eligibility is not provided and is displayed as unavailable. |
| `GET /api/v1/market/observations` | `data_mode`, optional single `symbol`, `limit` (up to 1000) | Array of observations. The frontend groups and sorts by symbol/date for charting; normalized values and raw close/settlement values remain separate. |
| `GET /api/v1/market/summary` | — | `{data_sets:[{data_mode, source_name, data_date, last_updated, freshness, contracts, contracts_excluded_from_consensus, consensus, normalization_note, liquidity_weighting_method, liquidity_weighting_note}]}` |
| `GET /api/v1/alerts` | `data_mode`, `limit` | Array containing backend alert fields such as normalized/consensus price, residual, historical z-score, anomaly band, guards, and explanation. No cost-adjusted estimate is returned. |
| `GET /api/v1/analysis/backtest` | `data_mode`, optional `start_date`, `end_date` | Walk-forward diagnostics with method, date bounds, days evaluated, candidate count, `trading_performance_claimed: false`, and daily results. This is not a profitability/performance report. |
| `GET /api/v1/data/imports` | `limit` | Array of import batches with IDs, source, mode, status, summary, error, and timestamp. |
| `POST /api/v1/data/files` | Multipart `file`; optional `data_date` and `column_mapping` query parameters | Import result with `import_id`, `status`, `data_mode`, summary, duplicate flag, and possibly workflow metadata. Supported file types are CSV, TXT, XLS, XLSX. |
| `POST /api/v1/data/demo` | — | Creates/processes explicitly synthetic backend data and returns its import ID and summary. |
| `POST /api/v1/workflows/imports/{import_id}/run` | Existing backend import ID | `202 {status:"submitted", import_id, task_run_id, task_slug}`. Requires backend Render workflow configuration. |

Backend documentation is available at `/docs`, `/redoc`, and `/openapi.json` when the service is running.

## Known backend limitations

- No market-status or real-time feed endpoint exists. Freshness describes the imported dataset only; it does not indicate exchange status.
- No dedicated market-history, consensus, workflow-status, workflow-list, or generic `/data/status` endpoint exists. The frontend derives its display models from observations, summary, and imports.
- Workflow submission is supported, but there is no endpoint to poll task-run completion. The UI reports only an accepted submission and does not claim a workflow succeeded.
- `RENDER_API_KEY` and `RENDER_WORKFLOW_TASK_SLUG` must be configured on the backend for API-triggered Render runs. They must never be exposed to the browser.
- Uploaded-file provenance is recorded but the backend cannot independently authenticate the file's origin.
- Volume-weighted consensus is experimental and uses raw volume, whose units can vary by source. The frontend displays the weighting caveat and does not claim that it is a validated liquidity measure.
- The backend does not provide cost-adjusted returns, strategy precision, or evidence of profitability. These are intentionally absent from the UI.
