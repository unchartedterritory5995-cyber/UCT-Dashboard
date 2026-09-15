# UCT Breadth Library — RESUME / durable handoff

> ⛔ **Not the same programme as `docs/breadth/`.** That ledger belongs to the
> Breadth → Data Charts overhaul. This one is the Breadth Library
> (UNIVERSE × METRIC). Neither touches the other's files.

**PROJECT** UCT Breadth Library
**CURRENT PHASE** Phase 5 complete (master reconciled · BL-008 implemented ·
catalog + discovery · chart-data seam · cache isolation). **STATUS: complete, local, unpushed.**
**BRANCH** `feat/breadth-pit-foundation` · **WORKTREE** `C:\b2` (short path — Windows long-path trap)
**HEAD** `5bc4aedd6` · **WORKING TREE** clean
**STARTING MASTER** `5e88b38c4` · **RECONCILED TO** `1ceb3c5c2` (merge `cc57099ca`)
**BASELINE WORKTREE** `C:\b3` (detached at `5e88b38c4`, built)

---

## Master reconciliation — DONE

Master moved 11 commits from the Phase-2 start point. **Merged cleanly, no
conflicts** (`cc57099ca`).

**`465e60d23` (partner, Data Charts Session 8) — verdict: A/B, unrelated and
complementary.** It is pure INSTRUMENTATION: `reconstructed_for_dates` splits into
`rf_open`/`rf_pragma`/`rf_execute`/`rf_fetch`/`rf_materialise`, and the
`cache`/`cache_tier` label is corrected in the monitor router. It changes **none**
of the seven areas the brief flags as stop conditions — not canonical dataSeries
identity, discovery catalog semantics, source references, pseudo-symbol handling,
breadth **storage** semantics, signed presentation, or universe identity.

The one interaction worth checking was checked: their reader swapped `with _conn()`
for a raw `sqlite3.connect(_db_path())`, but still calls `_ensure_init()` first, so
this branch's universe migration and VACUUM still run before any read. And it reads
`breadth_reconstructed_daily`, which this branch deliberately kept UCT-only.

**Verified, not assumed:** their own rails (`tests/test_breadth_cache_label.py`,
the real route) pass against the migrated schema.

---

## Product decisions — LOCKED

| | |
|---|---|
| Model | **UNIVERSE × METRIC**, one metric engine, many populations |
| Identity | namespaced (`US:A50`, `NASDAQ:NETHL`), **granted by the REGISTRY, never by syntax** (BL-008) |
| UCT | unchanged. `UCTA50` stays canonical; `UCT:A50` is an explicit one-way alias |
| US | 2008-01-02 · **NASDAQ / NYSE** 2011-01-01 · **UCT** existing behaviour |
| Eligibility | traded on D in grouped-daily ∧ type ∈ {CS, ADRC} ∧ not delisted before D ∧ venue ∈ universe ∧ raw close ≥ $2 ∧ trailing-20d median $-vol ≥ $1M. **No historical market cap** |

Reasoning and evidence: [`DECISIONS.md`](DECISIONS.md), BL-001 … BL-010.

---

## Checkpoint commits — LOCAL ONLY, nothing pushed

| Phase | SHA | |
|---|---|---|
| 2 | `066c0cf1a` | PIT frame + universe-keyed storage |
| 3 | `dd2ed1684` | metric catalogue + colon-safe canonical symbols |
| 4 | `226ca716a` | Net New High-Low + generic signed histogram |
| 4b | `5604f51ca` | dark PIT backfill loop |
| — | `660dd81d1` | VACUUM after migration |
| 3b | `2ef8e190d` | UNIVERSES × METRICS projection |
| — | `047eec728` · `efa61c9d2` · `95480e6b4` · `7533f4f6e` · `16841ea93` | docs / ledger |
| — | `6789ca4ed` | derived net must be finite or absent |
| **5** | **`cc57099ca`** | **merge origin/master — reconciliation verdict** |
| **5** | **`fb3301e7d`** | **BL-008 — the registry decides membership** |
| **5** | **`2165be8e1`** | **discovery — metric first, universe second** |
| **5** | **`f52a9ac0e`** | **a library identity is an ordinary data series** |
| **5** | **`efd814f5f`** | **dedicated breadth cache (§15)** |

---

## BL-008 as implemented

- **`breadth_symbols.resolve()`** is the membership authority — a dict lookup
  against identities minted from `breadth_universes` × `breadth_metrics`.
  `NASDAQ:AAPL`, `FOO:BAR`, `US:NOPE`, `NASDAQ:A999` return None at **every**
  setting of every flag.
- ⛔ **`TICKER_SHAPE` stays reverted.** A shape test cannot tell `NASDAQ:A50` from
  `NASDAQ:AAPL`; a registry can. Nothing in `breadth_symbols` splits on `":"`.
- **Source grammar ≠ symbol validity.** `sourceRef.js` structurally carries
  `sym:NASDAQ:A50:close` (split on the LAST colon); whether the symbol EXISTS is
  the registry's answer. Rails pin both halves.
- **`library_aliases()`** is an explicit table: `UCT:A50` → `UCTA50`, one direction.
- **`published_universe_ids()`** keeps the library dark; `BREADTH_LIBRARY_UNIVERSES`
  publishes (default UCT only, `*` for all). A typo'd flag cannot take the shipped
  44 off the air, and UCT is served from the `SYMBOLS` fast path first and
  unconditionally.

