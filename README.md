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

The synthetic fixture contains four illustrative demo contracts:
`DEMO_GOLD_100G` (100 grams), `DEMO_GOLD_10G` (10 grams),
`DEMO_GOLD_8G` (8 grams), and `DEMO_GOLD_1G` (1 gram). Their generated
specifications are marked `demo-only`; they are not verified official MCX
contracts or live market data.

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

Create a Render Blueprint from the branch you intend to deploy and review the proposed resources before applying [render.yaml](./render.yaml). It defines the web API, static frontend, PostgreSQL database, and Workflow service. The frontend build needs `VITE_API_BASE_URL` set to the API's public URL. After Render assigns the frontend URL, set the API's `CORS_ALLOWED_ORIGINS` to that exact origin (without a trailing slash); the checked-in default only permits local Vite origins. Check current Render plan availability/pricing before provisioning; the API and database currently use the free plan where available, while Workflow task runs are billed separately. Set production configuration/secrets in the Render Dashboard, not in Git.

### Render Workflows

This repo defines nine actual tasks with Render's [Python SDK](https://render.com/docs/workflows-sdk-python) in `app/workflow.py`; each task executes its stage and chains to the next task using `TaskContext.run`. The registered chain is:

1. `ingest_market_data`
2. `validate_market_data`
3. `persist_market_data`
4. `normalize_contracts`
5. `calculate_consensus`
6. `detect_anomalies`
7. `apply_risk_guards`
8. `persist_analysis_results`
9. `produce_run_summary`

