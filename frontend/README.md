# AURUM EDGE – Frontend

React + TypeScript + Vite dashboard for explainable MCX gold futures intelligence. It renders data returned by the backend
(see [API_CONTRACT.proposed.md](./API_CONTRACT.proposed.md)); it never fabricates market values or simulates workflow runs. The current backend uses uploaded files and explicitly synthetic fixtures; it does not provide live MCX prices.

## Run locally
```bash
cd frontend
cp .env.example .env         # leave VITE_API_BASE_URL empty to use the local proxy
npm install
npm run dev                 # http://localhost:5173
```
Start the backend separately in a second terminal, using its own checkout of the backend branch. From the backend project root, follow its README setup, then run its documented Uvicorn command, for example:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Verify `http://127.0.0.1:8000/health` responds before refreshing the dashboard. With `VITE_API_BASE_URL` empty, `/api` and `/health` are proxied to `VITE_DEV_PROXY_TARGET` (default `http://localhost:8000`). A local 502 means Vite could not reach its configured backend target; set `VITE_DEV_PROXY_TARGET` if the API is listening elsewhere. Restart Vite after editing `.env`.

## Scripts
`npm run dev` · `npm run build` (typecheck + production build to `dist/`) · `npm test` · `npm run typecheck`

## Environment variables
| Name | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Public backend base URL (no trailing slash). Baked in at build time. |
| `VITE_DEV_PROXY_TARGET` | Dev-server proxy target when the base URL is empty. |

## Deploy to Render (static site)
The root `render.yaml` defines it. Or create a **Static Site** manually:
- Root directory: `frontend` · Build command: `npm ci && npm run build` · Publish directory: `dist`
- Env var: `VITE_API_BASE_URL=https://<your-backend>.onrender.com` (rebuild after changing it)
- Rewrite `/*` → `/index.html`
- **CORS/proxy:** the inspected backend does not configure CORS. A hosted frontend needs a backend CORS allowlist or a same-origin proxy.

Deployment has not been verified from this environment.

## Structure
`src/api` typed client + types · `src/hooks` data loading · `src/sections` dashboard areas · `src/components` shared UI/chart wrapper · `src/lib` formatting and chart transforms.

## Behaviour notes
- Missing values are `null` → shown as "Unavailable" (never 0); gaps in charts are not interpolated.
- Select the backend's `historical_file` or `synthetic` dataset. Synthetic data is labeled as a demonstration, never as live market data.
- Upload and synthetic-data actions call the backend directly. The frontend does not generate financial values.
- Workflow submission requires an existing import ID. The backend has no workflow-status endpoint, so the UI never claims that a submitted task completed successfully.
- Historical ranges are applied to returned observations; only the backend's supported backtest date bounds are sent to its analysis endpoint.
- Watchlists and price rules are stored in browser local storage. Rules are not monitored in the background and do not generate notifications.
