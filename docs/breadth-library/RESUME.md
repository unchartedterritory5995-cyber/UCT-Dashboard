# UCT Breadth Library — RESUME / durable handoff

> ⛔ **Not the same programme as `docs/breadth/`.** That ledger belongs to the
> Breadth → Data Charts overhaul on `feat/breadth-charts`. This one is the Breadth
> Library (UNIVERSE × METRIC). Neither touches the other's files.

**PROJECT** UCT Breadth Library
**CURRENT PHASE** Phases 2, 3, 4 complete (+3b, 4b). **STATUS: complete, local, unpushed.**
**BRANCH** `feat/breadth-pit-foundation` · **WORKTREE** `C:\b2` (short path — Windows long-path trap)
**HEAD** `6789ca4ed` · **WORKING TREE** clean
**STARTING MASTER** `5e88b38c4` (2026-09-14 23:24 EDT)
**ORIGIN/MASTER AT CLOSE** `81fd6ede7` — moved **7 commits** overnight (see *Master movement*)
**BASELINE WORKTREE** `C:\b3` (detached at `5e88b38c4`, built, for clean-master comparison)

---

## Product decisions — LOCKED (do not re-derive)

| | |
|---|---|
| Model | **UNIVERSE × METRIC**, one metric engine, many populations |
| UCT | unchanged. Not regenerated, not rewritten; legacy symbols (`UCTA50`…) untouched |
| US | approved back to **2008-01-02** |
| NASDAQ | approved from **2011-01-01**. RED before — do not fabricate |
| NYSE | approved from **2011-01-01**. RED before — do not fabricate |
| Identity | `universe` + `metric` are the truth; the rendered symbol is never parsed to recover them. Aliases are explicit mappings |
| Eligibility | traded on D in grouped-daily ∧ type ∈ {CS, ADRC} ∧ not delisted before D ∧ venue ∈ universe ∧ raw close ≥ $2 ∧ trailing-20d median $-vol ≥ $1M. **No historical market cap** |

Full reasoning and evidence: [`DECISIONS.md`](DECISIONS.md) (BL-001 … BL-008).

---

## Checkpoint commits — LOCAL ONLY, nothing pushed

| Phase | SHA | What |
|---|---|---|
| 2 | `066c0cf1a` | PIT frame + universe-keyed storage foundation |
| 3 | `dd2ed1684` | metric catalogue + colon-safe canonical symbols |
| 4 | `226ca716a` | Net New High-Low + generic signed-histogram presentation |
| 4b | `5604f51ca` | the PIT backfill loop, shipped dark |
| — | `660dd81d1` | reclaim the migration's freed pages (VACUUM) |
| 3b | `2ef8e190d` | the UNIVERSES × METRICS projection, not yet public |
| — | `047eec728` | DECISIONS doc |
| — | `6789ca4ed` | the derived net must be finite or absent |

27 files, +2,964 / −96.

---

## Control results — independent reproduction of Phase 1

Run **offline** (the provider client is replaced with one that raises) against the
durable frame cache, so a cache miss fails loudly rather than computing on a short
frame. Nothing was tuned toward these numbers.

| control | this implementation | Phase 1 | note |
|---|---|---|---|
| US 2015-03-10 A50 | **47.2** | 47.23 | resolved 7,628 / 7,804 — exact |
| US 2008-03-10 A50 | **19.9** | 19.92 | eligible 2,571 vs 2,570 |
| US 2008-10-10 A50 | **1.5** | 1.63 | frame 8,189 / resolved 8,021 — exact |
| NASDAQ 2015-03-10 | **n 1,202 · A50 55.3** | 1,223 · 55.19 | |
| NYSE 2015-03-10 | **n 1,710 · A50 41.9** | 1,707 · 41.83 | |
| US NETHL 2008-10-10 | **−950** | — | 0 highs, 950 lows at the GFC panic low |
| US NETHL 2015-03-09…13 | **+13, −99, −7, +164, +43** | — | signed, both directions |

**Explained difference.** Eligible counts run 0.2–5 % below the Phase-1 probe
because the implementation applies the ACCEPTED rule — trailing 20-day **median**
dollar volume — where the Phase-1 probe used same-day turnover. The gap is widest
at 2008-10-10 (2,508 vs 2,640, −5 %), exactly where it should be: panic volume
inflates same-day turnover. A50 tracks within 0.13 pp regardless, because it is a
proportion.

