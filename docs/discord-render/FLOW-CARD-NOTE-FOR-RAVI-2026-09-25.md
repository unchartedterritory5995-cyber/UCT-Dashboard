# For Ravi: changes to your flow files for the Discord `/flow` card (2026-09-24/25)

Patrick asked for the Discord `/flow` card to never answer blank and to read flow the way the
Options Flow page does. That work touched three of your files. Everything is additive, railed,
and the one behaviour change that affects your page is described first.

## What changed in your files

### `api/live_massive_router.py`

1. **Single-ticker floors** (`_build_by_contract`, `only_ticker` path only). A single-name lookup
   uses the permissive cap band on both axes (cap and source), because the market-wide floors
   ($1M per contract per day on a mega cap, $250K per print, index floors on ETFs) made `/flow
   DELL` blank on a $120M day and `/flow IWM` read BEAR when your page read BULL. **Market-wide
   callers are unchanged**, and a control rail proves it.
2. **Widen ladder** (`_compute_ticker_flow(widen=True)`, `/ticker-flow?widen=1`). Opt-in: when the
   window is empty the card climbs 1 → 5 → 20 → all days and says so. The research tab does not
   set it.
3. **Two query fixes.** `_flow_dates_all()` caches the all-source `SELECT DISTINCT CreatedDate`
   (2.0 s in the pod, ran on every single-ticker call) for 60 s, keyed by `DB_PATH`.
   `_contract_has_sweep_map` predicates on `+Symbol=?` so SQLite takes the date index instead of
   walking the symbol's history through `idx_flow_contract` (SPY 4.2 s → 174 ms). The same
   seduction is already documented in `api/flow_worker_main.py`.

### `api/flow_db.py`

`stream_csv_symbol(..., dates=None)` — an optional `CreatedDate` filter. `None` is every date, so
every existing caller, including your search build, sees the identical call.

### `api/flow_router.py`

`GET /api/flow/ticker-product/{symbol}?window_days=N` — the **same** `flow-facts search`
derivation over the last N **market** sessions (your `availableDates` calendar via
`db.get_available_dates`, cached 60 s), the same "Last N" your `_scopeAllDirectional` uses. It lives in its own function
(`_windowed_ticker_product`), has its own cache key `(sym, src, version, "wN")`, takes the same
single-flight build lane, and answers `window_dates`. **Your page never sends `window_days`, so
its path is byte-identical**; your `test_flow_search_warm` and `test_flow_search_budget` rails
pass unchanged.

⚠️ One thing you should know: while building this, the route decorator briefly sat on the new
helper instead of the handler. It was caught before any deploy (your two rails above caught it;
mine did not), and there is now a rail that resolves the route through FastAPI.

## What reads your derivation now (dark)

`api/services/flow_card_from_page.py` turns the windowed product into the card: it scopes rows to
the window the way your Search block's `_scopeAllDirectional` does, re-sums per contract the way
`_scopedByContract` does, and renames fields. **It does not re-implement `processFlowData`.**
Moneyness is computed the card's way (signed) from strike and spot, because `pctFromSpot` is an
unsigned distance.

It is **off** until `DISCORD_FLOW_CARD_PAGE_ENABLED=1` is set on web. With it off, the card is
the rollup members have had since 9/24.

## What we'd like from you

1. A look at the windowed endpoint: is a per-request windowed derivation on flow-worker
   acceptable load? It is bounded by your search lane and cached per `(sym, version, window)`.
2. Whether the card may show your numbers verbatim (the flip).
3. The residual measurement (page full vs page windowed, 20 names) is in
   `docs/discord-render/evidence/flow-parity/` next to this note.

Decision packet: `docs/discord-render/FLOW-CARD-SOURCE-DECISION-2026-09-25.md`.
