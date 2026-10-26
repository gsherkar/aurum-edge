# AURUM EDGE — Second-Round Three-Minute Pitch

## Opening and closing lines

**Opening:** “One gold price can mean four different things when the contracts behind it are not comparable.”

**Closing:** “AURUM EDGE makes those differences visible, so research can start with a clearer comparison—not an unverified trading promise.”

## Time-coded storyboard and spoken script

### 0:00–0:20 — The problem

**On screen:** Start at Overview, with the synthetic-data banner visible.

**Action:** Hold on the dashboard while introducing the challenge.

**Say:** “One gold price can mean four different things when the contracts behind it are not comparable. Different contract sizes, quote units, and expiries make cross-contract analysis difficult—and a raw price comparison can mislead.”

**Transition:** “AURUM EDGE is a research prototype built to make that comparison clearer.”

### 0:20–0:45 — What AURUM EDGE does

**On screen:** Overview, then briefly point out the connected backend and selected synthetic dataset.

**Action:** Keep the synthetic-data banner in view; do not hide or minimize it.

**Say:** “It brings contract metadata, observations, and analysis into one dashboard. The API and frontend are connected, and the results you’ll see today come from the backend’s synthetic demonstration pipeline—not a live MCX feed.”

**Transition:** Select **Contracts**.

### 0:45–1:20 — Contract sizes and normalization

**On screen:** Contracts table showing all four `DEMO_GOLD` entries.

**Action:** Point to identifiers and their displayed gram sizes: 100, 10, 8, and 1 gram. Briefly note the `demo-only` status.

**Say:** “Here are four illustrative contracts: 100 grams, 10 grams, 8 grams, and 1 gram. Their identifiers, numeric sizes, and quote units agree. The backend converts each synthetic quote to a common price-per-gram basis. These labels and specifications are for demonstration only; they are not verified official MCX terms.”

**Transition:** Select **Prices**, then **Consensus**.

### 1:20–2:05 — Compare prices and inspect a research alert

**On screen:** Prices chart, followed by Consensus and Anomaly alerts.

**Action:** Show the normalized price chart and equal-weight consensus; then scroll to the alert table and open one alert’s **Explain** details.

**Say:** “With quotes on a common basis, we can compare the contracts over time and calculate an equal-weight cross-contract consensus. The synthetic dataset includes a generated deviation, so the real analysis pipeline can demonstrate a research alert. Its residual and historical z-score explain why it was flagged. This is a statistical diagnostic—not a live market signal, arbitrage claim, or recommendation.”

**Transition:** In the explanation, point out the guards, then select **Backtest**.

### 2:05–2:35 — Risk guards and walk-forward diagnostics

**On screen:** Alert explanation, then the Walk-forward backtest section.

**Action:** Point out liquidity, expiry, stale-data, and data-quality guard results where shown; show the evaluated-day count and candidates.

**Say:** “The analysis also checks liquidity, expiry, data freshness, and data quality before treating a candidate as eligible. The walk-forward view evaluates historical observations using earlier history as its baseline. It reports diagnostics only; it does not test or claim trading profitability. Raw-volume weighting is marked experimental because comparable source-volume units are not represented.”

**Transition:** Select **Data**.

### 2:35–3:00 — Honest limits and impact

**On screen:** Data status showing the synthetic source, validation, and import summary; finish at Overview.

**Action:** Show that the values are synthetic, then return to Overview for the closing line.

**Say:** “The backend validates and processes its generated demo records through the same pipeline, but this prototype has no live MCX feed and no verified official contract specifications. The next step is to evaluate permitted historical data and documented contract terms. AURUM EDGE makes those differences visible, so research can start with a clearer comparison—not an unverified trading promise.”

## Recording checklist

- Open `http://127.0.0.1:5173/` and confirm the backend shows connected.
- Select **Synthetic demo** and keep the synthetic-data banner visible.
- Start on Overview; use the storyboard order: Overview → Contracts → Prices → Consensus → Anomaly alerts → Walk-forward backtest → Data status → Overview.
- Confirm the four demo names and sizes are visible before recording.
- Use 1920×1080 if available, browser zoom at 100%, and maximize the browser. If labels look too small, increase zoom to 110% and check that the navigation still fits.
- Record only the browser window or a cropped browser region. Close unrelated windows and tabs, enable Windows Do Not Disturb, and keep terminals, personal files, environment settings, and notifications off screen.
- Use Xbox Game Bar (`Win+G`, then record) if available, or Windows Snipping Tool screen recording. Record locally; do not upload or publish without permission.
- Move the pointer deliberately, pause briefly after each section change, and avoid circling or rapidly scrolling over text.
- Speak at a relaxed pace. If a section takes longer, trim pauses rather than rushing the disclaimers.

## Fallback if something fails

1. If a section is still loading, wait briefly and use **Refresh** once. If the backend status is unavailable or requests continue to fail, do not present API-mode data as current or substitute sample values silently.
2. If the backend cannot be restored in time, switch to the frontend's explicit **Sample preview** configuration and restart Vite with that mode; confirm the “STATIC SAMPLE PREVIEW” banner before recording. Sample preview is illustrative UI fixture data, not backend output.
3. In sample preview, skip backend ingestion and workflow claims. Describe only what is visibly labelled as sample fixture behavior.
4. If alerts or backtest results are absent, show the honest empty state and explain that this dataset did not produce eligible results. Never invent an alert or imply a profitable strategy.
5. If a fix or restart would risk the database or expose configuration, stop recording and use the sample-preview fallback rather than making an unsafe change.

## Verified implementation notes

- The current local synthetic API dataset is generated through the backend ingestion, validation, persistence, normalization, analysis, and risk-guard pipeline.
- The demo contracts are explicitly `demo-only`; their metadata source states that it is not an MCX specification.
- The implemented analysis uses consensus calculations, historical residual z-scores, and configured risk guards. The project does not claim AI, a live MCX feed, verified official demo specifications, or profitable trading results.
- The Render Blueprint defines a Workflow service and task chain, but this local verification does not establish that the project has been deployed to Render.