The [current Blueprint specification](https://render.com/docs/blueprint-spec) supports `type: workflow`; `render.yaml` now defines the API, PostgreSQL, and Workflow resources together. Create or sync the Blueprint from the `feature/quant-engine` branch, inspect all three proposed resources before applying it, and confirm they are in Oregon. If you configure the Workflow separately from the Blueprint instead, choose **New > Workflow**, connect this repository and branch, select Python 3 and Oregon, set the build command to `pip install -r requirements.txt`, and set the start command to:

```text
render-workflows app.workflow:workflow
```

Deploy the Workflow service to register its tasks. The Blueprint gives the API and Workflow service the same `DATABASE_URL` reference to `aurum-edge-db`, and sets the web, Workflow, and database regions to Oregon so they can communicate over Render's private network. The Workflow SDK needs Render-provided `RENDER_SDK_MODE` and `RENDER_SDK_SOCKET_PATH` values at runtime; do not set these manually. The `render-workflows` start command invokes `workflow.start()` to register and run the defined tasks.

Each task uses the Render SDK's documented default retry policy (up to three retries after the initial attempt). When a task raises an exception while its code is running, the wrapper records the import batch as `failed` and re-raises the error so Render can retry it; a safe error summary is available from the import-status endpoint, while unexpected exception details remain in the Workflow task logs. A process termination or infrastructure timeout may prevent the wrapper from recording a failure, leaving the batch at its last persisted stage even though Render marks the run failed. Stages commit independently, so a failed run can leave earlier stage results persisted. The stage operations are designed to be repeatable, and a successful final stage changes the batch to `completed` and clears a prior retry error. This is not a single all-or-nothing database transaction.

To execute a first hosted infrastructure test using synthetic data:

1. Wait for the API, PostgreSQL, and Workflow resources to finish deploying. The Workflow service should list all nine tasks.
2. Call `POST /api/v1/data/demo` on the deployed API and copy its returned `import_id` (for example, `synthetic-demo-2026-10-25`). This creates clearly labelled synthetic rows in the shared PostgreSQL database and runs the API's local pipeline once.
3. In the Render Workflow Dashboard, open the `ingest_market_data` task, click **Start Task**, and enter the JSON input array `["<import_id>"]`, replacing the placeholder with the returned ID. The `import_id` is the only task argument; chained tasks pass it forward automatically.
4. Watch the root task and its chained runs in the Workflow Dashboard. Check each run's status and logs. On success, the final `produce_run_summary` result should contain `"status": "completed"`.
5. Verify persisted output through the deployed API: `GET /api/v1/data/imports?limit=20` should show the batch as `completed`; `GET /api/v1/market/observations?data_mode=synthetic&limit=10` should return normalized observations; and `GET /api/v1/alerts?data_mode=synthetic` should show any persisted eligible alerts. Alert count can be zero if no candidates pass configured guards.
6. To verify analysis rows directly, use the database's SQL console or a trusted SQL client and run these read-only queries after replacing the placeholder with the returned ID:

```sql
SELECT id, status, data_mode, summary
FROM import_batches
WHERE id = '<import_id>';

SELECT COUNT(*) AS normalized_observations
FROM market_observations
WHERE import_id = '<import_id>' AND normalized_close IS NOT NULL;

SELECT COUNT(*) AS analysis_days
FROM analysis_results
WHERE import_id = '<import_id>';

SELECT COUNT(*) AS persisted_alerts
FROM market_alerts
WHERE import_id = '<import_id>';
```

Do not expose the database URL in a shared terminal, screenshot, log, or commit.

This test deliberately runs only synthetic data. It does not verify MCX specifications or market-data correctness. To run a chain on a manual historical-file import instead, upload the file through `POST /api/v1/data/files`, then start the same root task with its returned import ID.

The task slugs follow `{workflow-slug}/{task-name}`. With the Blueprint service name, the expected root slug is `aurum-edge-workflows/ingest_market_data`; confirm the exact workflow slug on the task page in Render. The other task slugs use the same workflow prefix with these names: `validate_market_data`, `persist_market_data`, `normalize_contracts`, `calculate_consensus`, `detect_anomalies`, `apply_risk_guards`, `persist_analysis_results`, and `produce_run_summary`.

To have the API submit runs, set the optional `RENDER_API_KEY` secret and `RENDER_WORKFLOW_TASK_SLUG=aurum-edge-workflows/ingest_market_data` on the web service. Without these values, uploads process locally and synchronously; dashboard-triggered Workflow runs do not need an API key. The API submits the positional input `[import_id]` and uses `aurum-edge-{import_id}` as its idempotency key. Render's SDK treats repeated calls with that key within 24 hours as the same run, preventing accidental duplicate submissions; to deliberately retry a failed run during that window, start a new task run from the Dashboard. To request an API submission, use:

```powershell
curl.exe -X POST "https://<your-api-host>/api/v1/workflows/imports/<import_id>/run"
```

`RENDER_API_KEY` is a Render account key used only to submit workflow tasks; it is not an MCX or market-data key. It is optional; local import and analysis work without it.

For local use, `POST /api/v1/data/files` and `POST /api/v1/data/demo` run the same nine-stage pipeline synchronously without a Render account. A failed task records the import batch as `failed` when application code can catch the exception and re-raises it for Render's retry policy; an abrupt process/infrastructure failure may leave the last persisted batch status unchanged. Each stage commits independently, so earlier work can remain persisted after a later stage fails. Re-running a workflow stage is designed to be idempotent for the same import, but the workflow is not an all-or-nothing database transaction. No hosted deployment or workflow run has been performed from this development environment.

The Blueprint currently selects free plans where Render offers them for the API and database. Treat this as a demonstration configuration, not production persistence: verify current Render pricing, free-resource limits, and PostgreSQL retention before provisioning. Free Render Postgres databases expire after 30 days, and free web services have an ephemeral filesystem, so do not use them for data that must be retained. Workflow task compute is billed separately on the default Flex plan, based on actual CPU and RAM use (currently $0.20 per CPU-hour and $0.05 per GB-hour, up to $0.40/hour at the 1 CPU/4 GB limit); retained task state is $0.25/GB for 30 days. A nine-stage run launches multiple task runs, so its cost depends on each task's runtime/resource use and returned state. Check the [current Workflows pricing and limits](https://render.com/docs/workflows-limits) and confirm the advertised $50 credit is active and applies to Workflow charges before triggering runs. Choose persistent resources only after authorizing their cost.

## Method and limitations

The walk-forward analyzer computes each day's equal-weighted and volume-weighted consensus, residuals, and a per-contract historical z-score from prior observations only. Anomaly candidates require a configured minimum history. Separate risk guards check data quality, minimum daily volume, expiry proximity/unknown expiry, and snapshot freshness. An alert is a research explanation, not a trade instruction or evidence of profitable arbitrage.

This project does not provide live prices, authenticate MCX files, assert permission to redistribute data, or claim that an MCX endpoint/API is available. Check MCX terms and obtain/download files only through permitted channels.
