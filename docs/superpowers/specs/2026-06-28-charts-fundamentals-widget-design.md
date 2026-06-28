# Charts Fundamentals Widget — Design

**Date:** 2026-06-28
**Status:** Approved design → ready for implementation plan
**Surface:** `/charts` customizable workspace (Charts Hub V2)

## Summary

Add a new **`fundamentals`** widget type to the `/charts` react-grid-layout
workspace. It mirrors MarketSurge's earnings/fundamentals data treatment:

1. **Annual EPS/Sales growth table** — `Year · EPS ($) · % Chg · Sales · % Chg`,
   including forward analyst-estimate years (e.g. `2026 e`, `2027 e`) with an
   estimate-revision marker (▲ raised / ▼ cut).
2. **Quarterly actual-vs-estimate strip** — the last ~5 reported quarters
   (EPS & Sales actual vs estimate + surprise %) plus the **next** earnings date
   with its consensus estimate.

The widget reacts to the host widget's **color-group ticker** (A/B/C/D), so it
stays in lockstep with any color-linked Chart widget. Free tier (like the rest
of `/charts`).

**Out of scope (explicitly):** a top valuation stats strip (mkt cap / P/E / beta),
analyst buy-hold-sell consensus, and docking a strip beneath the Chart widget.
These can be added later; this spec is the two earnings tables only.

## Why / accuracy bar

The user's primary requirement is **accuracy and freshness**: actuals must be
correct the moment a company reports, forward estimates must track street
consensus, and consensus *changes* (raised/cut guidance) must be visible. The
design therefore centers on a tiered-cache + earnings-event + revision-snapshot
architecture, not just a static render.

## Architecture

### 1. Widget wiring (follows existing Charts Hub V2 patterns exactly)

- **`ChartsWorkspace.jsx`**
  - Add `fundamentals: { w: 4, h: 10, minW: 3, minH: 5 }` to `WIDGET_DEFAULTS`.
  - Add `'fundamentals'` to the `+ Add Widget` menu type array.
- **`WidgetHost.jsx`**
  - Add `fundamentals: 'Fundamentals'` to `TYPE_LABEL`.
  - Add `case 'fundamentals': return <FundamentalsWidget color={widget.color} opts={widget.opts} />` to `WidgetBody`.
- **`widgets/FundamentalsWidget.jsx`** (new) — self-contained (does NOT wrap an
  existing page). Reads `const { groupSyms } = useWorkspace()` and uses
  `groupSyms[color]` as the active ticker; renders the two sections from one
  SWR fetch. Mirrors the `ThemesWidget` color-group read pattern, minus the
  scoped `ChartsSymContext.Provider` (no wrapped page to feed).
- **`widgets/MobileWorkspace.jsx`** — include `fundamentals` in the tabbed
  mobile widget stack so it is reachable on phone.
- **CSS** lives in a new `FundamentalsWidget.module.css`. The widget root sits
  inside `.widgetBody` (`container-type: inline-size`), so all responsive
  collapse uses **`@container`** queries (NOT `@media`) — load-bearing per the
  Charts Hub V2 invariants.

### 2. Backend — one new endpoint, reusing existing services where possible

**`GET /api/fundamentals/earnings-table?sym=AAPL[&debug=1]`**
(auth: `get_current_user`) →

```json
{
  "ticker": "AAPL",
  "annual": [
    { "year": 2024, "eps": 2.37, "eps_chg_pct": 45, "sales": 6.0e9,
      "sales_chg_pct": 12, "estimate": false, "eps_revision": null,
      "sales_revision": null },
    { "year": 2026, "eps": 3.15, "eps_chg_pct": 14, "sales": 7.8e9,
      "sales_chg_pct": 15, "estimate": true, "eps_revision": "up",
      "sales_revision": null }
  ],
  "quarterly": [
    { "label": "2025 Q2", "eps_actual": 0.64, "eps_estimate": 0.57,
      "eps_surprise_pct": 12, "rev_actual": 1.63e9, "rev_estimate": 1.43e9,
      "rev_surprise_pct": 14, "reported": true },
    { "label": "2026 Q2", "report_date": "2026-08-05", "eps_estimate": 0.58,
      "eps_est_chg_pct": 14, "rev_est_chg_pct": 16, "reported": false }
  ],
  "_sources": { "annual": "fmp", "forward": "yfinance", "quarterly": "merge" }
}
```

`_sources` only present when `?debug=1`.

#### Quarterly strip (Image #2) — mostly ready
- Reuse `earnings_estimates.get_year_earnings(ticker, year)` for the current and
  prior fiscal year; take the **last 5 reported quarters** (it already returns
  EPS + revenue actual/estimate + surprise %, multi-source merged + deduped).
- Append the **next (unreported) earnings date** + consensus estimate from
  `get_earnings_intel` / Finnhub earnings calendar. `eps_est_chg_pct` /
  `rev_est_chg_pct` = estimate vs the year-ago actual quarter.

