# AURUM EDGE API Contract

This contract reflects the FastAPI routes registered in `app/main.py` and the
OpenAPI schema served at `/openapi.json`. It documents implemented behavior,
not guessed route aliases. Dates and timestamps in JSON responses use ISO 8601
serialization. Unless otherwise noted, validation errors use FastAPI's
`{"detail": [...]}` response with HTTP 422.

## Routes

### `GET /`

- **Purpose:** Basic service identity/status.
- **Request:** No parameters or body.
- **200 response:** `{"service": string, "status": string}`.
- **Errors:** An unexpected server error may return HTTP 500; its body is not
  defined by this handler.

### `GET /health`

- **Purpose:** Check API and database connectivity (`SELECT 1`).
- **Request:** No parameters or body.
- **200 response:** `{"status": "ok", "app": string, "database": "connected"}`.
- **Errors:** Database exceptions are not translated by the handler; HTTP 500
  response details are not standardized here.

### `GET /api/v1/contracts`

- **Purpose:** List registered versioned contract specifications.
- **Query parameters:**
  - `data_mode` (optional): `historical_file` or `synthetic`.
- **200 response:** Array of contract specification objects:
  `id`, `symbol`, `data_mode`, `contract_quantity`, `quotation_unit`,
  `quotation_basis`, `purity`, `conversion_factor`, `delivery_location`,
  `effective_start`, `effective_end`, `expiry_date`, `settlement_info`,
  `specification_source`, `verification_status`, `created_at`, and
  `updated_at`.
- **Errors:** Invalid `data_mode` returns HTTP 422.

### `POST /api/v1/contracts`

- **Purpose:** Register a contract specification.
- **Request body (`application/json`):**
  - Required: `symbol` (string), `contract_quantity` (positive number),
    `quotation_unit` (string), `quotation_basis` (string),
    `conversion_factor` (positive number), `effective_start` (date),
    `specification_source` (string).
  - Optional: `data_mode` (`historical_file` or `synthetic`, default
    `historical_file`), `purity` (number greater than 0 and at most 1),
    `delivery_location` (string or null), `effective_end` (date or null),
    `expiry_date` (date or null), `settlement_info` (string or null), and
    `verification_status` (`verified`, `unverified`, or `demo-only`, default
    `unverified`).
  - Synthetic specifications must use `demo-only`; historical-file
    specifications cannot use `demo-only`; `effective_end` cannot precede
    `effective_start`. The symbol is uppercased.
- **201 response:** Contract specification object as described for
  `GET /api/v1/contracts`.
- **Errors:** HTTP 409 for a duplicate symbol/mode/effective-start/expiry
  version; HTTP 422 for schema or business-rule validation.

### `POST /api/v1/data/files`

- **Purpose:** Upload and process a historical market-data file.
- **Request content type:** `multipart/form-data`.
- **Request fields:**
  - `file` (required): CSV, TXT, XLS, or XLSX upload.
  - `data_date` (optional query date): fallback date when the file has no
    recognizable date column.
  - `column_mapping` (optional query string): JSON object mapping canonical
    field names to exact file header strings. Supported canonical names are
    `symbol`, `date`, `expiry_date`, `open`, `high`, `low`, `close`,
    `settlement`, `volume`, `traded_value`, and `open_interest`.
- **200 response:** On a newly completed local run:
  `import_id`, `status`, `source_name`, `data_mode`, `summary`,
  `duplicate_upload`, and `provenance_note`. A duplicate upload returns its
  existing `import_id`, `status`, `data_mode`, `source_name`, and `summary`,
  with `duplicate_upload: true`. If Render triggering is configured, the
  response instead includes `status`, `task_run_id`, and `task_slug`; the
  upload response variants depend on configuration and duplicate state.
- **Errors:** HTTP 400 for an empty file; 413 when the configured upload limit
  is exceeded; 415 for unsupported file types; 422 for invalid mapping or
  file/row validation failures. An unhandled workflow-client error is not
  assigned a custom response body by this handler.
- **Verification note:** The service records manual-upload provenance but does
  not authenticate that a file originated from MCX.

### `POST /api/v1/data/demo`

- **Purpose:** Generate or return the date-keyed synthetic demo import and run
  the local analysis pipeline.
- **Request:** No parameters or body.
- **200 response:** `import_id`, `status`, `data_mode: "synthetic"`,
  `duplicate_upload`, and `summary`.
- **Errors:** Pipeline exceptions are not given a route-specific error
  response by this handler.

### `GET /api/v1/data/imports`

- **Purpose:** List recent import batches and their persisted processing
  summaries.
- **Query parameters:** `limit` (integer, default 50, range 1–200).
- **200 response:** Array of objects with `import_id`, `file_name`,
  `source_name`, `data_mode`, `status`, `summary`, `error`, and `last_updated`.
- **Workflow failure behavior:** Exceptions raised while a task is running
  record the batch status as `"failed"` and a safe error summary before being
  re-raised. Unexpected exception details are available in Render task logs.
  Render retries failed task runs according to its configured policy; a later
  successful completion sets the batch status to `"completed"` and clears the
  prior error. A process termination or infrastructure timeout can prevent
  the batch update, leaving its last persisted status even if Render marks the
  run failed.
- **Errors:** Invalid `limit` returns HTTP 422.

### `GET /api/v1/market/observations`

- **Purpose:** Read persisted market observations.
- **Query parameters:**
  - `data_mode` (optional): `historical_file` or `synthetic`.
  - `symbol` (optional string; matched after uppercasing).
  - `limit` (integer, default 100, range 1–1000).