---

## Tests

| suite | result |
|---|---|
| new backend tests (9 files) | **80 passed** |
| `tests/ -k "breadth or grouped_daily or universe or monitor"` | **899 passed**, 12 skipped |
| frontend `src/components/chart` (348 files) | **8,648 passed**, 3 failed |
| full frontend suite | **20,086 passed**, 12 failed, 12 skipped |
| full backend suite | see *Broad baseline* below |
| frontend build (`npm run build`) | ✅ built in 17.0s, 447 assets |

### Broad baseline comparison

**Frontend: IDENTICAL to clean master, and this one IS a full comparison.** Branch
12 failed / 20,086 passed; baseline (`C:\b3` @ `5e88b38c4`) **12 failed / 20,065
passed** — the same 12 failures in the same 11 files. The +21 passing delta is
exactly this branch's new tests. Pre-existing red (ratchet/rail tests owned
elsewhere): `ChartDrawingOverlay.surfaces`, `ast/manifestProse`,
`ast/pine.blindCorpus`, `screener/reachable`, `hooks/pollingSites.rail`,
`hub/surfaceMatrixIsCurrent`, `ThemeTrackerPage.chartmount`,
`journal-2-0/lib/iteratorGlobalFloor`,
`journal-2-0/lib/offline/supersedeProvesContent`, `styles/tapFloor`,
`surfaces/manifest`.

### ⚠️ Backend: NO full-suite baseline comparison was completed

**State this plainly rather than implying one.** The backend suite is **24,869
tests**. It was started twice and abandoned both times: the first run predated
Phases 3-4, and the second reached ~20 % in 50 minutes, projecting ~4 hours — and a
meaningful comparison needs the *same* run against clean master, so ~8 hours. That
was not a proportionate spend overnight.

What stands in its place, in descending strength:

1. **899 passed** across `-k "breadth or grouped_daily or universe or monitor"` —
   every suite that names a changed module.
2. **80 new tests** over the nine new backend files.
3. **A consumer audit of the one wide-reach change.** `massive.get_grouped_daily_
   ohlcv` has exactly **three** callers outside this branch's own code — all in
   `breadth_pit_calibrate` (lines 32, 98, 197) — and every one reads the row through
   `.get("c")` / `.get("v")`. None enumerates keys, unpacks positionally, or compares
   the whole dict, so adding `o`/`h`/`l` is **purely additive**. Everything else in
   the diff is inside `breadth_*`.

⚠️ **A full backend run needs `app/dist` to exist** — 55 tests import `api.main`,
which mounts `app/dist/assets`. A fresh worktree has no build, and the resulting 55
collection errors are environmental, not a regression. **Build first, then run.**
`C:\b2` and `C:\b3` are both built and ready, so a full both-sides comparison is
now just two long runs away whenever it is wanted.

**New test files:** `test_breadth_universes.py`, `test_breadth_pit_frame.py`,
`test_breadth_universe_storage.py`, `test_breadth_sweep_universe.py`,
`test_grouped_daily_ohlcv.py`, `test_breadth_metrics_catalog.py`,
`test_breadth_net_new_high_low.py`, `test_breadth_universe_backfill.py`,
`test_breadth_library_projection.py`, `namespacedSymbol.test.js`,
`signedHistogram.test.js`.

**Existing tests touched — two, both deliberate:**
- `test_breadth_recon_never_writes_new_ath.py` — stubs now take `**k` so they TRACK
  the real signatures instead of pinning them.
- `symbolSource.test.js` — "a symbol carrying the delimiter cannot round-trip" was
  **inverted**. That claim was a property of the PARSER, not of the symbol, and the
  parser changed.

---

## Migration proof (the highest-risk change)

Synthesised at production scale — 173,937 rows, 4,701 days × 37 metrics:

- **byte-identical**: SHA-256 over every `(date, metric, o, h, l, c, source,
  updated_at)` tuple is the same before and after;
- **0.80s** to migrate, **+0.32s** for the VACUUM;
- file 33.7 MB → 55.6 MB without the VACUUM, **34.4 MB with it** (this DB ships
  whole over R2, so the freelist would have been paid on every transfer);
- **idempotent** — second init 0.001s, no scratch table, indexes rebuilt;
- reads unchanged: `history()` → 4,701 days, `stats()['first']` → 2008-01-02.

