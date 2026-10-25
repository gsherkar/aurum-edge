# AURUM EDGE

Explainable cross-contract gold intelligence for MCX. This backend works without a market-data API key: upload a historical CSV/XLS/XLSX file that you obtained through permitted means, or run a clearly labelled synthetic demo. It does not scrape MCX, invent a data endpoint, or claim that an uploaded file is authentic.

## Local setup (Windows, Python 3.12)

```powershell
cd d:\hack_in_hills\aurum-edge
C:\Python312\python.exe -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The default database is the local SQLite file `aurum_edge.db`. Copy `.env.example` to `.env` to customize settings. Never commit `.env` or put secret values in source control.

## Start, import data, and test

Start the API:

```powershell
cd d:\hack_in_hills\aurum-edge
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` for the interactive API, or check `http://127.0.0.1:8000/health`.

Upload a historical file from a second PowerShell window (replace the example path with your downloaded file):

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/v1/data/files" -F "file=@D:\market-data\mcx-bhavcopy.csv"
```

The file needs a recognizable trade-date column, a contract-symbol column, and either a close or settlement-price column. A file without dates can use an explicit date:

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/v1/data/files?data_date=2026-10-23" -F "file=@D:\market-data\mcx-bhavcopy.csv"
```

CSV/TXT and XLS/XLSX are supported. The importer detects common column names. If the provider's headers differ, provide canonical field names mapped to their exact headers using the `column_mapping` query parameter; supported canonical names are `symbol`, `date`, `expiry_date`, `open`, `high`, `low`, `close`, `settlement`, `volume`, `traded_value`, and `open_interest`. For example, URL-encode a JSON object such as `{"symbol":"Contract Code","date":"Trade Day","close":"Closing Price"}`. `symbol` and `close` (or `settlement`) are required, as is a date column or `data_date`.

The response includes an `import_id`, row counts, validation results, and provenance. Re-uploading identical file bytes under the same name is idempotent. Rows missing essential information or containing invalid prices are skipped with row-level reasons. Uploaded data is marked `historical_file`; its source is recorded as a manual upload, but the service cannot verify the file's origin.

