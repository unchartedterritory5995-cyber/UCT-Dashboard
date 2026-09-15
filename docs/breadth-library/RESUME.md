# UCT Breadth Library — RESUME / durable handoff

> ⛔ **Not the same programme as `docs/breadth/`.** That ledger belongs to the
> Breadth → Data Charts overhaul on `feat/breadth-charts`. This one is the Breadth
> Library (UNIVERSE × METRIC). Neither touches the other's files.

**PROJECT** UCT Breadth Library
**BRANCH** `feat/breadth-pit-foundation` · **WORKTREE** `C:\b2` (short path, Windows long-path trap)
**STARTING MASTER** `5e88b38c4` (origin/master @ 2026-09-14 23:24 EDT)
**BASELINE WORKTREE** `C:\b3` (detached at `5e88b38c4`, for clean-master test comparison)

---

## Product decisions — LOCKED (do not re-derive)

| | |
|---|---|
| Model | **UNIVERSE × METRIC**, one metric engine, many populations |
| UCT | unchanged. Not regenerated, not rewritten, legacy symbols (`UCTA50`…) untouched |
| US | approved back to **2008-01-02** |
| NASDAQ | approved from **2011-01-01**. RED before — do not fabricate |
| NYSE | approved from **2011-01-01**. RED before — do not fabricate |
| Identity | `universe` + `metric` are the metadata truth; the rendered symbol is never parsed to recover them. Aliases are explicit mappings |
| Eligibility | traded on D in grouped-daily ∧ type ∈ {CS, ADRC} ∧ not delisted before D ∧ venue ∈ universe ∧ raw close ≥ $2 ∧ trailing-20d median $-vol ≥ $1M. **No historical market cap** |

**Why 2011 for the exchange universes** (the finding the whole floor rests on):
the provider carries **no Nasdaq exchange attribution before 2011**. Measured
2026-09-14 — `/v3/reference/tickers/{t}?date=` returns no `primary_exchange` for
MSFT/INTC/AAPL/CSCO/AMGN at `2010-01-04` and `2010-07-01`, and `XNAS` for all five
at `2011-01-03`; delisted CS/ADRC records show a **0.0 % Nasdaq share for every
year 2004-2010**, 26.8 % in 2016, 60-80 % after. Unattributed Nasdaq names fall
through to `XNYS`, so a pre-2011 "NYSE" series would not be NYSE. Percentages move
≤0.8 pp under this; **counts move ≈ +22 % NASDAQ / −12 % NYSE**, and Net New
High-Low is a count. Encoded in `breadth_universes.HISTORY_FLOOR`.

---

## Checkpoint commits (local only — nothing pushed)

| Phase | SHA | What |
|---|---|---|
| 2 | `066c0cf1a` | PIT frame + universe-keyed storage foundation |
| 3 | `dd2ed1684` | metric catalogue + colon-safe canonical symbols |
| 4 | `226ca716a` | Net New High-Low + generic signed-histogram presentation |

---

## What each phase actually did

### Phase 2 — foundation
- `api/services/breadth_universes.py` **(new)** — registry: venue sets, floors,
  `is_pit`, `sweepable_range` (**refuses**, never clamps, so a downward backfill
  cannot silently stall). Unknown id raises rather than defaulting to UCT.
- `api/services/breadth_pit_frame.py` **(new)** — `reference_map`, `resolve`,
  `eligible_on`, `build_frame`. Historical existence comes from grouped-daily;
  reference metadata only CLASSIFIES. Unresolved names excluded **and counted**
  (`coverage`: frame / resolved / unresolved / eligible / coverage_ratio).
- `massive.get_grouped_daily_ohlcv` — keeps full OHLCV (was close+volume only) and
  gains a durable settled-day disk tier at `$DATA_DIR/grouped_ohlcv`.