---

## Performance (bounded, measured)

| | |
|---|---|
| Frame | 9,417 tickers × 390 sessions = **58.8 MB** numpy, built in **4.2s** |
| Sweep | **0.6s/session** marginal (1.44s/session on a 5-session chunk where the frame is not amortised) |
| Full 3-universe grind | ~**0.5 M rows**, a few hours of compute, ~**9,400 one-time** provider fetches **shared** across all three universes |
| Cached control sweep | 6.6–7.4s for 1 session; 94s when fetching ~405 frames cold |

Practical on the worker. **NOT RUN.**

---

## Master movement overnight

`5e88b38c4` → `81fd6ede7`, 7 commits. **Not chased, per the brief.**

⚠️ One overlaps this branch's files: `465e60d23 feat(breadth): name the cache tier,
and split reconstructed_fetch five ways` (my partner's Data Charts programme)
touches `breadth_daily_ohlc.py` (+51) and `breadth_monitor.py` (+11). It
instruments `reconstructed_for_dates` — a **different region** from this branch's
changes (schema/init, write paths, read scoping), and it reads
`breadth_reconstructed_daily`, which is UCT-only and unaffected by the universe
column. A merge should be clean, but **read it before merging**.

---

## Deliberate non-actions

- ⛔ **`TICKER_SHAPE` (formula lane) NOT widened** — see DECISIONS BL-008. Open
  question for the owner.
- No new public symbols. `/api/breadth-symbols`, `is_breadth_symbol` and the 44 UCT
  symbols are untouched; a rail asserts it.
- No Symbol Search, Chart Data, legend or catalogue changes.
- No full historical grind. Bounded control sweeps only.
- UCT history neither re-run nor rewritten.

---

## Hard stop encountered

**Provider access.** Control sweeps need `MASSIVE_API_KEY`, and the only route was
`railway run --service web`, which the overnight brief forbids. Everything
reproducible from the durable scratchpad cache was completed offline. **A new
historical window needs provider access** and is blocked until the owner authorises
a route.

### Reproducing the controls

The cache is **933 grouped-daily frames (534 MB) + a 3.2 MB reference map** under
`…/scratchpad/breadth_gate/phase2_data/`, with the driver at
`…/scratchpad/breadth_gate/control.py`:

```
python control.py us     2015-03-09 2015-03-13
python control.py us     2008-10-10 2008-10-10
python control.py nasdaq 2015-03-10 2015-03-10
```

It redirects `DATA_DIR` and `BREADTH_OHLC_DB` into the scratchpad and replaces the
provider client with one that RAISES, so a cache miss fails loudly instead of
quietly computing on a short frame.

✅ **Already copied out of the scratchpad** — the scratchpad is session-scoped, and
once cleaned, re-running even an identical control would have needed provider access
again. The durable copy is **`C:\w\breadth-library-cache\`** (933 frames + the
reference map + the driver scripts, 500 MB). Point `DATA_DIR` there to re-run
offline. It is outside the repo and outside `C:\data`, so it touches nothing.

---

## PRODUCTION / SAFETY LEDGER

| | |
|---|---|
| PRODUCTION ACTIONS | **NONE** |
| RAILWAY ACTIONS | **NONE** (after the brief landed) |
| LIVE WEBSITE ACTIONS | **NONE** |
| PRODUCTION DB MUTATIONS | **NONE** — every write went to a scratchpad SQLite file |
| R2 / UPLOADS | **NONE** |
| MAIN TRADING | **UNTOUCHED** |
| FULL HISTORICAL BACKFILL | **NOT RUN** |
| PUSHED / MERGED / REBASED | **NOTHING** — local commits only |
| `:8000` APScheduler window | untouched |
| Track A (pane ordering) | untouched |

---

## EXACT NEXT STEP

**Decide BL-008** — whether a namespaced breadth identity needs a distinct marker
in the formula lane, or whether the roster alone is enough. Everything else in
Phase 5 (publishing the symbols) depends on it, because it decides what
`symbol_for()` renders.

Then, in order: (1) merge master and re-read `465e60d23`; (2) authorise a provider
route and run a **one-year** US sweep to production-shape the store; (3) only then
consider arming `BREADTH_UNIVERSE_BACKFILL_ENABLED`.
