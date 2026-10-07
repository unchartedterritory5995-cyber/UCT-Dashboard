# Breadth Library — Product Finishing Pass (2026-10-07)

One bounded pass over the existing library: discovery, explanations, breadth-specific presentation,
publication of already-stored metrics, and five derived ratios. **No** methodology, authority,
grind, pipeline, scheduler or historical artifact was touched. Everything below reads data the
accepted authorities already store.

## A. Discovery and library quality

| Change | Where |
| --- | --- |
| Every breadth row in Add to Chart (browse **and** search) carries its population chip: `UCT`, `US`, `NASDAQ`, `NYSE`. Search rows used to read "Breadth" ×4. | `discoveryCatalog.breadthResults` / `symbolLibraryRow` (`chip`) |
| Trader spellings: `percent`/`pct` → `%`, `dma`/`sma` → `MA`, `advance(s/rs/ing)` → `ADVANC`, `decline(s/rs/ing)` → `DECLIN`. Mirrored in both ranking lanes; the parity fixture pins the table. | `breadth_symbols._QUERY_SYNONYMS`, `breadthLibrary.SYNONYMS` |
| Row hover = universe · name (symbol) / what it measures / what the universe is / history from · data through. Every line is server metadata (`breadth_metrics.DESCRIPTIONS`, `breadth_universes.DESCRIPTIONS`, market-indicator `methodology` + `history_start`, library `universes[].first/last`). | `discoveryCatalog.breadthTooltip` |
| `UCTMC` is now named "McClellan Oscillator (Raw)" — it was indistinguishable from the ratio-adjusted US/NYSE/NASDAQ MCO in search. Symbol unchanged. | `breadth_symbols._ROWS`, `breadth_metrics` |
| Fixtures regenerate from the Python reference: `python tools/breadth/gen_library_search_fixtures.py`. | `tools/breadth/` |

## B. Breadth-specific presentation

* Market-indicator series (McClellan, Summation, A/D lines, Zweig, the new ratios, NAAIM…) get the
  breadth chart treatment in `ChartPane`: line style, D/W/M lock, no live quote, empty volume pane,
  no market-cap/earnings/rating fields, brand mark, `Symbol · Metric` header. Cboe volatility
  indices (real OHLC) and multi-series products are excluded.
* Percent change is sign-safe everywhere it was computed: legend strip, crosshair readout, UCT
  watchlist quote. A signed series (catalogue domain `signed`) shows its point change only; any
  reference ≤ 0 yields no percent. (`signSafeChangePct`, `canonicalDomain`, `breadth_symbols.latest_quotes`.)

## C. Stored metrics now published — `BREADTH_LIBRARY_METRICS` default `v1` → `v1.1`

Every registered, applicable, producible PIT metric outside V1 was classified
(`breadth_metrics.V1_1_CLASSIFICATION`, pinned by `test_every_unpublished_producible_metric_is_classified_exactly_once`):

| Metric | US | NYSE / NASDAQ | Class | Why |
| --- | --- | --- | --- | --- |
| up/down 20% in 5d, 25% month, 50% month, 25% quarter; 13%/34d up/down | publish | publish | A | Stored by both accepted authorities; UCT's differentiating momentum family |
| new 20-day highs / lows, within 5% of 52w high | publish | publish | A | Stored; standard short-horizon highs/lows |
| Stage 2 / Stage 4 counts | publish | publish | A | Stored; same strict definition as UCT's shipped S2/S4 |
| advancing / declining | publish | already published | A | Stored by US V2 (35 canonical metrics) |
| up_on_volume, down_on_volume, hvc_52w, up_vol_ratio | — | not stored | D | Withheld by the US V2 authority itself (`US_WITHHELD`): only the defective V1 population has them |

Result: US 18 → 35 series, NYSE 20 → 35, NASDAQ 20 → 35. Rollback: `BREADTH_LIBRARY_METRICS=v1`.
No B (redundant) or C (internal) candidates exist outside V1 — `universe_count` (internal-ish) was
already published in V1 and is left unchanged.

## D. Derived ratios (market-indicator rows, `SRC_BREADTH_DERIVED`)

