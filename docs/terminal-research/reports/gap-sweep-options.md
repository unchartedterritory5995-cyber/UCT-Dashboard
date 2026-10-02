# Gap sweep: options analytics rows (FT-0xx), lane/gaps-options

Swept 2026-10-02 against `integrate/terminal-fixes` @ `daf658088`. Row definitions:
`docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md:573-644`.

Status at sweep time is what the integration branch held BEFORE this lane. The "This lane"
column says what this branch added, and under which dark flag. Every flag is registered
`pending` in `docs/feature_flags.json` and is armed independently.

Two lanes that touch this domain were NOT merged into `integrate/terminal-fixes` at sweep time:
`origin/lane/cov-02-03` (COV-02 option screener + COV-03 rankings) and
`origin/lane/brk01-inc4-backtest` (BRK-01 inc 4 backtester). Rows that depend on them are
marked as such.

| Row | What it asks | Status at sweep | Evidence (file:line) | This lane |
|---|---|---|---|---|
| FT-002 | Multi-leg simulated position off the live chain | PARTIAL | `app/src/pages/research/tabs/optionPayoff.js:13` (four fixed 1-2 leg strategies); `PayoffPanel.jsx:27` | Free-form leg builder (any count, any side and quantity, chain-priced at mid), `OPTIONS_MULTI_LEG_ENABLED` |
| FT-003 | Price range at a chosen probability (default 1 SD, 68.27%) | ABSENT | no route or panel; the chain gives ATM IV only (`OptionsChainTab.jsx:73`) | `GET /api/research/options/{sym}/probability`, `OPTIONS_PROBABILITY_ENABLED` |
| FT-006 | IV rank in the page header with a plain label | PARTIAL | the rank is computed (`api/services/research/iv_history.py:274`), but the chain header is a fixed sentence (`OptionsChainTab.jsx:86`) and the chain route returns `iv_rank: None` (`api/routers/options_chain.py:80`) | `GET /api/options/vol/{sym}/iv-rank` + header badge, `OPTIONS_IV_RANK_ENABLED` |
| FT-007 | Daily 1-day implied move vs actual move | ABSENT (earnings-only exists) | `iv_history.py:378` pairs implied with realized at EARNINGS only | `GET /api/research/options-history/{sym}/daily-move`, `OPTIONS_DAILY_MOVE_ENABLED` |
| FT-008 | Earnings implied-move calibration score | BUILT | `iv_history.py:438` (mean ratio + inside share, only at >= 4 paired prints); panel `IvHistoryPanel.jsx:52` | none |
| FT-009 | ATM straddle price history | ABSENT (data logged, not served) | `front_straddle` is written daily (`api/services/options_universe_log.py:64`) and read only for earnings (`iv_history.py:419`) | `GET /api/research/options-history/{sym}/straddle`, `OPTIONS_STRADDLE_HISTORY_ENABLED` |
| FT-010 | IV crush, -5..+5 sessions around each print | ABSENT | no route | `GET /api/research/options-history/{sym}/iv-crush`, `OPTIONS_IV_CRUSH_ENABLED` |
| FT-016 | Chain -> chart -> pricer drill-through | ABSENT | chain cells are not interactive (`OptionsChainTab.jsx:100-106`); no pricer exists | contract drill: click a quote, open the pricer (Black-Scholes, computed) beside the vendor price/greeks, plus a chart link, `OPTIONS_PRICER_ENABLED` |
| FT-019 | Option monitor with EVTS button and HV field | ABSENT | no realized-vol computation anywhere in `api/` (grep `realized_vol|hv20` = 0) | `GET /api/research/options/{sym}/monitor`, `OPTIONS_MONITOR_ENABLED` |
| FT-020 | Volatility endpoints (iv-rank, term-structure, interpolated-iv, realized, VRP) | PARTIAL | term structure inside `/surface` only (`api/services/vol_surface.py:185`); rank inside `/iv-history` | `/api/options/vol/{sym}/{term-structure,interpolated-iv,realized,vrp}`, `OPTIONS_VOL_ENDPOINTS_ENABLED` |
| FT-039 | Decomposed, narrating fit score | ABSENT | grep `fit_score|option_stance` = 0 | `GET /api/research/options/{sym}/stance`, `OPTIONS_STANCE_ENABLED` |
| FT-047 | Named dealer-positioning vocabulary | PARTIAL | words exist but are typed per surface: `api/gex_service.py:292,312,337` (Ceiling/Floor/Gamma Flip/Danger Line), `OptionsFlow.jsx:278`. TERM-041 pattern to follow: `api/services/voice_regime_classifier.py:32` | closed, versioned vocabulary + `levels` in its words, `OPTIONS_POSITIONING_VOCAB_ENABLED` |
| FT-049 | Gamma heatmap by strike x expiry | ABSENT | `get_gex_data` aggregates across expiries per strike (`api/gex_service.py:451-520`) | `GET /api/options/positioning/{sym}/heatmap`, `OPTIONS_GEX_HEATMAP_ENABLED` (gamma only; no charm/delta-pressure, no forward projection) |
| FT-050 | Options Impact gauge (gamma vs notional volume) | ABSENT | none | `GET /api/options/positioning/{sym}/impact`, `OPTIONS_IMPACT_ENABLED` |
| FT-051 | Two positioning models (naive OI vs dealer-adjusted) | BUILT | `api/gex_router.py:12-31` (`adjusted=`), `api/gex_service.py:748` (`/compare`), `OptionsFlow.jsx:3911` | none |
| FT-052 | Negative (dealer-short) positioning, explained | PARTIAL | the adjusted model can flip a strike's sign (`gex_service.py:483-497`) but no surface names "dealers net short" | `GET /api/options/positioning/{sym}/dealer-short`, `OPTIONS_DEALER_SHORT_ENABLED` |
| FT-054 | "Positions N minutes ago" overlay | ABSENT | none | still open (needs an intraday positioning store; see below) |
| FT-055 | Positioning primitives: max-pain, NOPE (gex/oi-change exist) | PARTIAL | GEX `api/gex_router.py:12`, OI history `api/oi_snapshot_router.py:128`; max-pain / NOPE absent from `api/` (only a Pine port in the chart engine's vendor harness) | `/api/options/positioning/{sym}/max-pain` (`OPTIONS_MAX_PAIN_ENABLED`), `/nope` (`OPTIONS_NOPE_ENABLED`) |
| FT-056 | Market Tide (market-wide net premium by minute) | ABSENT | none | `GET /api/options/market-tide`, `OPTIONS_MARKET_TIDE_ENABLED` |
| FT-072 | Option Hacker / Spread Hacker / Spread Book | PARTIAL (unmerged) | COV-02 single-contract screen on `origin/lane/cov-02-03` (`api/routers/options_screener.py`), not in `integrate/terminal-fixes` | see FT-073 |
| FT-073 | One screener per option strategy | PARTIAL (unmerged) | COV-02 presets are single-contract only (`lane/cov-02-03:api/services/research/options_screener.py:638`) | strategy screens over COV-02's screen file, `OPTIONS_STRATEGY_SCREENS_ENABLED` (see below) |

## Data honesty applied to every surface this lane added

* **Computed vs vendor.** Greeks, IV and OI from Massive are labelled `vendor`. GEX, max pain,
  NOPE, the impact ratio, probability ranges, Black-Scholes prices and realized vol are ours and
  labelled `computed`, with the method in words.
* **Thin history.** The options log began 2026-09-30. Every log-backed answer carries `n`, the
  first session, and the number of sessions/prints at which it becomes meaningful; below that it
  shows the sentence, never a number.
* **Market Tide** states the tape's own filters on the surface (50+ contracts, $10K+ premium;
  the `/data` read is the tape's premium-capped day file).
* **Async.** Chain-backed positioning routes are `async` and await the cached chain; anything
  that blocks (bars, SQLite, the flow tape read) runs in a thread or a plain `def` handler, and
  heavy results are cached.

## Still open

Filled in at the end of the lane; see the final section.
