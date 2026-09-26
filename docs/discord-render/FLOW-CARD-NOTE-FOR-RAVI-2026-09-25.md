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

⚠️ **One change your Search build does see, and it is byte-identical by measurement:** the unfiltered
query now ends `ORDER BY CreatedDate, rowid`. That is the order it already returned. The plan is
`idx_flow_symbol_created (Symbol=?)`, the index satisfies the ORDER BY without a sort, and the output
sha is unchanged for SMH, DELL and AMD (measured in the pod 2026-09-25). It is now stated instead of
left to the planner because the card's per-date read has to reproduce it exactly.

Why it matters: `processFlowData`'s ML/ volume match (`mlMatched` in `flowCompute.js`) removes the
FIRST unmatched non-ML print with the same symbol/CP/strike/expiry/volume, and the key carries no
date. So your page's answer depends on row order, and that order is CreatedDate as TEXT
('10/1/2026' before '9/30/2026'), not chronological. Over identical AMD rows, a chronological order
moved 9/25's bear premium from $1,530,486 to $1,747,710. This is not a bug report: it is your rule,
and the card now reproduces its input order exactly. But if cross-date ML matching is not intended,
it is worth a look, because it means a print on one day can be removed by an ML/ print from another
day.

### `api/flow_router.py`

`GET /api/flow/ticker-product/{symbol}?basis_rows=N` (what the card uses) and `?window_days=N`
(the parity tool) — the **same** `flow-facts search`
derivation over the last N **market** sessions (your `availableDates` calendar via
`db.get_available_dates`, cached 60 s), the same "Last N" your `_scopeAllDirectional` uses. It lives in its own function
(`_windowed_ticker_product`), has its own cache key `(sym, src, version, "wN")`, takes the same
single-flight build lane, and answers `window_dates`. **Your page never sends `window_days`, so
its path is byte-identical**; your `test_flow_search_warm` and `test_flow_search_budget` rails
pass unchanged.

⚠️ One thing you should know: while building this, the route decorator briefly sat on the new
helper instead of the handler. It was caught before any deploy (your two rails above caught it;
mine did not), and there is now a rail that resolves the route through FastAPI.

## One measured recommendation for your code (not changed)

`flow_db.get_available_dates(source)` runs `SELECT DISTINCT CreatedDate FROM flow WHERE source = ?`,
which reads every entry of the date index to produce ~180 values. In the flow-worker pod
(2026-09-25, warm cache) that is **1,335 ms for `indexes` and 1,971 ms for `stocks`**; on a
freshly booted pod the `indexes` call took **~47 s**. A loose index scan returns the **identical**
list (178/178 and 182/182) in **1.8 ms**:

```sql
WITH RECURSIVE d(x) AS (
  SELECT MIN(CreatedDate) FROM flow WHERE source = ?1
  UNION ALL SELECT (SELECT MIN(CreatedDate) FROM flow WHERE source = ?1 AND CreatedDate > d.x)
  FROM d WHERE d.x IS NOT NULL)
SELECT x FROM d WHERE x IS NOT NULL
```

The card's own paths now use this (`_flow_dates_all`, `_market_dates`).

A second one: on a freshly booted pod your full-history Search build is disk-bound on OLD sessions.
`DELL/stocks warm TOO_BIG total=22544ms :: ... rows=8001` (23:25 UTC 9/25, four minutes after a deploy):
8,001 rows in 22.5 s, streamed oldest first, then declined. Recent sessions stay hot. The card's basis
path reads newest-first under a budget for exactly this reason (`_read_basis_newest_first`); your
Search build could do the same, or keep its all-or-nothing contract and accept declines after deploys. Your page's `/api/flow/dates`
and `/live-massive` would get the same win on their first load after a flow-worker deploy.

Why `basis_rows`: your derivation sets direction from contract-level totals across every row it
is given, so the card derives over the symbol's WHOLE stored history whenever it fits 250K rows
(exact match with your full product, measured) and over the newest sessions that fit otherwise.
It was 150K until the evening of 9/25, when AMD's 150K basis read BULL for the day and your full
product read BEAR. A card build holds one of your two Search lanes for up to about 20 s (AMD), so
under load your members' cold Search builds may see "busy" a little more often. Tell us if that is a
problem and the cap comes down.
Row counts come from a covering read of `idx_flow_symbol_created`; the stream is one
`CreatedDate = ?` query per session on `idx_flow_created_symbol`.

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
