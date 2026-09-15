# UCT Breadth Library — RESUME / durable handoff

> ⛔ **Not the same programme as `docs/breadth/`.** That ledger belongs to the
> Breadth → Data Charts overhaul. This one is the Breadth Library
> (UNIVERSE × METRIC). Neither touches the other's files.

**PROJECT** UCT Breadth Library
**CURRENT PHASE** Phase 7 complete — the user-facing Breadth Library UX
(catalogue payload · metric-first ranking · the reading order in the real control ·
browser proof). **STATUS: complete, local, unpushed, nothing published.**
**BRANCH** `feat/breadth-pit-foundation` · **WORKTREE** `C:\b2` (short path — Windows long-path trap)
**HEAD** see the Phase-7 table below · **WORKING TREE** clean
**STARTING MASTER** `5e88b38c4` · **RECONCILED TO** `8578d375d` (merges `cc57099ca`, `bd5a1b9`-era)
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
| all breadth / universe / monitor backend | **972 passed**, 12 skipped |
| new Phase-5 backend rails (identity · serve · discovery) | **44 passed** |
| frontend `src/components/chart` (349 files) | **8,659 passed**, 3 failed |
| **full frontend suite** (1,361 files) | **20,102 passed**, 10 failed, 9 skipped |
| new frontend seam rails | **11 passed** |
| build (`npm run build`) | 14.9s, 447 assets, 0 errors |

### Frontend baseline comparison — BETTER than clean master

| | files failing | tests failing | tests passing |
|---|---|---|---|
| this branch | 13 | **10** | **20,102** |
| clean master `5e88b38c4` | 15 | 12 | 20,065 |

**Every file failing here also fails on clean master — zero new failures.** Two
baseline failures are RESOLVED by the master merge this branch took in
(`journal-2-0/lib/iteratorGlobalFloor`, `journal-2-0/lib/offline/supersedeProvesContent`).
The rest are the standing ratchet/rail tests owned elsewhere.

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

## Phase 6 — bounded US control sweep (2026-09-15)

### ⚠️ SCOPE: 5 sessions, not the year. BLOCKED on provider access.

The objective was calendar-2015. **It could not be met**, and the reason is precise
rather than general: the durable cache holds **925 ADJUSTED frames but only 8 RAW
frames**. Eligibility reads the RAW frame (the point-in-time $2 floor means the
price people actually paid), so the achievable window is exactly the dates with a
raw frame: **2015-03-09 … 2015-03-13**.

**Provider routes investigated, all refused by the brief or absent:**

| route | status |
|---|---|
| `railway run` | FORBIDDEN by §2 |
| local `.env` (the documented dev path — `CLAUDE.md:3364`) | **does not exist on this machine** |
| `MASSIVE_API_KEY` in the environment | not set |
| local dev backend on `:8000` | **running (HTTP 200)**, but exposes no grouped-daily endpoint, and adding one or restarting it is forbidden |

**Missing capability, exactly:** a `MASSIVE_API_KEY` readable by a local process,
to fetch ~245 RAW grouped-daily frames for 2015 (the adjusted ones are already
cached). Creating `.env` with that key is the whole unblock.

### What the 5-session control DID prove

| check | result |
|---|---|
| §10 anchor — 2015-03-10 US A50 | **47.20** vs Phase-1/2 **47.23** |
| §9 NETHL identity (NH − NL) | 5 dates checked, **0 mismatches** |
| §12 percentage domain | 45 values, **0** outside 0-100 |
| §13 count ≤ universe | 100 values, **0** violations |
| §11 duplicates / NaN / source | **0** duplicate keys, **0** NaN, all `close_recon` |
| §14 OHLC geometry | **0** violations; close-to-close body PRESERVED |
| §15 UCT preservation | fingerprint **identical** |
| §16 resume equivalence | interrupted+resumed output **canonically identical** row-by-row |
| §17 idempotency | 200 → 200 rows, values unchanged, other universes untouched |
| §17 degenerate window | still reports complete/exhausted, never spins |
| §19 cache reuse | 3 passes, **0 network fetches**; durable tier serves after memory is cleared |
| §20 breadth cache isolation | 1 series in the dedicated instance, **0** in the shared one |

**Two real defects found and fixed** — see `d602865eb`: a failed RAW fetch was
indistinguishable from a quiet day (a 48-session request silently produced 5), and
`breadth_score` leaked into US (UCT's sentiment+VIX composite evaluated over a row
without those inputs).

### §18 performance (measured, 5 sessions)