- `breadth_daily_ohlc` — `(date, metric)` → `(universe, date, metric)`. SQLite
  cannot alter a PK, so `_migrate_universe_column` rebuilds the table, copying
  columns and inventing nothing; every legacy row becomes `universe='uct'`,
  byte-identical. Indexes lead with `universe`. `stats()` stays UCT-scoped (so
  `/ohlc/status` and `backfill_tick`'s `first` are unchanged) and gains
  `by_universe` beside it.
- `breadth_ohlc_sync` — the R2 merge carries `universe` in the join AND the
  conflict target, tolerating a pre-migration snapshot via a `PRAGMA table_info`
  probe. Without this a US row and a UCT row for one date+metric were the same row.
- `sweep_history(universe=…)` — swaps the FRAME only. The per-date member set
  reaches the engine through `prices` alone; `compute_metrics` masks on
  `have = ~isnan(px)`, so it never learns universes exist. `recompute_from_frame`
  gained `members=`.

### Phase 3 — identity
- `api/services/breadth_metrics.py` **(new)** — 43 metrics with unit, domain,
  presentation, portability + `applies_to` / `metrics_for`. UCT keeps everything;
  a PIT universe gets the portable set (surveys, ETF pair ratios, the proprietary
  composite and `new_ath` stay UCT-only).
- `sourceRef.js` — `parseSource` splits on the **LAST** colon; `canonicalSymbol`
  accepts colons. Fixes `$IDX:<slug>` as a chart source too (it charted fine but
  could never be a source). Still refuses leading/trailing colon, `::`, whitespace.
- `CompareSymbolsPanel.jsx` — stopped stripping `:` / `$` (turned `$IDX:AI` into
  `IDXAI` and drew nothing).

### Phase 4 — the signed metric
- `breadth_monitor._net_new_high_low` — ONE function, called from
  `_derive_ascending` (stored + reconstructed) **and** `derive_live_row`
  (intraday). `None` when either side is missing.
- `presentation.js` — `resolveSignColors` + `presentedPlot` stamps
  `colorMode/colorUp/colorDown`, so sign colouring is an INSTANCE capability, not
  a definition privilege. No renderer, binder or pool change. Histogram only.
  ⚰️ Fixed: `presentedPlot` returned early when only the style was unchanged, so
  enabling sign colours on an already-histogram output did nothing.

---

## Control results — independent reproduction of Phase 1

Run **offline** (provider client replaced with one that raises) against the
durable frame cache, so a cache miss fails loudly instead of computing on a short
frame.

| control | this implementation | Phase 1 | note |
|---|---|---|---|
| US 2015-03-10 A50 | **47.2** | 47.23 | resolved 7,628 / 7,804 — exact match |
| US 2008-03-10 A50 | **19.9** | 19.92 | eligible 2,571 vs 2,570 |
| US 2008-10-10 A50 | **1.5** | 1.63 | frame 8,189 / resolved 8,021 — exact match |
| NASDAQ 2015-03-10 | **n 1,202 · A50 55.3** | 1,223 · 55.19 | |
| NYSE 2015-03-10 | **n 1,710 · A50 41.9** | 1,707 · 41.83 | |
| US NETHL 2008-10-10 | **−950** | — | 0 highs, 950 lows at the GFC panic low |
| US NETHL 2015-03-09…13 | **+13, −99, −7, +164, +43** | — | signed, both directions |

**Explained differences.** Eligible counts run 0.2–5 % below the Phase-1 probe
because the implementation applies the ACCEPTED rule — trailing 20-day **median**
dollar volume — where the Phase-1 probe used same-day turnover. The gap is widest
at 2008-10-10 (2,508 vs 2,640, −5 %), which is exactly where it should be: panic
volume inflates same-day turnover. A50 tracks within 0.13 pp regardless, because
it is a proportion. Nothing was tuned toward the Phase-1 numbers.

---

## Tests

| suite | result |
|---|---|
| `tests/ -k "breadth or grouped_daily or universe or monitor"` | **899 passed**, 12 skipped |
| `tests/test_breadth_metrics_catalog.py` + `test_breadth_net_new_high_low.py` | 17 passed |
| frontend `src/components/chart` (348 files) | **8,648 passed**, 3 failed |
| frontend `namespacedSymbol` + `symbolSource` + `sym.shape` | 41 passed |
| frontend `signedHistogram` | 11 passed |

**Broad baseline comparison.** The 3 frontend failures are **pre-existing on clean
master** — verified by running the same files in the `C:\b3` baseline worktree at
`5e88b38c4`: `ChartDrawingOverlay.surfaces`, `ast/manifestProse`,
`ast/pine.blindCorpus` (ratchet tests). Identical set before and after.

**New test files:** `test_breadth_universes.py`, `test_breadth_pit_frame.py`,
`test_breadth_universe_storage.py`, `test_breadth_sweep_universe.py`,
`test_grouped_daily_ohlcv.py`, `test_breadth_metrics_catalog.py`,
`test_breadth_net_new_high_low.py`, `namespacedSymbol.test.js`,
`signedHistogram.test.js`.

**One existing test adapted:** `test_breadth_recon_never_writes_new_ath.py` stubs
`recompute_from_frame` / `write_bulk` with `**k` so it tracks the real signatures
instead of pinning them. **One existing test inverted deliberately:**
`symbolSource.test.js` "a symbol carrying the delimiter cannot round-trip" — that
claim was a property of the PARSER, not of the symbol, and the parser changed.

---

## Deliberate non-actions

- ⛔ **`TICKER_SHAPE` (formula lane) NOT widened.** `NASDAQ:A50` and `NASDAQ:AAPL`
  are indistinguishable by shape, and the roster gate that would catch a bad one
  covers SCANS only. Needs a namespace decision from the owner. Recorded in
  `namespacedSymbol.test.js`.
- No new public symbols. `/api/breadth-symbols`, `is_breadth_symbol` and the 44
  UCT symbols are untouched.
- No Symbol Search, Chart Data, legend or catalogue changes.
- No full historical grind. Bounded control sweeps only.

---

## Hard-stop encountered

**Provider access.** Control sweeps need `MASSIVE_API_KEY`. The only route was
`railway run --service web`, which the overnight brief forbids. Everything
reproducible from the **durable scratchpad cache** (933 grouped-daily frames +
the reference map, under
`…/scratchpad/breadth_gate/phase2_data/`) was completed offline. **A new
historical window would need provider access and is therefore blocked** until the
owner authorises a route.

---

## PRODUCTION / SAFETY LEDGER

| | |
|---|---|
| PRODUCTION ACTIONS | **NONE** |
| RAILWAY ACTIONS | **NONE** (after the brief landed) |
| LIVE WEBSITE ACTIONS | **NONE** |
| PRODUCTION DB MUTATIONS | **NONE** — all writes went to a scratchpad SQLite file |
| R2 / UPLOADS | **NONE** |
| MAIN TRADING | **UNTOUCHED** |
| FULL HISTORICAL BACKFILL | **NOT RUN** |
| PUSHED | **NOTHING** — local commits only |
| `:8000` APScheduler window | untouched |
