# Lane O: options analytics remainders (TERMINAL-NEXT scope audit, section 2)

Branch `lane/o-options-remainders`. Every surface is dark behind its OWN switch in
`api/services/options_analytics/flags.py` (ledger: `docs/feature_flags.json`, all `pending`).
Unset = the route answers 404 before identity is read and the panel renders nothing; set = paid.

| Row | Route(s) | Switch | Where it shows |
|---|---|---|---|
| FT-001 today-at-IV + PoP | `GET /api/research/options/{sym}/payoff-model` (model words; maths in `chainModels.js`) | `OPTIONS_PAYOFF_TODAY_ENABLED` | Research > Options, payoff panel: dashed "today" curve, PoP at expiry, price-slice table |
| FT-011 earnings-anchored backtest + 8 structures | `GET /api/research/options/{sym}/backtest-catalog`; `POST .../backtest` accepts `anchor=earnings` | `OPTIONS_BACKTEST_MORE_ENABLED` (+ chain + backtest switches) | Research > Options, Backtest panel |
| FT-012 theoretical-value edge | `GET /api/research/options/{sym}/edge` | `OPTIONS_EDGE_RANKING_ENABLED` | Research > Options, `EdgePanel` |
| FT-014 strategy finder | `GET /api/research/options/{sym}/strategy-finder` (model words; candidates in `chainModels.js`) | `OPTIONS_STRATEGY_FINDER_ENABLED` | Research > Options, `StrategyFinder` |
| FT-015 rho / lambda / epsilon + calls/puts | `GET /api/research/options/{sym}/chain-greeks` | `OPTIONS_CHAIN_FULL_GREEKS_ENABLED` | Research > Options chain: three computed columns + Calls/Puts/Both |
| FT-018 RR/BF tenor table | `GET /api/options/vol/{sym}/rr-bf` | `OPTIONS_VOL_RR_BF_ENABLED` | Research > Options, `RrBfTable` |
| FT-018 3D surface | `GET /api/options/vol/{sym}/surface-3d` | `OPTIONS_VOL_SURFACE_3D_ENABLED` | Research > Options, `Surface3D` (plain SVG, no new dependency) |
| FT-049 delta pressure | `GET /api/options/positioning/{sym}/delta-heatmap` | `OPTIONS_DELTA_PRESSURE_ENABLED` | Research > Options, positioning blocks |
| FT-049 charm | `GET /api/options/positioning/{sym}/charm-heatmap` | `OPTIONS_CHARM_HEATMAP_ENABLED` | Research > Options, positioning blocks |
| FT-056 per-sector tide | `GET /api/options/market-tide/sectors` | `OPTIONS_SECTOR_TIDE_ENABLED` | Options Flow, under Market Tide |
| FT-057 tide click-through | `GET /api/options/market-tide/minute[?t=HH:MM]` | `OPTIONS_TIDE_CLICKTHROUGH_ENABLED` | Options Flow: click the tide, or pick a minute |
| FT-072 Spread Book | `GET/POST /api/options/spread-book`, `DELETE .../{id}` | `OPTIONS_SPREAD_BOOK_ENABLED` | Research > Options: Save on finder rows, book listed below |
| FT-073 remaining screens | `GET /api/options-screener/more-strategies`, `/more/{call_butterflies,by_expiration,block_trades}` | `OPTIONS_MORE_STRATEGY_SCREENS_ENABLED` | Options Flow, beside the strategy screens |
| FT-075 Sizzle 5-day | `GET /api/options-screener/sizzle` | `OPTIONS_SIZZLE_ENABLED` | Options Flow, beside the strategy screens |

Member data: `options_spread_book` (auth.db, `user_id`) is in `account_purge._DIRECT_USER_TABLES`;
`docs/account-deletion-manifest.md` is regenerated from it.

## History is thin

The options log began 2026-09-30. FT-012 states the sessions it holds (n) and does not rank by win
rate until 60; FT-075 ranks only with 5 prior sessions and states n and the first date a ratio can
exist. FT-011's earnings prints come from FMP, which often carries no AMC/BMO time: those prints are
excluded and counted, never guessed.

## Open (not built in this lane)

- FT-054 "positions N minutes ago": needs a durable intraday per-strike exposure store on flow-worker.
- Options-flow export: served from flow-worker.
- FT-015 streamed chain: needs a new Massive option-quote socket; the chain still polls every 60 s.
- FT-049 forward projection and 1-minute refresh: the heatmaps read the 60 s chain cache.
- FT-073 multi-leg trades: the tape carries no multi-leg flag (condition codes live on flow-worker).
- FT-011: a live run against our FMP key before arming is owed (rails are recorded fixtures only).