| | |
|---|---|
| frame | 9,251 tickers × 333 sessions = **49.3 MB** numpy, built in 2.4-2.5 s |
| sweep | **0.83-1.21 s/session** (frame amortised over 5; a real chunk amortises further) |
| storage | ~**20 bytes/row** in SQLite; 40 metrics/session |
| provider | 352 reads, 338 from durable cache, 14 empty, **0 network** |

**Rough extrapolation** (assumes frames already cached, ~250 sessions/yr, 40
metrics/session; frame cost amortises over a 365-day chunk so the marginal rate
dominates):

| grind | sessions | rows | compute @0.83 s |
|---|---|---|---|
| US 2008→now | ~4,450 | ~178 k | ~1.0 h |
| NASDAQ 2011→now | ~3,700 | ~148 k | ~0.9 h |
| NYSE 2011→now | ~3,700 | ~148 k | ~0.9 h |
| **total** | ~11,850 | **~474 k rows (~10 MB)** | **~3 h** |

⚠️ Plus a one-time fetch of ~4,450 × 2 ≈ **8,900 grouped-daily frames**, shared
across all three universes. That fetch, not the compute, is the long pole.

---

## EXACT NEXT STEP

**Create a local `.env` with `MASSIVE_API_KEY`** (the documented dev path this repo
already expects — `CLAUDE.md:3364`), then re-run the Phase-6 control over calendar
2015. That single step converts a 5-session proof into the full-year proof the
gate asked for, and it is the ONLY thing standing between here and a grind decision.

Everything else is built, dark, tested and measured. The pipeline, the invariants,
resume, idempotency, cache reuse and isolation are all proven; only the data volume
is missing.

### Reproducing the offline controls

Durable cache at **`C:\w\breadth-library-cache\`** (933 frames + reference map +
drivers). Point `DATA_DIR` there and run `control.py <universe> <from> <to>`; the
provider client is replaced with one that RAISES, so a cache miss fails loudly
instead of computing on a short frame.

---

## Phase 7 — the user-facing Breadth Library UX (2026-09-15)

### The principle, and where it had to be enforced

**BREADTH IS A LIBRARY OF METRICS ACROSS UNIVERSES, NOT A FLAT COLLECTION OF
UNRELATED PSEUDO-TICKERS.** `UNIVERSE × METRIC = IDENTITY`.

⭐⭐ **Ranking the metric to the top is only half of it.** Phase 5 got the ORDER
right — `"50 day"` answers with the A50 family, universes adjacent. Phase 7 found
that the LIST ITSELF still read address-first, because `SourceField` leads with the
result's `shortName`, and `shortName` is the UNIVERSE badge. A member typing
"50 day" was shown

    NASDAQ · % of Stocks Above 50-Day MA          ← the address in bold

which is the ticker soup this library exists to replace, one layer below where
anyone was looking. **Only the browser found it.** The unit suites all passed: they
assert the ranking and the row shape, and the row shape was correct.

**Fixed in the PRODUCER, not the view.** A `DiscoveryResult` now carries `lead` and
`sub` — which half a compact list leads with — defaulting to exactly today's
behaviour (`shortName` leads, the long name follows) and overridden only by the
breadth adapter. `SourceField` renders `lead` / `sub` and learns nothing about
breadth; `shortName` is untouched, so the pane legend still reads the universe,
which is the right answer THERE. `symbolLibraryRow` (the not-yet-mounted Symbols
dialog projection) gets the same inversion.

### What was built

| | |
|---|---|
| server | `library_catalog()` → `{rows, families, universes, metric_order}` on the EXISTING `/api/breadth-symbols`, purely ADDITIVE (`symbols` / `groups` byte-identical) |
| availability | `availability()` reports `available` / `limited` / `not_populated` **read from the store**; a payload that says nothing renders as nothing, never as "not populated" |
| client | `breadthLibrary.js` — `searchLibrary` (5 tiers), `browseFamilies`, `availabilityOf`. No names, no families, no symbols of its own |
| ranking | TWO lanes, ONE definition: `library_search` (Python reference) and `searchLibrary` (UI), pinned by the GENERATED `breadthSearchParity.json` — the `closedTable.json` idiom |
| reading order | `lead` / `sub` on the result; the real `SourceField` renders them |
| presentation | catalogue metadata → `presentationFor` → `presentedPlot`; NETHL is a signed histogram with no ticker branch anywhere |
| harness | `app/breadth-harness.html` + `src/testing/breadth/` — dev-server only, `vite build` never ships it |

### ⭐ Browser proof — the real control, not a mock-up

Dev vite on **:5231** (5199 belongs to the Floor prototype), fixture-backed, banner
says so on screen. The harness mounts the **actual `SourceField`**, so what follows
is the product surface:

| step | observed |
|---|---|
| type `50 day` | `% of Stocks Above 50-Day MA · UCTA50 / · US / · NASDAQ / · NYSE` — metric bold, universe grey, four universes adjacent |
| click the NASDAQ row | stored value `sym:NASDAQ:A50:close` — the canonical identity, written by `symbolSource` |
| `new lows` | New 52-Week Lows leads (× 4 universes), then Net New High-Low, then New 20-Day Lows |
| `NASDAQ breadth` | Nasdaq's library only |
| `NASDAQ:AAPL`, `FOO:BAR` | **"No match"** — a colon does not make something breadth |
| `nasdaq 200 day` (typed, not a chip) | exactly `% of Stocks Above 200-Day MA · NASDAQ` — a universe word NARROWS |
| NETHL histogram | bars grow UP from the dashed zero for +500/+164/+13 and DOWN for −7/−99/−663; computed colours `rgb(47,175,104)` / `rgb(223,70,70)` = `#2faf68` / `#df4646`, resolved through `presentedPlot` → `signColorsForPlot`, not painted by the page |
| save → reopen | `JSON.parse(JSON.stringify(cs))` byte-identical; `sym:NASDAQ:A50:close` parses back to symbol `NASDAQ:A50` + field `close`; NETHL still a signed histogram, A50 still a line |
| browse | four families (MA Breadth · Momentum · Highs / Lows · Score / Regime), ONE entry per METRIC with its universes collected |
| Main Trading | preference `chart_settings` sha256 = `ea9ebaee…5922` — **fingerprint unchanged**, verified without rendering `/charts` |