## Catalog + discovery

`library_rows()` (156 identities) → `library_search()`. Every query shape in the
brief has a rail: `"50 MA"`, `"above 50"`, `"A50"`, `"NASDAQ breadth"`, `"NASDAQ"`,
`"high low"`, `"NASDAQ:A50"`, `"US:NETHL"`, `"NASDAQ:AAPL"` → nothing.

⭐ Sorted **(score, METRIC, universe)** so one metric appears with its universe
variants adjacent — the owner's "human metric first, universe second" as a sort
rather than a later grouping pass. Sorting by universe first produced the
ticker-soup list the library exists to replace, and a rail caught it.

## Chart-data seam

A library row reaches the chart through the SAME `discoveryCatalog` → `dataSeries`
path a security uses. `breadthResults` needed **no new branch** for colon symbols.
`shortName` becomes the universe badge (`UCT` / `US` / `NASDAQ` / `NYSE`), so a
multi-series pane reads the metric once and the universes beneath it.
`presentationFor()` maps catalogue metadata to the instance presentation — the
renderer never learns `US:NETHL` is special.

---

## Tests

| suite | result |
|---|---|
| all breadth / universe / monitor backend | **969 passed**, 12 skipped |
| new Phase-5 backend rails (identity · serve · discovery) | **39 passed** |
| frontend `src/components/chart` (349 files) | **8,659 passed**, 3 failed |
| new frontend seam rails | **11 passed** |
| build (`npm run build`) | ✅ 14.9s, 447 assets, 0 errors |

The 3 frontend failures are the **pre-existing clean-master ratchet failures**
(`ChartDrawingOverlay.surfaces`, `ast/manifestProse`, `ast/pine.blindCorpus`),
verified against `C:\b3` @ `5e88b38c4`.

### ⚠️ Backend full-suite baseline: STILL NOT RUN — a pre-publication gate

24,869 tests; ~4 h per side, ~8 h for a both-sides comparison. §21 explicitly
directs proportional verification instead, and that is what was done. Standing in
its place: the 969-test breadth slice, 39 new backend rails, and — for the one
shared API with wide blast radius — a **consumer audit**:
`massive.get_grouped_daily_ohlcv` has exactly three callers outside this branch
(all in `breadth_pit_calibrate`), every one reading the row via `.get("c")` /
`.get("v")`, so the added `o`/`h`/`l` keys are provably additive.

**This remains a gate before publication or deployment.** Both worktrees are built,
so it is two long runs away whenever wanted.

---

## Status flags

| | |
|---|---|
| CATALOG | **dark / local.** `/api/breadth-symbols` unchanged (44 rows, no colon); `search()` emits no colon; rails assert both |
| PROVIDER | **cache only.** No `railway run`, no credentials sought. Durable 933-frame cache at `C:\w\breadth-library-cache\` |
| BACKFILL | **dark, NOT ARMED.** `BREADTH_UNIVERSE_BACKFILL_ENABLED` untouched |
| PRODUCTION / RAILWAY / R2 / LIVE SITE / MAIN TRADING | **UNTOUCHED** |
| FULL HISTORICAL GRIND | **NOT RUN** |
| PUSHED / MERGED TO MASTER / DEPLOYED | **NOTHING** |

---

## Known gap, stated rather than hidden

**`warm_breadth()` is UCT-only.** It walks the 44 shipped symbols and reads its
"latest sealed day" from the collector, so a **published** PIT universe would not be
pre-warmed and its first request per symbol would pay a cold build of seconds.

Not extended, deliberately: a per-universe sealed-date probe plus a throttle proven
safe across four universes is a judgement about pod CPU, and this loop's own history
is a starvation incident. It is **inert while the library is dark**.
`test_the_warm_loop_is_uct_only_and_that_is_recorded` pins it so the gap cannot
become invisible — and the rail's failure message says what to do if someone
legitimately widens it.

**Design this before publishing any universe.**

---

## Deferred product decisions

1. **Final V1 metric subset.** The architecture supports all ~30 portable metrics;
   nothing hard-codes a V1 list. Choosing one changes no identity or storage.
2. **Publishing a universe.** Flipping `BREADTH_LIBRARY_UNIVERSES` is the switch,
   but a universe should have DATA first — which needs the grind, which needs
   authorisation.
3. **Symbol Search visual redesign.** Deliberately not attempted; the model is
   proven by `library_search` + rails, with no UX change.
4. **Production cache topology / routing.** Isolation only was done. Moving breadth
   to bars-api or adding CDN rules has more than one valid answer.
5. **Whether UCT history is ever re-run.** Untouched, and Phase 1 measured the
   survivorship effect as small and SIGN-VARYING (≤1.6 pp), which lowers the case.

---

## EXACT NEXT STEP

**Authorise a provider route and run a ONE-YEAR US control sweep** (e.g. 2015) to
production-shape the store, then read `stats('us')` and a few series before
considering the full grind. Everything below that is built, dark and tested; the
only thing missing is data, and data needs the provider.

### Reproducing the offline controls

Durable cache at **`C:\w\breadth-library-cache\`** (933 frames + reference map +
drivers). Point `DATA_DIR` there and run `control.py <universe> <from> <to>`; the
provider client is replaced with one that RAISES, so a cache miss fails loudly
instead of computing on a short frame.