#### Annual table (Image #1) — new assembly `get_annual_financials(ticker)`
- **Closed historical years** (default 6 back):
  - Source chain (first that returns usable data wins, per row):
    1. **FMP `stable/income-statement`** (annual, `limit≈10`) — deepest, one call,
       gives Total Revenue + Diluted EPS per fiscal year.
    2. **yfinance annual `income_stmt`** — ~4 fiscal years fallback.
    3. **Roll-up of `get_year_earnings` quarters** — sum quarterly `eps_actual`
       and `revenue_actual` per year (last-resort; reuses merged data).
  - `eps_chg_pct` / `sales_chg_pct` = YoY vs the prior row, computed in Python.
- **Forward estimate years** (current FY `0y` + next FY `+1y`, `estimate: true`):
  1. **FMP `analyst-estimates`** (per-fiscal-year structured) when live on plan.
  2. **yfinance `earnings_estimate` + `revenue_estimate`** (`avg` for `0y`/`+1y`).
  - `*_chg_pct` vs the prior row (last actual or prior estimate).
  - `eps_revision` / `sales_revision` ∈ `'up' | 'down' | null` from the snapshot
    store (section "Freshness C" below).
- **Source verification:** during implementation, probe each candidate provider
  with the existing unauthenticated `GET /api/debug/earnings-sources/{sym}` to
  confirm which endpoints actually return data on the current FMP plan before
  locking the chain. The fallback chain guarantees a table even if one 403s.

Files: `api/routers/fundamentals.py` (new route) + `api/services/earnings_estimates.py`
(add `get_annual_financials`) or a new `api/services/annual_financials.py` if the
former grows too large.

### 3. Freshness & accuracy architecture (the core requirement)

#### A. Tiered caching (per data slice, by how often it moves)
- **Closed-year annual actuals** + **reported quarterly actuals** → ~7-day TTL
  (static once reported).
- **Forward annual estimates** + **next-quarter estimate** → ~6-hour TTL
  (consensus drifts gradually).
- **Next earnings date** → resolved on every load (cheap), so a date slip is
  caught immediately.

Implemented by composing separately-cached helpers (reusing the existing shared
`cache` TTLCache singleton + per-(ticker,year) keys already used by
`get_year_earnings`), not one monolithic cache entry.

#### B. Earnings-event fast-path ("quick update when a company reports")
- When **today is within ±1 trading day** of the ticker's next earnings date
  (known from the Finnhub calendar / `get_earnings_intel`), the **forward-estimate
  and next-quarter TTL collapses to ~15 min**.
- Effect: the moment a company reports, the *"next earnings — Est."* row flips to
  a **reported actual vs estimate** row and forward annual estimates pick up the
  post-print street revisions — within minutes, load-driven, no per-stock cron.
- Outside the window it stays on the cheap 6h cadence.

#### C. Estimate-revision tracking (the ▲/▼ marker — "consensus changed")
- New SQLite store **`/data/fundamentals_estimates.db`**, table
  `estimate_snapshots(ticker, fiscal_year, eps_est, sales_est, captured_at,
  PRIMARY KEY(ticker, fiscal_year, captured_at))`. Lazy-init via `_ensure_init()`
  on first use (mirrors the catalyst metadata DB pattern).
- On each forward-estimate fetch, insert a snapshot (deduped to ~1/day per
  ticker+year to bound growth).
- The endpoint compares the latest estimate to the snapshot nearest **~30 days
  ago**; emits `eps_revision` / `sales_revision` = `'up'` (raised) / `'down'`
  (cut) / `null` (flat or insufficient history).
- Widget renders **▲ green** (raised) / **▼ red** (cut) next to the estimate
  %Chg, matching the MarketSurge marker.
- Retention sweep: prune snapshots older than ~400 days (keeps ~1y of revision
  history; mirrors the COT/tweet cleanup idiom).

#### D. Background warm job (keeps revision history dense)
- A **once-daily** scheduled job (APScheduler in `api/main.py`, alongside the
  COT/Twitter/Catalyst blocks) warms `get_annual_financials` +
  `get_year_earnings` for: **today's & tomorrow's earnings reporters** + the
  union of **user watchlists / flagged / UCT20** tickers.
- Purpose is twofold: (1) those stocks are already fresh when opened during
  earnings season, and (2) — the real reason — it guarantees a **steady
  snapshot cadence** for section C so the ▲/▼ arrows are trustworthy even on
  tickers no user opened recently.
- Gated by an env flag `FUNDAMENTALS_WARM_ENABLED=1`. Bounded worker pool +
  polite sleeps (mirrors `ticker_names_prewarm`). Idle cost ≈ one pass/day.

#### Net behavior
- Actuals: correct-on-report (event fast-path + static caching of reported data).
- Estimates: refresh within ~6h normally, within ~15 min around an earnings
  print, and consensus revisions are shown explicitly via ▲/▼.
