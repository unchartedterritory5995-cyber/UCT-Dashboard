# Market Cap consumers — inventory, semantics, migration class (Gate I)

Status: 2026-09-30. Read-only inventory of the worktree at `59db353bf`. **No consumer was changed**; migration
needs a separate owner authorization. Target authority: `api/services/marketcap/serve.py`. It is dark: it serves
only through `dark_app.py`, `api/main.py` does not mount it, and it has no auth dependency yet (it would need
one at mount time). It provides:
- `GET /api/marketcap/pit/{ticker}`: the daily company series, with gaps, reasons and structure.
- `GET /api/marketcap/pit/{ticker}/latest`: returns `company_market_cap` and `security_market_cap`.

Migration classes:
- **A SAFE**: a drop-in change of the value.
- **B REVIEW**: members would see a semantic change.
- **C SPECIALIZED**: the consumer needs a different quantity.
- **D BROKEN**: the consumer is wrong today.

## Consumer families

Four families (L–O) were added to the original eleven.

### A. Chart PIT composer
- **Current source and fallback:** close × V5 `shares_outstanding` (dei non-dimensional), with a 200-day as-of lapse. No fallback.
- **Semantics:** class price × company share count; multi-class issuers are unavailable; ADRs use ADS price × ordinary shares.
- **History, cadence, cache:** historical daily; memo per bars object.
- **Entitlement:** fundamentals router, behind a flag.
- **Location:** `app/src/components/chart/engine/fundamentalSource.js:54-60`, `fundamentalAsOf.js:117,162`.
- **Class:** B (the 200-day lapse disappears; multi-class issuers gain values). D for ADRs and multi-class.

### B. Screener / formulas / scatter / watchlist (>100 rows)
- **Current source and fallback:** Massive reference `market_cap`, then `weighted_shares_outstanding` or `share_class_shares_outstanding` × price.
- **Semantics:** provider-defined; BRK.A and BRK.B diverge.
- **History, cadence, cache:** current only, rebuilt nightly into `screener_rows`. The formula scalar is today's value applied to every past bar.
- **Entitlement:** watchlist uses `get_current_user`.
- **Location:** `api/services/massive.py:1334-1366`, `screener/snapshot_builder.py:671-678,1116`, `closedTable.json:2297-2308`, `scatter.py:63,80`.
- **Class:** A for screener, scatter and watchlist. B for formulas, which gain real history.

### C. Chart header / info row, snapshots, research, watchlist (≤100 rows), LLM context
- **Current source and fallback:** yfinance `.info.marketCap`, then FMP quote, then Finnhub.
- **Semantics:** company-level in practice.
- **History, cadence, cache:** current only, sent as a pre-formatted string like "$1.23T". TTL 30 min / 1 h; disk `snap_store`; SWR 10 min.
- **Entitlement:** `/api/fundamentals/{t}` and `snapshot-batch` have none.
- **Location:** `api/services/fundamentals.py:149,261-268`, `routers/fundamentals.py:354-362`, `research/snapshot.py:159`, `headerFields.js:113`, `Watchlists.jsx:275`.
- **Class:** A for display. D for the watchlist mix (see below).

### D. AboutPanel
- **Current source:** FMP profile `mktCap`.
- **Semantics:** company-level, current. TTL 12 h.
- **Entitlement:** `get_current_user`.
- **Location:** `company_about.py:70`, `AboutPanel.jsx:128`.
- **Class:** A.

### E. Research QuoteStrip
- **Current source:** FMP quote `marketCap`.
- **Semantics:** company-level, current. TTL 60 s.
- **Location:** `routers/research.py:206`.
- **Class:** A (or drop the field; the strip does not render it).

### F. Calendar (`mc_b`)
- **Current source and fallback:** the wire chip value, then Finviz Elite "Market Cap".
- **Semantics:** company-level, current; dated per day for past days. TTL 23 h / 24 h / 120 s.
- **Entitlement:** calendar routes have none.
- **Location:** `routers/calendar.py:207-219,3015-3175`, `importance.js`, `calendar_week_poster.py:218-259`.
- **Class:** B (importance ordering and poster membership would shift).

### G. Catalyst
- **Current source:** yfinance `.info.marketCap`.
- **Semantics:** company-level, current. SQLite TTL 24 h.
- **Location:** `catalyst/ticker_metadata.py:136`, `filters.py:47,87-90`, `scoring.py:38-45,113-115`.
- **Class:** A for the value. B for the $300M floor and the $50B bank exemption.

