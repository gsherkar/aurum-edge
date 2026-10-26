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

### Free Render API and Neon PostgreSQL

The [Render Blueprint](./render.yaml) provisions only a free FastAPI web service and free static frontend. It intentionally does not provision a database or Workflow service. Render's free Postgres expires after 30 days, and Workflow task compute and retained task state are billed separately. The API runs imports synchronously when `RENDER_API_KEY` and `RENDER_WORKFLOW_TASK_SLUG` are not configured, so neither is required for this prototype.

For a no-charge prototype deployment, use Render Free for the API and static site and Neon Free for PostgreSQL. Neon currently describes its Free plan as permanent and not requiring a credit card; it includes 100 CU-hours and 1 GB of database storage per project, 5 GB public data transfer, and scales compute to zero after five idle minutes. Provider limits and plan terms can change; review the current [Render free-instance limits](https://render.com/docs/free), [Render Workflow pricing](https://render.com/docs/workflows-limits), and [Neon plans](https://neon.com/docs/introduction/plans) before creating resources.

#### Dashboard deployment

1. In Render, create a Blueprint from `gsherkar/aurum-edge` on the `main` branch and review that it will create only `aurum-edge-api` (Free web service) and `aurum-edge-frontend` (static site). Do not add a paid service or Workflow.
2. In Neon, create a Free PostgreSQL project. Copy its connection string directly from the Neon dashboard into the Render API's `DATABASE_URL` environment variable before the first API deploy. Do not put the URL in this repository or a local `.env` file.
3. Set the API's `CORS_ALLOWED_ORIGINS` to the exact frontend origin assigned by Render (for example, `https://<frontend-host>.onrender.com`, with no trailing slash). The API health check is `GET /health`.
4. Set the static site's build-time variables to `VITE_DATA_SOURCE=api` and `VITE_API_BASE_URL` equal to the API's public origin (for example, `https://<api-host>.onrender.com`, with no trailing slash). Redeploy the static site after changing either value.
5. If a service is deployed before the other one's public URL is known, update the corresponding variable after the URL is assigned and redeploy the affected service. Configure `DATABASE_URL` before the first API deploy; production startup fails if it is missing or does not identify PostgreSQL.
6. Use a new, empty Neon database for this deployment. Startup creates missing tables with SQLAlchemy `create_all`; the additional schema migrations in this project are SQLite-only, so existing PostgreSQL schemas are not upgraded automatically.
7. Once both services deploy, initialize only the new hosted database with the clearly labelled synthetic dataset using `POST /api/v1/data/demo`. Verify `GET /health`, `GET /api/v1/contracts?data_mode=synthetic`, `GET /api/v1/market/observations?data_mode=synthetic`, `GET /api/v1/market/summary`, `GET /api/v1/alerts?data_mode=synthetic`, and `GET /api/v1/analysis/backtest?data_mode=synthetic`. This is illustrative data, not live MCX data.

The Blueprint sets `APP_ENV=production` and asks for `DATABASE_URL`, `CORS_ALLOWED_ORIGINS`, and `VITE_API_BASE_URL` in the provider dashboard; `VITE_DATA_SOURCE=api` is preset. The API rejects SQLite or a missing/non-PostgreSQL database URL in production, rather than silently using its local SQLite default. Never commit database URLs or provider credentials. The Render free API may sleep after 15 minutes without traffic, take about a minute to wake, and has an ephemeral filesystem. Its free instance hours are shared across the workspace. Neon Free is limited to 100 CU-hours, 1 GB storage, and 5 GB public data transfer per project and scales to zero after five minutes idle. Recheck provider limits before deployment.

This prototype does not authenticate its write endpoints: contract creation, demo generation, file uploads, and workflow triggering are publicly callable. CORS is not authentication. Keep the hosted database limited to synthetic demo data and add access controls/rate limits before using the service for sensitive or broader public workloads.

### Optional Render Workflows (billed)

Workflows are not included in the free Blueprint; use the following only if you deliberately choose the separately billed service. The [Blueprint specification](https://render.com/docs/blueprint-spec) supports `type: workflow`, but this project's Blueprint omits it. To configure one separately, choose **New > Workflow**, connect this repository's `main` branch, select Python 3 and Oregon, set the build command to `pip install -r requirements.txt`, and set the start command to:

```text
render-workflows app.workflow:workflow
```

Deploy the Workflow service to register its tasks. Configure the same PostgreSQL `DATABASE_URL` on both services. The Workflow SDK needs Render-provided `RENDER_SDK_MODE` and `RENDER_SDK_SOCKET_PATH` values at runtime; do not set these manually. The `render-workflows` start command invokes `workflow.start()` to register and run the defined tasks.

Each task uses the Render SDK's documented default retry policy (up to three retries after the initial attempt). When a task raises an exception while its code is running, the wrapper records the import batch as `failed` and re-raises the error so Render can retry it; a safe error summary is available from the import-status endpoint, while unexpected exception details remain in the Workflow task logs. A process termination or infrastructure timeout may prevent the wrapper from recording a failure, leaving the batch at its last persisted stage even though Render marks the run failed. Stages commit independently, so a failed run can leave earlier stage results persisted. The stage operations are designed to be repeatable, and a successful final stage changes the batch to `completed` and clears a prior retry error. This is not a single all-or-nothing database transaction.

To execute a first hosted infrastructure test using synthetic data:

1. Wait for the API, external PostgreSQL, and Workflow resources to finish deploying. The Workflow service should list all nine tasks.
2. Call `POST /api/v1/data/demo` on the deployed API and copy its returned `import_id`. This creates clearly labelled synthetic rows in the shared PostgreSQL database and runs the API's local pipeline once.
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

Render bills Workflow task runs by compute time and retained state. As of this documentation check, the default Flex plan is billed at $0.20 per CPU-hour and $0.05 per GB-hour, and task state retention costs $0.25 per GB for 30 days. A nine-stage run launches multiple task runs, so total cost depends on runtime, resources, and result sizes. Check the [current Workflows pricing and limits](https://render.com/docs/workflows-limits) before enabling it. This repository has not created a hosted service or run.

## Method and limitations

The walk-forward analyzer computes each day's equal-weighted and volume-weighted consensus, residuals, and a per-contract historical z-score from prior observations only. Anomaly candidates require a configured minimum history. Separate risk guards check data quality, minimum daily volume, expiry proximity/unknown expiry, and snapshot freshness. An alert is a research explanation, not a trade instruction or evidence of profitable arbitrage.

This project does not provide live prices, authenticate MCX files, assert permission to redistribute data, or claim that an MCX endpoint/API is available. Check MCX terms and obtain/download files only through permitted channels.