- Every value is auditable per-ticker via `?debug=1` (which source filled it).

### 4. Frontend UI (MarketSurge look, on-brand)

`FundamentalsWidget.jsx` + `FundamentalsWidget.module.css`:

- **Annual table** — dense rows `Year · EPS ($) · % Chg · Sales · % Chg`.
  - Estimate rows render the year as `2026 e`.
  - `% Chg` colored green (positive) / red (negative); estimate rows append the
    ▲/▼ revision marker when `*_revision` is set.
  - Sales auto-formatted `$B` / `$M` (reuse the `fmtBillions`/`fmtCap` helpers'
    idiom already in `FundamentalsStrip.jsx`).
- **Quarterly strip** — horizontal per-quarter blocks: `EPS actual vs est +%`
  over `Sales actual vs est +%`; final block = next earnings date + `Est. +%`.
  - `@container` query collapses the number of visible quarter columns as the
    widget narrows (drops oldest first); never overflows horizontally.
  - Missing quarters render `—` (consistent with `get_year_earnings` padding).
- **States**: loading skeleton; null-safe (a section hides if its array is
  empty; whole-widget empty state when the ticker has no fundamentals); no
  ticker selected → prompt to pick one (color-group hint).
- **Styling**: custom on-brand gold/green/red tokens; **no generic emoji**
  (per project convention) — the ▲/▼ are styled glyphs/SVG, not emoji.
- Data via a new SWR hook `app/src/hooks/useEarningsTable.js`
  (`/api/fundamentals/earnings-table?sym=`), polled on a relaxed interval
  (e.g. 5 min) since the backend owns freshness.

## Data flow

```
color group ticker (A/B/C/D)
      │  groupSyms[color]
      ▼
FundamentalsWidget ──SWR──▶ GET /api/fundamentals/earnings-table?sym=
                                   │
                 ┌─────────────────┼───────────────────────────┐
                 ▼                 ▼                           ▼
        get_annual_financials  get_year_earnings        estimate_snapshots
        (FMP annual / yf /     (last 5 quarters,        (▲/▼ revision vs
         quarter roll-up +      multi-source merge)      ~30d-ago snapshot)
         forward 0y/+1y est)
                 │                                            ▲
                 └───── writes daily snapshot ────────────────┘
        (tiered TTL + ±1-day earnings fast-path; daily warm job)
```

## Testing

**Backend**
- `get_annual_financials`: YoY math, estimate-row tagging, source-fallback order
  (FMP→yf→roll-up), forward-estimate assembly, empty/unknown ticker.
- Revision logic: up/down/null vs a seeded snapshot history; dedup to 1/day.
- Earnings fast-path TTL selection (within ±1 day → short TTL; else 6h).
- Endpoint: auth required, happy path, unknown ticker (empty arrays not 500),
  `?debug=1` exposes `_sources`.

**Frontend**
- `FundamentalsWidget.test.jsx`: renders annual + quarterly from mocked data;
  reacts to color-group ticker change; ▲/▼ markers on estimate rows; loading,
  empty, and no-ticker states; `@container` collapse (smoke).

## Files touched / added

| Path | Change |
|------|--------|
| `app/src/pages/charts/ChartsWorkspace.jsx` | register `fundamentals` defaults + menu item |
| `app/src/pages/charts/WidgetHost.jsx` | label + dispatch case |
| `app/src/pages/charts/widgets/FundamentalsWidget.jsx` | **new** widget |
| `app/src/pages/charts/widgets/FundamentalsWidget.module.css` | **new** styles |
| `app/src/pages/charts/widgets/MobileWorkspace.jsx` | include in mobile stack |
| `app/src/hooks/useEarningsTable.js` | **new** SWR hook |
| `api/routers/fundamentals.py` | **new** `/earnings-table` route |
| `api/services/earnings_estimates.py` (or new `annual_financials.py`) | `get_annual_financials` + revision helpers |
| `api/services/fundamentals_estimates_store.py` | **new** snapshot SQLite store |
| `api/main.py` | daily warm job (gated `FUNDAMENTALS_WARM_ENABLED`) |
| `tests/...` | backend + frontend tests |

## Env vars

- `FUNDAMENTALS_WARM_ENABLED=1` — toggle the daily snapshot/warm job.
- `FUNDAMENTALS_ESTIMATES_DB_PATH=/data/fundamentals_estimates.db` — override for local.
- Reuses existing `FMP_API_KEY`, `FINNHUB_API_KEY`, `ALPHAVANTAGE_API_KEY`.

## Open implementation-time questions (resolved during build, not blocking)

- Confirm FMP `stable/income-statement` and `analyst-estimates` are live on the
  current plan (via `/api/debug/earnings-sources`); else lean on yfinance.
- Exact history depth (6y default) — trivially tunable.
- Snapshot comparison window (30d) — tunable constant.
```