### H. News gate
- **Current source:** yfinance `fast_info.market_cap`.
- **Semantics:** shares × price, possibly class-level; current. Recomputed per rebuild, no cache.
- **Location:** `api/services/engine.py:2206-2232`.
- **Class:** A (needs a batch endpoint).

### I. Options flow / dark pool
- **Current source and fallback:** vendor CSV `MktCap`, then the `flow.db` latest, then UW, then Schwab `marketCap`/**`marketCapFloat`**, then Yahoo v7/v10.
- **Semantics:** security-level vendor values; current at print time and frozen into history.
- **History, cadence, cache:** 24 h cache.
- **Entitlement:** `mktcap-batch` is an open route.
- **Location:** `schwab_router.py:874-887`, `flow_db.py:1038-1051`, `massive_ws_worker.py:842-898`, `flowCompute.js:225-238`, `live_massive_router.py:178-182`.
- **Class:** C (alert calibration). D for the float fallback and the known bad BBS values (e.g. MU at $1.2T).

### J. Voice
- **Current source:** `fundamentals.get_fundamentals` (a formatted string). A second tool reads raw Massive through `polygon_extras`.
- **Semantics:** current.
- **Location:** `voice_tool_impls.py:4100-4115`, `polygon_extras.py:93`.
- **Class:** D. `float("$1.23T")` raises and is swallowed, so the LLM is told the market cap is None.

### K. IPO calendar
- **Current source:** FMP `marketCap`, often null.
- **Semantics:** offering size or expected valuation of a company not yet listed.
- **Location:** `ipo_calendar.py:124-164`, `EventCard.jsx:45`.
- **Class:** C (not a traded market cap; keep it separate).

### L. `ticker_meta.market_cap_musd`
- **Current source:** FMP profile, in millions of USD.
- **Location:** `ticker_meta.py:125-178`. No reader.
- **Class:** A.

### M. Universe floors
- **Thresholds:** $300M, and ">$500M" in UCT20 copy.
- **Location:** `watchlists.py:218`, `useWatchlistMeta.js:37`, `UCT20.jsx:268`.
- **Class:** B.

### N. `identities.py` check
- **What it does:** advisory `mc ≈ price × shares`.
- **Location:** `identities.py:698-713`.
- **Class:** B (it will flag company-level values on multi-class names).

### O. `wisdom street.py`
- **What it does:** reads a `market_cap` column.
- **Location:** `street.py:76`.
- **Class:** A.

## Findings recorded but not fixed (owner rulings)

- **Watchlist mixed source (D):** `useWatchlistMeta.js:43-80` / `watchlists.py:163-236`. Lists of 100 rows or fewer use family C and larger lists use B, and C overrides B where they overlap, so sorting mixes Yahoo and Massive values. This is a migration target.
- **Voice empty Market Cap (D):** `voice_tool_impls.py:4106` is a future consumer migration.
- **Cap-band disagreement (policy, unchanged):** mega-cap starts at $500B in `flowCompute.js:225,235`, `OptionsFlow_admin.jsx:520,529,728` and `weekly_flow.py:313`. It starts at $200B in `live_massive_router.py:182`, `LiveFlowMassive.jsx:2067`, `weekly_flow.py:100-104`, `hypothesis_sheet.py:50-52`, `DarkPool.jsx:2302-2317`, `conceptVocabulary.json` and `calendar_week_poster.py:114`.
  - Other thresholds: OTM 10%/15% at $200B/$10B; the flow accumulation ceiling of $50B; calendar pills 0/$1B/$10B/$100B; floors of $300M (catalyst, news, saved screens).
  - These are separate policy issues, and this project does not change them.

## Migration notes for the canonical authority

1. **Company-level by default (ruling 6).** Only the flow family (I) needs a security-level figure; `/latest` returns `security_market_cap` for it. Float-adjusted cap is a different quantity (C).
2. **Where history comes in.** Consumers A and B-formulas are the only ones where history matters. The authority supplies a daily historical series; today B-formulas apply today's value to every past bar.
3. **Current-value freshness.** The dataset's last day is the last close in bars. Intraday consumers (C, E, I) would need `latest state × live price`: the share state from this dataset, the price from the live quote.
4. **Units and format.** Every consumer that receives a pre-formatted string (C, J) must move to raw USD.

## 2026-10-01 re-inventory against origin/master `22f07e1bd`

No code that reads, computes, or thresholds market cap changed between f40b541c2 and 22f07e1bd. The only diff is
one comment, at `ChartPane.jsx:466`. The families below existed before 09-30 but were missing from this document.

| Family | Locations | Source | Class |
|---|---|---|---|
| A′ Server PIT composer (inert) | `fundamentals_pit/price_derived.py:3-38`, `catalog.py:174-178,230` | close × as-of shares | **A**. Nothing outside the tests imports it. Retire it, or point it at the authority. |
| B+ Canonical resolver | `canonical/resolver.py:117`, `canonical_address_book.json:1410` (DESK_FIGURE → `screener_rows`, "authoritative") | Massive | **B**. Conflicts with the new authority's role. Re-point it at cutover. |
| B+ Formula engines | `pcf.js:879-880` (TC2000 aliases, ÷1e6), `ast_interpret.py:4498`, `scan_evaluator.py:1038`, `saved_screens.py:330` | `screener_rows` scalar | **B**. Formulas gain history. |
| C-LLM | `ai_search.py:927-931`, `ai_search_dossier.py:247`, `voice_deep_research.py:194`, `research/comparison_ai_adapter.py:114` | family C string | **A**. Pass the raw value plus a formatter. |
| C+ Widgets | ProfileWidget, DockProfile, CompanySearch, FundamentalSnapshot, research Profile/Setup/Overview/Compare, `positionDetail.js:74`, GridChartCell | family C | **A** (display) |
| F+ Calendar | CalendarWidget, `calendar_sector_read.py`, `calendar_anticipated_png.py`, `earnings_preview_warm.py`, `provider_coverage_monitor.py` (mc_b fill rate) | wire `mc_b`, then Finviz | **B**. Importance, poster membership and warm order would shift. |
| G+ Catalyst | public `/r/*` render panel (`render_panels.py:29`), rejection log (`store.py:948`) | yfinance | **A** value. **B** for the $300M floor and the log weight. |
| I+ Flow | `darkpool_eod.py` (Mega ≥$500B, Large ≥$10B), `darkpool_records.py`, `flow_summary.py`, `flow_opt_aggregate.py`, `/flow/small-data` $10B ceiling, UW ingest, admin `backfill-mktcap` (`main.py:9528-9606`) | vendor `MktCap` → flow.db latest → Schwab (incl. **marketCapFloat**) → Yahoo | **C**. Also **D** for the float fallback and the self-perpetuating "latest". |
| M+ Universe floors | `cap_universe.py` + `api/data/cap_universe.json` ($300M+), `rs_ranking.py:65-88` | wire / static | **B**. Population changes alter RS percentiles. |
| P Hard-coded mega-cap lists | `liveflow_worker.py:201-233` (MEGA_CAP_TICKERS), `darkpool_aggregator.py:100,168` (LARGE_CAP_KNOWN) | static | **C**. Policy lists, not values. Leave them alone. |

Confirmed D findings:
- **Watchlist mix.** For lists of 100 or fewer, the values are Yahoo strings. For larger lists, the values are Massive, with missing names falling back to Yahoo. Yahoo is applied last, so it wins wherever both cover a name. `parseMcap` then sorts the mixed strings.
- **Voice `get_company_info`.** `market_cap_b` is always None (`voice_tool_impls.py:4104-4107`: `float("$1.23T")` raises and the error is swallowed).
- **Screener column.** `columnDefs.js:79` describes the column as "shares × price, dual-class combined", but the value is the provider's.

Cap-band and size thresholds are located only. Policy is unchanged:
- **Mega at $500B:** `flowCompute.js:225,235`, `weekly_flow.py:313`, `darkpool_eod.py:94-104`.
- **Mega at $200B:** `live_massive_router.py:181`, `LiveFlowMassive.jsx:2067`, `hypothesis_sheet.py:50`, `DarkPool.jsx:2312` (+ Mid ≥$2B), `conceptVocabulary.json:774,799`, poster `calendar_week_poster.py:114`.
- **OTM tiers:** `flowCompute.js:934`, `flow_summary.py:229`, `flow_opt_aggregate.py:228`, `weekly_flow.py:165`.
- **Premium multipliers:** `OptionsFlow.jsx:837`.
- **Ask-accumulation ceiling, $50B:** `live_massive_router.py:318`.
- **Calendar pills, $0/1/10/100B:** `filterLogic.js:7,21`.
- **FEATURED ≥$10B:** `importance.js:158`.
- **$300M floors:** catalyst `tuning.py:53`, news `engine.py:2227`, `saved_screens.py:330`, `calendar.py:219`.