### Defect found BY the browser proof

The harness's own preference-write lock answered with
`new Response('{}', { status: 204 })`, which **throws** — 204 is a null-body status.
It refused the write (nothing left the page) and then blew up in the caller's face
instead of answering it. `paneHarness.jsx` already used `200` + `{}`; this now
matches and records what it blocked in `window.__breadthHarnessBlocked`.

### Performance rail (§23)

Discovery runs on EVERY KEYSTROKE over the whole published library, and Phase 5
already paid 404 µs/call on `/api/bars` for exactly this class of mistake.
`breadthLibrary.perf.test.js` rails the ALGORITHM (per-keystroke index rebuild,
accidental O(n²)), with deliberately loose budgets. Measured on the 170-row
catalogue:

| | |
|---|---|
| per keystroke, `"% of stocks above 50-day"` | **~25 µs** |
| widest query (bare `NASDAQ`, limit 200) | ~15 µs |
| no match (`AAPL`) | ~17 µs |
| `browseFamilies` (whole catalogue) | ~18 µs |
| index identity | built ONCE per payload; a new array rebuilds |

### §15 Browse — DEFERRED, with the reason

`browseFamilies()` is built, railed and demonstrated in the harness. It is **not
wired into a product surface**, deliberately:

- The only LIVE surface that renders breadth discovery results is `SourceField`,
  a compact control used for EVERY source pick. Filling its empty state with a
  breadth family tree would be wrong for the large majority of picks — price
  fields and securities.
- The surface browse actually belongs in is the Symbols library dialog, whose
  projection (`symbolLibraryRow`, `BREADTH_CATEGORY`) exists but **has no
  production consumer yet**. Mounting that dialog is a separate piece of work and
  was not in this phase's scope.
- So the projection is ready the moment the dialog lands, and nothing was invented
  in the meantime. ⛔ A second search architecture was explicitly out of bounds and
  none was created.

### Status flags — unchanged from Phase 6

| | |
|---|---|
| US / NASDAQ / NYSE | **DARK.** `published_universe_ids()` defaults to UCT only; the catalogue payload a live surface sees is UCT-only unless `BREADTH_LIBRARY_UNIVERSES` says otherwise |
| fabricated data | **NONE.** No placeholder numbers, no UCT values proxied under another universe. Availability is READ from the store; the harness states on screen that its rows come from a fixture |
| `warm_breadth()` | **NOT MODIFIED** |
| provider / Railway / `railway run` / credentials | **NOT PURSUED.** Phase 7 parked the provider gate as instructed |
| PRODUCTION / R2 / LIVE SITE / MAIN TRADING | **UNTOUCHED** (Main Trading fingerprint verified) |
| PUSHED / MERGED / DEPLOYED | **NOTHING** |