| Id | Formula | Zero / missing | Universes | Inputs (stored) |
| --- | --- | --- | --- | --- |
| `<U>:ADR` A/D Ratio | ADV ÷ DEC | DEC = 0 → hole | US, NYSE, NASDAQ | advancing, declining |
| `<U>:ADP` A/D Percent | (ADV − DEC) ÷ (ADV + DEC) × 100 (unchanged excluded, as MCO/ZBT) | ADV + DEC = 0 → hole | US, NYSE, NASDAQ | advancing, declining |
| `<X>:UNCH` Unchanged Issues | stored `unchanged` | — | NYSE, NASDAQ only (US V2 stores no `unchanged`; it is not UNI − ADV − DEC) | unchanged |
| `<U>:RHP` Record High Percent | NH ÷ (NH + NL) × 100 | NH + NL = 0 → hole | US, NYSE, NASDAQ | new_52w_highs, new_52w_lows |
| `<U>:HLI` High-Low Index | 10-session SMA of RHP; needs 10 defined sessions | any hole in window → hole | US, NYSE, NASDAQ | new_52w_highs, new_52w_lows |

Exchange rows are dormant in the table and published exactly while `breadth_exchange_authority`
serves (the NYMO rule). Deferred: UCT-universe ratios — UCT has no daily ADV/DEC history (15 rows),
and its NH/NL series is served through the collector + V2 overlay rather than the store this
derivation reads, so it is not a straightforward derivation.

## E. Owner handoffs (NOT done here)

### Alerts owner — breadth alerts are accepted and never fire
* **Indicator alerts.** `POST /api/indicator-alerts` (`api/routers/indicator_alerts.py`) accepts any
  symbol. The evaluator reads bars only from `bars_sqlite.get_bars` (`api/services/indicator_alert_evaluator.py`,
  `_sqlite.get_bars(sym.upper(), tf, count)`). Breadth and market-indicator bars are composed per request
  by `/api/bars` (`breadth_symbols.build_breadth_bars`, `market_indicators.series.build_bars`) and are
  never written to that store. Repro: create an indicator alert on `US:A50` (e.g. close crosses 50) →
  it saves, and no evaluation ever finds bars for it.
* **Price alerts.** `price_level_projection` resolves breadth prices through `breadth_symbols.latest_quotes`,
  which serves the UCT universe only. Repro: a price alert on `NYSE:A50`, `US:NETHL` or `NYSE:MCO` saves
  and never evaluates. UCT symbols (`UCTA50`) work. Also: `if px:` treats an exact 0 as missing.
* Ask: either evaluate breadth through the breadth bars door, or refuse creation with a clear message.

### UCT Agent — breadth as read/research capabilities
* The Agent has no breadth tools (only `chart.setSymbol` reaches a breadth symbol). Desired, through
  the Agent's own registry: explain a series (use the library `description`, `universe_description`,
  market-indicator `methodology`), read latest values/history across UCT/US/NYSE/NASDAQ, add a breadth
  series to a chart pane.
* Voice tools (`voice_market_tools.get_breadth_metric`) read UCT only and narrate `series[-1]` as
  "latest" while `get_history` is newest-first — it speaks the OLDEST value.

### Indicator System — typed formulas over namespaced breadth
* `TICKER_SHAPE = /^[A-Z][A-Z0-9.-]{0,9}$/` (`app/src/components/chart/engine/ast/parse.js`) refuses
  `sym('NYSE:ADV', close)`; the widening was deliberately reverted (BL-008: a shape test cannot tell
  `NASDAQ:A50` from `NASDAQ:AAPL`). The correct fix is registry-backed symbol admission in the formula
  canonicaliser — an authoring-architecture change owned by the Indicator System, so not done here.
  Breadth is already usable as an indicator **source** (`sym:NYSE:A50:close` via the source picker) and
  legacy `UCT*` names work in formulas.

### Screener — breadth in scan conditions
* The scan lane admits only the 15 benchmark ETFs (`_benchmarks_scannable`, `api/services/ast_table.py`;
  `assert_scannable`, `api/services/scan_definition.py`). Admitting breadth (a market-context series,
  not a per-stock one) is a screener-semantics decision; handed off.
