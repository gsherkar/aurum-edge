# AURUM EDGE – Frontend

React + TypeScript + Vite dashboard for explainable MCX gold futures intelligence. It uses a deterministic, bundled sample fixture by default, so it can be previewed without a backend. Fixture values are illustrative only: they are not current prices, official market data, contract specifications, or analysis outputs.

The optional backend adapter uses the registered routes documented in the root [API_CONTRACT.md](../API_CONTRACT.md) and the frontend's compatibility notes in [API_CONTRACT.md](./API_CONTRACT.md). The backend supports uploaded historical files and explicitly synthetic examples; it does not provide live MCX prices.

## Run locally
Prerequisites: Node.js 20.19+ (or 22.12+) and npm.

```powershell
Set-Location frontend
Copy-Item .env.example .env
npm ci
npm run dev
```
Vite prints the local preview URL; by default it is `http://localhost:5173`.
The default `VITE_DATA_SOURCE=sample` preview requires no backend. To intentionally use the backend, set `VITE_DATA_SOURCE=api` in `.env`, leave `VITE_API_BASE_URL` empty to use the Vite proxy, and start the backend separately in a second terminal. From the backend project root, follow its setup, then run its documented Uvicorn command, for example:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Verify `http://127.0.0.1:8000/health` responds before refreshing the dashboard. With `VITE_API_BASE_URL` empty, `/api` and `/health` are proxied to `VITE_DEV_PROXY_TARGET` (default `http://localhost:8000`). A local 502 means Vite could not reach its configured backend target; set `VITE_DEV_PROXY_TARGET` if the API is listening elsewhere. Restart Vite after editing `.env`.

## Scripts
- `npm run dev` — start local development preview.
- `npm run typecheck` — run strict TypeScript checks.
- `npm test` — run automated tests.
- `npm run build` — type-check and create production assets in `dist/`.
- `npm run preview` — serve the production build locally.

Linting is not configured in this project; there is no lint script.

## Environment variables
| Name | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Public backend base URL (no trailing slash). Baked in at build time. |
| `VITE_DEV_PROXY_TARGET` | Dev-server proxy target when the base URL is empty. |
| `VITE_DATA_SOURCE` | `sample` (default, no backend requests) or `api` (opt-in backend access). |

## Deploy to Render
The root `render.yaml` defines the static site alongside the API, Workflow service, and PostgreSQL database. Or create a **Static Site** manually:
- Root directory: `frontend` · Build command: `npm ci && npm run build` · Publish directory: `dist`
- Set `VITE_DATA_SOURCE=api` and `VITE_API_BASE_URL` to the actual public API URL (rebuild after changing them; do not set a localhost URL in production). The Blueprint sets API mode; supply the API URL when prompted or in the Render Dashboard.
- Rewrite `/*` → `/index.html`
- Set the backend's `CORS_ALLOWED_ORIGINS` to the exact static-site origin shown by Render (comma-separated if more than one origin is needed). Do not use `*`; the default local allowlist does not include the hosted site.

Deployment has not been verified from this environment.

## Structure
`src/api` typed client + types · `src/hooks` data loading · `src/sections` dashboard areas · `src/components` shared UI/chart wrapper · `src/lib` formatting and chart transforms.

## Behaviour notes
- Sample preview provides consistent deterministic prices, contracts, alerts, import history, and daily diagnostics; all are marked as static sample data and never represented as live.
- Upload, backend synthetic-data generation, and workflow submission are disabled in sample mode. They require opting into API mode.
- Missing values are `null` → shown as "Unavailable" (never 0); gaps in charts are not interpolated.
- In API mode, select the backend's `historical_file` or `synthetic` dataset. Synthetic backend data is labeled as a demonstration, never as live market data.
- Upload and synthetic-data actions call the backend directly. The frontend does not generate financial values.
- Workflow submission requires an existing import ID. The backend has no workflow-status endpoint, so the UI never claims that a submitted task completed successfully.
- Historical ranges are applied to returned observations; only the backend's supported backtest date bounds are sent to its analysis endpoint.
- Watchlists and price rules are stored in browser local storage. Rules are not monitored in the background and do not generate notifications.