- **200 response:** Array of observation objects with `id`, `symbol`,
  `expiry_date`, `source_name`, `source_timestamp`, `fetched_at`, `data_date`,
  `data_mode`, `import_id`, `open`, `high`, `low`, `close`, `settlement`,
  `volume`, `traded_value`, `open_interest`, and `normalized_close`.
- **Errors:** Invalid `data_mode` or `limit` returns HTTP 422.

### `GET /api/v1/market/summary`

- **Purpose:** Summarize the latest persisted observation date separately for
  each data mode. Normalization and consensus use persisted normalized prices;
  this GET request does not refresh or persist them.
- **Request:** No parameters or body.
- **200 response:** `{"data_sets": [...]}`. Each data-set object contains
  `data_mode`, `source_name`, `data_date`, `last_updated`, `freshness`,
  `contracts`, `contracts_excluded_from_consensus`, `consensus`,
  `normalization_note`, `liquidity_weighting_method`, and
  `liquidity_weighting_note`. Each contract contains `symbol`, `expiry_date`,
  `close`, `settlement`, `normalized_price_per_gram`, and `volume`.
  `consensus` contains `equal_weight_consensus`,
  `liquidity_weighted_consensus`, `market_n`, `liquidity_weighting_method`,
  and `liquidity_weighting_note`. If there are no observations, the response is
  `{"data_sets": []}`.
- **Errors:** Unexpected database errors are not translated by this handler.

### `GET /api/v1/alerts`

- **Purpose:** Read persisted anomaly alerts that still have a matching
  observation with a persisted normalized price. This GET request does not
  refresh or persist observations.
- **Query parameters:**
  - `data_mode` (optional): `historical_file` or `synthetic`.
  - `limit` (integer, default 100, range 1–500).
- **200 response:** Array of alert objects with `id`, `import_id`, `data_mode`,
  `symbol`, `data_date`, `consensus_price_per_gram`,
  `normalized_price_per_gram`, `residual_pct`, `historical_z_score`,
  `liquidity_volume`, `guards` (`liquidity`, `expiry`, `stale_data`,
  `data_quality` booleans), `anomaly_band`, `explanation`, `created_at`, and
  `notice`. An empty alert set returns `[]`.
- **Errors:** Invalid `data_mode` or `limit` returns HTTP 422.

### `GET /api/v1/analysis/backtest`

- **Purpose:** Calculate a read-only walk-forward diagnostic report from
  persisted observations with normalized prices. It does not persist refreshed
  normalization or analysis results.
- **Query parameters:**
  - `data_mode` (`historical_file` or `synthetic`, default `historical_file`).
  - `start_date` (optional date).
  - `end_date` (optional date).
- **200 response:** Object with `method`, `liquidity_weighting_method`,
  `liquidity_weighting_note`, `start_date`, `end_date`, `days_evaluated`,
  `candidate_count`, `trading_performance_claimed`, and `daily_results`.
  Daily result details are the walk-forward calculation output; see
  `app/engine.py` or `/openapi.json` for the current structure. With no
  eligible observations, the dates are null, the counts are zero, and
  `daily_results` is `[]`.
- **Errors:** HTTP 422 if `start_date` is after `end_date`, or if a query date
  is invalid.

### `POST /api/v1/workflows/imports/{import_id}/run`

- **Purpose:** Submit a Render Workflows run for an existing import batch.
- **Path parameter:** `import_id` (string).
- **Request:** No body or query parameters.
- **202 response:** `status: "submitted"`, `import_id`, `task_run_id`, and
  `task_slug`.
- **Submission behavior:** The SDK receives the positional argument list
  `[import_id]` and the idempotency key `aurum-edge-{import_id}`. Repeating
  the same submission with that key within 24 hours returns the original task
  run instead of creating a second one; use the Render Dashboard to
  intentionally start a replacement run during that window.
- **Errors:** HTTP 404 when the import batch does not exist; HTTP 503 when
  `RENDER_API_KEY` or `RENDER_WORKFLOW_TASK_SLUG` is missing. Other Render SDK
  failures are not translated by this handler.

## FastAPI documentation endpoints

These framework-provided GET routes are registered by FastAPI but are not
included in the application's OpenAPI `paths` collection:

| Method | Path | Purpose | Response |
| --- | --- | --- | --- |
| GET | `/docs` | Swagger UI | HTML documentation interface |
| GET | `/redoc` | ReDoc UI | HTML documentation interface |
| GET | `/openapi.json` | Generated OpenAPI contract | OpenAPI JSON document |
| GET | `/docs/oauth2-redirect` | Swagger UI OAuth callback | Framework-generated HTML |

## Read/write behavior and data limitations

All `GET` routes are intended to be read-only. The summary and alert endpoints
report persisted normalization/alert state; they do not apply newly changed
contract specifications until an explicit analysis or workflow operation
refreshes and persists normalization. The backtest computes its response in
memory from persisted normalized observations.

The observation schema stores `volume` as a nullable number without its source
unit or quantity basis. Consequently, the API labels the existing
volume-weighted consensus as `experimental_raw_volume`; it is not established
as comparable across differently sized contracts. Do not interpret it as a
verified liquidity measure. The equal-weighted consensus is also returned.

For the authoritative route and generated schema list, use `/openapi.json` on
the running application. Request/response details for dynamically assembled
dictionary fields should be verified against that schema and implementation
when those structures change.