Try the separately labelled synthetic fixture:

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/v1/data/demo"
```

Test the backend:

```powershell
cd d:\hack_in_hills\aurum-edge
.\.venv\Scripts\python.exe -m pytest -q tests
```

## Contract specifications and normalization

No MCX contract terms are pre-populated as verified. This is intentional: the official MCX pages could not be retrieved by this environment during implementation, so symbol availability, contract quantities, quotation units, purity, delivery terms, expiry, and settlement details have not been asserted.

Review the current MCX product/contract documents and the uploaded file first. Then register a versioned specification with `POST /api/v1/contracts`. Include the effective dates, contract quantity, quotation unit/basis, purity where documented, conversion factor, specification source, and status. Only specifications marked `verified` are used to normalize historical-file observations. The conversion formula is:

`normalized ₹/gram = raw quoted price / grams in the quoted unit × verified conversion factor`

The conversion factor must be supported by the exchange contract documents; the backend does not infer it from the symbol or purity. Expiry-specific specifications take precedence over a symbol-level specification. Contracts without a matching verified specification stay visible in imported observations but are excluded from normalized consensus and anomaly analysis. Synthetic specifications and symbols are isolated under `data_mode=synthetic`.

Reference documents (availability and access terms may change):

- [MCX data feed](https://www.mcxindia.com/technology/datafeed)
- [MCX gold products](https://www.mcxindia.com/products/bullion/gold)

## Dashboard API

The registered routes, request/response shapes, and implemented error responses
are documented in [API_CONTRACT.md](./API_CONTRACT.md). The running
`/openapi.json` is the authoritative generated route/schema listing.

- `GET /health` — API and database check
- `GET /api/v1/contracts` — registered contract specification versions
- `POST /api/v1/contracts` — register a versioned specification
- `POST /api/v1/data/files` — import a historical CSV/XLS/XLSX file
- `POST /api/v1/data/demo` — generate synthetic sample observations
- `GET /api/v1/data/imports` — import status, provenance, and summaries
- `GET /api/v1/market/observations` — persisted source observations
- `GET /api/v1/market/summary` — separate `historical_file` and `synthetic` snapshots, with data date, source, last update, freshness, and normalized consensus
- `GET /api/v1/alerts` — explainable research alerts and individual guard results
- `GET /api/v1/analysis/backtest` — walk-forward diagnostic signals without a trading-return claim

Synthetic and historical-file observations are never combined in one consensus. The stale-data setting defaults to five calendar days; liquidity, expiry, and historical z-score thresholds are configurable in `.env`.

GET endpoints read persisted normalized observations and analysis results; normalization refreshes and persistence happen during explicit import/analysis or workflow operations. The volume-weighted consensus is labelled experimental because the observation data does not record the source volume unit or a contract-size adjustment. It should not be interpreted as comparable liquidity weighting across differently sized contracts.

## Render deployment

### FastAPI and PostgreSQL

Push the project to your Git provider, create a Render Blueprint from the repository, and apply [render.yaml](./render.yaml). It defines the web API and a PostgreSQL database. Check current Render plan availability/pricing before provisioning; the sample uses the free plan where available. Set production configuration/secrets in the Render Dashboard, not in Git.

### Render Workflows (separate service)

This repo defines nine actual tasks with Render's Python SDK in `app/workflow.py`; each task executes its stage and chains to the next task using `TaskContext.run`. The registered chain is:

1. `ingest_market_data`
2. `validate_market_data`
3. `persist_market_data`
4. `normalize_contracts`
5. `calculate_consensus`
6. `detect_anomalies`
7. `apply_risk_guards`
8. `persist_analysis_results`
9. `produce_run_summary`

Render's current Workflows setup is created as a Workflow service from the Dashboard (not as a normal FastAPI web service). In Render, choose **New > Workflow**, connect this repository and branch, select Python 3, set the build command to `pip install -r requirements.txt`, and set the start command to:

```text
render-workflows app.workflow:workflow
```

Deploy the Workflow service to register its tasks. Configure it in the same region as the PostgreSQL database and give it the same `DATABASE_URL` environment value as the web service. This is needed because tasks run on separate instances and the uploaded file and task state are stored in PostgreSQL. The repo's Blueprint describes the API and database; Workflow creation and task registration are a separate Render Dashboard action per the current Workflows documentation.

Each task uses the Render SDK's documented default retry policy (up to three retries after the initial attempt). When a task raises an exception while its code is running, the wrapper records the import batch as `failed` and re-raises the error so Render can retry it; a safe error summary is available from the import-status endpoint, while unexpected exception details remain in the Workflow task logs. A process termination or infrastructure timeout may prevent the wrapper from recording a failure, leaving the batch at its last persisted stage even though Render marks the run failed. Stages commit independently, so a failed run can leave earlier stage results persisted. The stage operations are designed to be repeatable, and a successful final stage changes the batch to `completed` and clears a prior retry error. This is not a single all-or-nothing database transaction.

To execute the chain from Render, upload/import a file and copy its `import_id`. In the Workflow Dashboard, open the `ingest_market_data` task, click **Start Task**, and enter the input arguments as the JSON array `["<import_id>"]`. The task chains through the remaining stages.

To have the web API submit each new file upload automatically, set the optional `RENDER_API_KEY` secret on the web service and configure `RENDER_WORKFLOW_TASK_SLUG` to the exact task slug shown in the Dashboard (the format is `workflow-slug/ingest_market_data`). Without these values, uploads process locally and synchronously. You can manually submit/re-submit a task from the API with:

```powershell
curl.exe -X POST "https://<your-api-host>/api/v1/workflows/imports/<import_id>/run"
```

`RENDER_API_KEY` is a Render account key used only to submit workflow tasks; it is not an MCX or market-data key. It is optional; local import and analysis work without it.

For local use, `POST /api/v1/data/files` and `POST /api/v1/data/demo` run the same nine-stage pipeline synchronously without a Render account. The Render task chain itself has not been deployed or run from this development environment.

The Blueprint currently selects free plans where Render offers them. Treat this as a demonstration configuration, not production persistence: verify current Render pricing, free-resource limits, and PostgreSQL retention before provisioning. Free Render Postgres databases expire after 30 days, and free web services have an ephemeral filesystem, so do not use them for data that must be retained. Workflow task compute and retained task state are separately billable; check the [current Workflows pricing and limits](https://render.com/docs/workflows-limits) before registering tasks or triggering runs. Choose persistent resources only after authorizing their cost.

## Method and limitations

The walk-forward analyzer computes each day's equal-weighted and volume-weighted consensus, residuals, and a per-contract historical z-score from prior observations only. Anomaly candidates require a configured minimum history. Separate risk guards check data quality, minimum daily volume, expiry proximity/unknown expiry, and snapshot freshness. An alert is a research explanation, not a trade instruction or evidence of profitable arbitrage.

This project does not provide live prices, authenticate MCX files, assert permission to redistribute data, or claim that an MCX endpoint/API is available. Check MCX terms and obtain/download files only through permitted channels.
