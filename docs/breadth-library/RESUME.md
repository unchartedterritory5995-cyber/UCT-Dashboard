# UCT Breadth Library — RESUME / durable handoff

> ⛔ **Not the same programme as `docs/breadth/`.** That ledger belongs to the
> Breadth → Data Charts overhaul. This one is the Breadth Library
> (UNIVERSE × METRIC). Neither touches the other's files.

**PROJECT** UCT Breadth Library
**CURRENT PHASE** Phase 15 — DARK FOUNDATION DEPLOY **SAFELY BLOCKED** at the
rolling-deploy gate (BL-028): the migration is forward-safe but BACKWARD-FATAL, and no
restore path exists through any available channel. Branch reconciled to master
(`281860228`, 45 ahead / 0 behind); frontend A/B clean. Phase 14 — DARK INTEGRATION
**SAFELY BLOCKED**: production is still
PRE-MIGRATION (`PRIMARY KEY (date, metric)`, no `universe` column), so promoting the US
artifact would silently corrupt UCT history. Nothing was written. DEPLOY FIRST,
INTEGRATE SECOND — the whole integration is rehearsed and passing against a copy of the
real production database. Phase 13 — THE US HISTORICAL GRIND IS DONE: 2008-01-02 … 2026-09-11,
**183,417 rows over 4,703 of 4,703 sessions, integrity PASS**, still dark and
unintegrated. Phase 12 — BL-021 FIXED and the gate re-run: **GO FOR THE US
HISTORICAL GRIND.** Every acceptance count is zero across one sweep / two chunks / four
chunks / 85 one-date forward-seal invocations / interrupted+resumed. Phase 11 found the
blocker; Phase 10 was blocked on provider access. Phase 9 complete —
THE DARK PRODUCTION FOUNDATION is implemented:
one publication gate, V1 as metadata, the daily forward seal, participation-only
warming, and health. **STATUS: working local code. Nothing published, nothing ground,
nothing deployed.** Previously: Phase 8 (readiness plan), Phase 7 (the UX).
**BRANCH** `feat/breadth-pit-foundation` · **WORKTREE** `C:\b2` (short path — Windows long-path trap)
**HEAD** `3e3975df5` · **WORKING TREE** clean
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

## EXACT NEXT STEP (Phase 6 — superseded by Phase 8's release sequence below)

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

### Phase-7 checkpoint commits — LOCAL ONLY, nothing pushed

| SHA | |
|---|---|
| `d1f2a3f1b` | merge origin/master (`569485a12`) — zero overlap with this branch's files |
| `e9f402390` | the library reaches the client — catalogue payload + ranked matcher |
| `7e7b98cd4` | metric-first discovery reaches the source picker |
| `e672273d2` | browser proof — the UX harness, the round-trip rail, the perf rail |
| **`a296b6824`** | **the LIST read address-first — a result now says which half leads (BL-011)** |

### Status flags — unchanged from Phase 6

| | |
|---|---|
| US / NASDAQ / NYSE | **DARK.** `published_universe_ids()` defaults to UCT only; the catalogue payload a live surface sees is UCT-only unless `BREADTH_LIBRARY_UNIVERSES` says otherwise |
| fabricated data | **NONE.** No placeholder numbers, no UCT values proxied under another universe. Availability is READ from the store; the harness states on screen that its rows come from a fixture |
| `warm_breadth()` | **NOT MODIFIED** |
| provider / Railway / `railway run` / credentials | **NOT PURSUED.** Phase 7 parked the provider gate as instructed |
| PRODUCTION / R2 / LIVE SITE / MAIN TRADING | **UNTOUCHED** (Main Trading fingerprint verified) |
| PUSHED / MERGED / DEPLOYED | **NOTHING** |

---

## Phase 8 — PRODUCTION READINESS AUDIT + V1 RELEASE PLAN (2026-09-15)

**Audit + release design. No grind, no publication, no deploy, no provider access.**

**Branch** `feat/breadth-pit-foundation` · **master inspected** `5344efb84`
(merge-base `569485a12`, **31 ahead / 9 behind**, tree clean). The 9 master commits
are docs + a CI gate harness (`tools/gate_*`, `scripts/gate_shards.py`, joystick
plans) — **zero overlap** with any breadth-library file, and none changes a
conclusion here. Not merged: reconciliation belongs to the integration phase.

### The finding that justified the phase — BL-012

A 5-session offline control wrote **40 of the 42** metrics `applies_to` allowed for a
PIT universe. Two wrote nothing (`atr_ext_7`, `adv_decline_cum`) and one wrote
**plausible values that are wrong** (`mcclellan_osc`: whole-market EMA history against
a universe-restricted current net — US/NASDAQ/NYSE returned −232.9 / −244.8 / −246.1
over populations of 2,936 / 1,195 / 1,712, all negative on a day all three advanced
broadly). Fixed by a second gate, `breadth_metrics.PIT_UNPRODUCIBLE`, inside the one
function both the sweep and the catalogue read. **A grind would have baked ~12,600 ×
3 sessions of wrong McClellan into the store.**

### V1 — RECOMMENDED

**18 metrics · 70 identities** (16 UCT + 54 new across US/NASDAQ/NYSE).

| family | metrics |
|---|---|
| Participation (7) | A5 · A10 · **A20 (20-day EMA)** · A40 · A50 · A100 · A200 |
| Highs / Lows (5) | NH · NL · **NETHL** · PH (% at 52w highs) · PL (% at 52w lows) |
| Momentum (4) | U4 · D4 · R5 · R10 |
| Base (2) | Universe Count · Net Advancers (signed histogram) |

Chosen for unit class, not for count: **percent and ratio metrics are universe-size
invariant and survived Phase 1's attribution test at ≤0.8 pp; counts did not (≈ +22 %
NASDAQ, −12 % NYSE at 2008)**. Every count in V1 ships with its denominator.

⚠️ `net_new_high_low` and `universe_count` have **no UCT symbol** — UCT never
published one. Minting `UCTNETHL` is one data row and is a product decision, recorded
not taken.

### Producible-but-deferred (21 metrics → V1.1, one flag flip, no re-grind)

Momentum breadth (U20W/D20W, U25M/D25M, U50M/D50M, U25Q/D25Q, MU/MD, UV, UPV/DNV),
NH20/NL20, NRH, HVC, ADV/DEC, Stage 2 / Stage 4.

### Not producible / not portable (12)

`mcclellan_osc`, `adv_decline_cum`, `atr_ext_7` (BL-012) · `new_ath`, `is_ftd`,
`breadth_score`, `uct_exposure`, `rsp_spy_ratio`, `iwm_qqq_ratio`, `cnn_fear_greed`,
`cboe_putcall`, `aaii_spread` (UCT-only by data, forever or pending new work).

### Floors — DISPLAY vs RAW INPUT (they are different, and this is new here)

`build_frame(warmup_days=560)`; `recompute_from_frame` refuses under 221 sessions.

| universe | DISPLAY floor | **RAW-INPUT floor** | sweep sessions | warm-up sessions |
|---|---|---|---|---|
| US | 2008-01-02 | **2006-06-21** | 4,712 | 387 |
| NASDAQ | 2011-01-01 | **2009-06-20** | 3,956 | 386 |
| NYSE | 2011-01-01 | **2009-06-20** | 3,956 | 386 |

ADJUSTED frames are fetched across warm-up + sweep; RAW frames only for sweep dates.

### Historical eligibility — re-measured on the cached 2008 RAW frames

`traded on D ∧ type ∈ {CS, ADRC} ∧ not delisted before D ∧ venue ∈ set ∧ raw close ≥
$2 ∧ trailing-20d median $-vol ≥ $1M`. Unchanged since Phase 1. Measured:

| date | universe | frame | unresolved | no venue | wrong venue | ELIGIBLE |
|---|---|---|---|---|---|---|
| 2008-03-10 | US | 7,993 | 165 (2.1 %) | **0** | 0 | 2,607 |
| 2008-03-10 | NASDAQ | 7,993 | 165 | **0** | 2,529 | 889 |
| 2008-03-10 | NYSE | 7,993 | 165 | **0** | 2,064 | 1,653 |
| 2015-03-10 | US | 7,804 | 176 (2.3 %) | **0** | 0 | 2,993 |
| 2015-03-10 | NASDAQ | 7,804 | 176 | **0** | 2,310 | 1,240 |
| 2015-03-10 | NYSE | 7,804 | 176 | **0** | 2,495 | 1,719 |

⭐⭐ **`no_venue` is 0 and `unresolved` is a flat ~2 % in BOTH eras.** Two consequences:

1. **US is immune to the attribution defect.** Every resolved record carries a venue,
   and a venue wrong *between* XNAS and XNYS is still inside `US_VENUES`. US eligible
   moves 2,607 → 2,993 across 2008→2015 with no cliff.
2. **NASDAQ/NYSE are not.** Their 2008 split (889 / 1,653 = 0.54) against 2015
   (1,240 / 1,719 = 0.72) is the misattribution, visible and quantified. **The 2011
   floor is necessary and sufficient; nothing here blocks publication at it.**

The ~2 % unresolved is a uniform, era-stable undercount applied to every universe
equally — percentages barely move, counts read ~2 % low. Publishable, worth stating
once on the surface rather than hidden.

### Backfill estimate (V1, measured inputs)

| | |
|---|---|
| sweep sessions | 12,624 across the three universes |
| rows @ 18 published metrics | ~227,000 |
| rows @ 39 stored metrics | ~492,000 |
| DB growth @ ~200 B/row | +45 MB (V1) / +98 MB (full) → **~80 / ~132 MB total** |
| **unique provider frames** | **5,098 adjusted + 4,712 raw = 9,810** |
| frame cache on the data volume | **~5.4 GB** (measured 0.56 MB/frame over 933 cached) |
| compute | ~12,624 × 0.83–1.2 s ≈ **3–4 h** |
| provider fetch | 9,810 whole-market calls — **the long pole**, and rate-limit bound |

⭐ **NASDAQ and NYSE need ZERO extra frames**: their date ranges are subsets of US's.
⭐ **Compute cost is identical for 18 or 39 metrics** — `compute_metrics` builds the
whole row and `_applies` only filters writes. So restrict the *catalogue*, not the
*grind* (BL-014).

### Verdicts

| area | verdict |
|---|---|
| storage schema | `(universe, date, metric)` + 2 covering indexes — **sufficient, no redesign** |
| R2 whole-DB ship | **survives V1.** Merge is already universe-aware and gap-fill by PK. The module header's "single-digit MB" is stale; revisit near ~250 MB |
| dedicated breadth cache | **sufficient.** 512 entries vs 70 V1 identities; 6 h TTL, keyed `breadthdaily_<symbol>` which already carries the universe |
| security / entitlement | **NO new work.** Breadth routes through `is_breadth_symbol` → `build_breadth_bars` on the WEB pod behind `require_bars_access`; `_should_proxy` excludes it via the same authority, so it never reaches the edge-routed bars tier |
| live / developing candle | **sealed-only for PIT universes, by design.** `build_breadth_bars` appends today's candle for UCT alone. A live PIT universe needs per-universe membership + live prices — the collector's whole job, per population. **Not V1.** |
| `warm_breadth()` | **still UCT-only.** Recommendation: warm the V1 **participation family only** (A50/A200 per published universe ≈ 8 series), reuse the existing new-sealed-day convergence check per universe, keep `_WARM_GAP`. Everything else stays lazy |
| publication gate | **NOT coherent yet — BL-013.** `list_breadth_symbols()` is hard-wired to the 44 shipped `SYMBOLS`, so a flag flip would publish to `/api/bars` and the source picker but NOT to `/api/ticker-search` or the client's family map — where `symbolFamily()` would call a published breadth identity a `'security'` and let it be used as a candle source |
| daily forward seal | **MISSING.** `universe_backfill_plan` only walks BACKWARD from current coverage to the floor. After the grind nothing advances the right edge, so a published PIT series would freeze. **Must exist before publication.** |
| frontend | **ready.** Metric-first discovery, exact identity, colon rejection, signed histogram, save/reconstruct, multi-series pane, Universal Data — all railed and browser-proved |
| Browse | **DEFERRED.** Re-checked `origin/master` 5344efb84: `symbolLibraryRow` / `BREADTH_CATEGORY` still have **no consumer**. Search is sufficient for V1 |

### Provider control plan

Designed, not run: [`PROVIDER-CONTROL-PLAN.md`](PROVIDER-CONTROL-PLAN.md). Four
windows (~872 sessions), 19 PASS/FAIL invariants, every frame reused by the grind.
It is **not** "US 2015" any more: US is immune to the attribution defect, so a US
window proves the pipeline and says nothing about NASDAQ/NYSE — those need a
2011 FLOOR window plus a 2015 window, and check 17 compares the exchange split
across them.

### Release sequence — US FIRST

1. **A** provider control (US 2015 full year + bounded NASDAQ/NYSE 2011 + 2015 windows)
2. **B** grind US only, to an isolated artifact
3. **C** integrity audit on the artifact
4. **D** ship storage/backend + the coherent publication gate + the daily seal, **dark**
5. **E** full pre-publication test gate (the deferred A/B backend comparison)
6. **F** publish **US alone**
7. **G** observe one week
8. **H** grind + publish NASDAQ and NYSE together

US first because it is the only universe the measured attribution defect cannot
touch, it is the one a member is most likely to want, and it halves the blast radius
of the first publication.

### ⚠️ A master change that DOES alter a conclusion

`origin/master`'s `docs/breadth/deploy-gate-cutover-runbook.md` (partner, Session 10)
measures what a master push actually does:

> a push to `master` starts a Railway build **immediately**; the `master deploy gate`
> workflow runs **in parallel, not before**. Ten deploys observed booting 2-141 s
> BEFORE their own gate finished; one commit was watched reporting `SUCCESS` while its
> gate was still executing. Status of the cutover that would fix this: **NO-GO**.

⛔ **So "merge the branch to master" IS a production deploy, and no CI gate holds it.**
Two consequences for this release plan, both already reflected in the sequence above:

1. Stage D (ship backend support) must be **dark by default at the moment of merge** —
   there is no window between merging and running.
2. The full pre-publication test gate is run **locally, before the merge**, not relied
   on in CI. `scripts/gate_shards.py` (also new on master) is the right tool for the
   frontend half: it exists because this project has recorded a fake gate result three
   times, and it refuses a dirty tree and records the tree hash at both ends.

### Rollback

`BREADTH_LIBRARY_UNIVERSES` back to unset → UCT only. Stored rows stay (dark, not
deleted), caches expire on their 6 h TTL, and a saved chart referencing a disabled
identity falls through `resolve()` → empty series, which is the established
"unavailable" path rather than a crash. ⛔ No rollback deletes history.

### Tests after the audit's fix

| suite | result |
|---|---|
| backend `-k "breadth or symbol or bars_route or ticker_search"` | **1,109 passed** (was 1,103; +6 new rails), 12 skipped, 3 failed |
| ↳ those 3 | `test_implied_backfill.py::…falls_back_to_finnhub` — **reproduced identically on clean master `569485a12`** |
| backend `-k breadth` | **654 passed**, 12 skipped, 0 failed |
| frontend `src/components/chart src/hooks` (390 files) | **9,016 passed**, 4 skipped, 4 failed — the four standing pre-existing rails, unchanged |
| breadth-library frontend rails | **113 passed** |
| `npm run build` | clean, 447 assets; harness still not shipped |

### Branch integration risk — MECHANICALLY NIL

**31 ahead / 9 behind.** `git merge-tree --write-tree origin/master HEAD` produces a
clean tree with **0 conflicts**, and the file sets are **disjoint** (46 files changed
here, 20 there, intersection empty). Master's new gate tooling discovers test files
dynamically, so this branch's ~10 new test files need no registration.

**Recommended integration: merge the branch as ONE coherent feature**, not
cherry-picked checkpoints. The checkpoints are not independently shippable — the
storage migration, the catalogue, the discovery lane and the publication gate only make
sense together — and cherry-picking would ship a half-migrated store. ⛔ No rebase, no
force; take `origin/master` INTO the branch when integration is authorised.

### Small local fixes made during this audit

| | |
|---|---|
| `breadth_metrics.PIT_UNPRODUCIBLE` + the second gate in `applies_to` | BL-012 — 3 metrics removed from every PIT universe |
| `tests/test_breadth_metrics_catalog.py` | 6 new rails; one existing rail relaxed from a snapshot (`== PORTABLE_METRICS`) to the invariant (`PORTABLE − PIT_UNPRODUCIBLE`) |
| `__fixtures__/breadthLibraryRows.json`, `breadthSearchParity.json` | **regenerated** from the Python reference, per the parity rail's own rule. 170 → 161 rows; `"50 MA"` no longer returns `US:XR` / `NASDAQ:XR` / `NYSE:XR` |

### Status flags

| | |
|---|---|
| grind / publication / deploy / Railway / R2 / provider | **NOT TOUCHED** |
| `BREADTH_UNIVERSE_BACKFILL_ENABLED` | **still disarmed** |
| US / NASDAQ / NYSE | **still DARK** |
| Main Trading | **not opened** |

### WHAT IS ACTUALLY LEFT BEFORE THIS CAN GO LIVE

**MUST DO (in order)**

1. **Provider control** — [`PROVIDER-CONTROL-PLAN.md`](PROVIDER-CONTROL-PLAN.md), 4
   windows, 19 invariants. Needs `MASSIVE_API_KEY` readable by a local/worker process.
2. **One coherent publication gate** (BL-013) — `list_breadth_symbols()` projects the
   published set, so `symbols`, `/api/ticker-search`, `library`, `/api/bars` and the
   client's `symbolFamily()` all turn on together. Byte-identical today.
   ⚠️ design the `symbols_by_group()` → prebuilt-watchlist blast radius first.
3. **A daily forward seal for PIT universes** — `universe_backfill_plan` only walks
   BACKWARD to the floor; nothing advances the right edge, so a published series would
   freeze the day the grind ended.
4. **A metric publication set** (BL-014) — grind 39, publish 18.
5. **The grind**, US first, to an isolated artifact, then the integrity audit.
6. **`warm_breadth()` generalisation** — smallest version: the participation family per
   published universe (~8 series), reusing the existing new-sealed-day convergence.
7. **The full pre-publication test gate**, run LOCALLY before the merge (see the
   deploy-gate note above), including the deferred backend branch-vs-master A/B.

**CAN WAIT UNTIL AFTER V1**

- Live / developing candle for PIT universes (sealed-only is honest and stated).
- Browse mode (no Symbols Library consumer exists on master).
- Ratio-adjusted McClellan; `atr_ext_7` from the frame's o/h/l; a forward-accumulated
  A/D line. Each is a removal from `PIT_UNPRODUCIBLE`.
- The V1.1 metric promotion (a flag flip once #4 exists — no second grind).
- `UCTNETHL` / `UCTUNI` minting.
- R2 delta shipping (revisit near ~250 MB; ~80 MB is fine).
- Per-metric availability in the catalogue (`availability()` is per-universe).

---

## Phase 9 — THE DARK PRODUCTION FOUNDATION (2026-09-15) · IMPLEMENTED

The five items the readiness plan listed as remaining are now **working local code**.
Nothing published, nothing ground, nothing deployed.

### What was built

| | where | ledger |
|---|---|---|
| **A** one coherent publication gate | `breadth_symbols.is_published` + `published_symbol_rows` | BL-015 |
| **B** V1 as canonical metadata | `breadth_metrics.V1_METRICS` + five-level vocabulary | BL-016 |
| **C** daily PIT forward seal | `breadth_history_recon.forward_seal_*` | BL-017 |
| **D** participation-only warming | `breadth_symbols.warm_symbols_for_pit` | BL-018 |
| **E** health / observability | `breadth_symbols.library_health` + `/api/breadth-monitor/library-health` | BL-019 |

### The accepted V1 invariant — railed, and it holds exactly

**18 metrics · 70 identities · 16 UCT + 54 new.**

⚠️ UCT gives 16 rather than 18 because an IDENTITY needs a SYMBOL, and
`net_new_high_low` / `universe_count` have no UCT spelling. ⚠️ And 70 is **not** the
live catalogue: that is 44 while dark, 62 with US published, 98 with all three. Two
different questions, both correct, both railed.

### Dark-default parity — a byte claim

With no publication flags, `published_symbol_rows() == legacy_symbol_rows()`: the same
44 rows, the same order, the same keys, and still no `universe` key on a legacy row.
`/api/breadth-symbols`, `/api/ticker-search`, `library_catalog` and `is_breadth_symbol`
all answer exactly what they answered before.

### The BL-013 consequence, fixed and shown

`symbolFamily()` answers `'security'` for anything absent from the `symbols` array.
While that array was hard-wired to the 44 shipped records, a published `US:A50` would
have been served by `/api/bars` as breadth and classified by the chart as an ordinary
security — and `ohlcCapabilityOf` would have offered CANDLES over bars whose "open" is
yesterday's value and whose wick is derived from the pair, not observed.

Proven in the browser at three settings:

| setting | identities | `UCTA50` | `US:A50` | `NASDAQ:A50` | `AAPL` |
|---|---|---|---|---|---|
| DEFAULT | 44 | breadth · refused | security | security | security · candles |
| `?publish=us` | 62 | breadth · refused | **breadth · refused** | security | security · candles |
| all three | 98 | breadth · refused | breadth · refused | **breadth · refused** | security · candles |

The refusal names the FAMILY, not a missing field — the bars carry a complete o/h/l/c.

### Browser proof (dev harness on :5231, fixture-backed, Main Trading untouched)

| step | observed |
|---|---|
| DEFAULT — search `50 day` | `% of Stocks Above 50-Day MA · UCTA50` alone |
| DEFAULT — NETHL section | "not published at this setting — UCT has no NETHL symbol… Nothing is substituted." |
| `?publish=us` — search `50 day` | `… · UCTA50` then `… · US`, metric bold, universe grey |
| `?publish=us` — the REAL `SourceField` | typed `50 day` → two rows; clicked the US row → stored `sym:US:A50:close` |
| `?publish=us` — `US:MU` (V1.1), `NASDAQ:AAPL` | **no match** |
| `?publish=us` — NETHL histogram | +500/+164/+13 green `rgb(47,175,104)` growing UP from the dashed zero; 0 at the baseline; −7/−99/−663 red `rgb(223,70,70)` growing DOWN |
| all three — compare pane | `sym:UCTA50:close` · `sym:US:A50:close` · `sym:NASDAQ:A50:close` · `sym:NYSE:A50:close` |
| **disable again** (`?publish=`) | back to 44 identities; `US:A50` returns to `security`; search shows UCTA50 alone; NETHL says not published. **No stale classification.** |
| console | clean on every load |

⚠️ The publication switch is a URL param and a RELOAD, not a React toggle, on purpose:
`useBreadthSymbols` caches its payload for the session, which is exactly how a
deploy-time flag behaves.

### Storage ahead of publication — proven

A rail writes a US row, shows it is invisible at every surface, flips publication on
(the SAME row becomes servable and discoverable with no DB rewrite), and flips it off
again (the row is still there, untouched). That separation is the launch strategy.

### Tests

| suite | result |
|---|---|
| backend `-k breadth` | **712 passed**, 12 skipped, 0 failed |
| backend `-k "breadth or symbol or bars_route or ticker_search or watchlist"` | **1,321 passed**, 3 failed |
| ↳ those 3 | `test_implied_backfill::…falls_back_to_finnhub` — reproduced on clean master `569485a12` |
| new backend rails | publication gate **22**, forward seal **28**, seal end-to-end **5**, warming **4** |
| frontend `src/components/chart src/hooks` (391 files) | **9,033 passed**, 4 skipped, 4 failed — the four standing pre-existing rails |
| new frontend rails | `breadthPublication.test.jsx` **17** |
| `npm run build` | clean, 447 assets; harness still not shipped |

### Still dark, still unground

| | |
|---|---|
| `BREADTH_LIBRARY_UNIVERSES` | unset → UCT only |
| `BREADTH_LIBRARY_METRICS` | unset → `v1` (governs PIT universes only) |
| `BREADTH_UNIVERSE_BACKFILL_ENABLED` | unset → disarmed |
| provider / Railway / R2 / Cloudflare / production / Main Trading | **untouched** |
| pushed / deployed | **nothing** |

### EXACT REMAINING STEPS BEFORE US LAUNCH

1. **Provider control** — [`PROVIDER-CONTROL-PLAN.md`](PROVIDER-CONTROL-PLAN.md).
2. **Grind US** 2008→present to an isolated artifact (store all 39 producible metrics).
3. **Integrity audit** on the artifact.
4. **Final expensive test gate**, run LOCALLY before the merge — a master push starts a
   Railway build immediately and no CI gate holds it.
5. **Dark integration** — merge as one coherent feature.
6. **Publish US**: `BREADTH_LIBRARY_UNIVERSES=us`. Everything else is already wired.
7. **Observe** a week via `/api/breadth-monitor/library-health`.
8. **NASDAQ + NYSE** later, same two steps.

---

## Phase 10 — US DATA GATE · attempted 2026-09-15 · **NO-GO**

**Branch** `feat/breadth-pit-foundation` · **HEAD** `65659344e` at start ·
**origin/master** `d25a69b86` (UNCHANGED since the Phase-9 trial merge — no delta to
inspect) · **36 ahead / 13 behind** · tree clean.

### The control was NOT run. There is still no authorised provider path.

⛔ **Reported rather than worked around, exactly as the brief required.** The gate says:
"If there is STILL no legitimate authorized way to exercise the real provider path from
this environment: STOP and report that clearly. Do not fake the provider control with
cached data and call it passed."

**The credential surface is a single environment variable.** `massive._MassiveRestClient.__init__`
reads `os.environ["MASSIVE_API_KEY"]` and raises without it. There is no OAuth, no
service account, no signed-URL tier, no proxy — one variable, one source.

**Every candidate path, checked this session:**

| candidate | measured result |
|---|---|
| `MASSIVE_API_KEY` / `POLYGON_API_KEY` / `MASSIVE_KEY` in this process | **not set** |
| a local `.env` | only `.env.example` exists, here and in the main checkout |
| the running local backend on `:8000` | alive (`/api/health` 200, uptime 156,673 s) but **has no key**: `/api/live-prices?tickers=AAPL` → `503 {"error":"Pricing service unavailable"}` |
| an existing route exposing grouped-daily frames | **none** — `get_grouped_daily_ohlcv` / `get_grouped_daily_closes` have zero references under `api/routers/` |
| Railway CLI | installed (4.66.0); **this worktree is NOT linked** ("No linked project found"); the main checkout IS linked (`luminous-recreation`) |

**Why the linked main checkout does not unblock it.** The only two ways to use it are
both closed:

- `railway variables --kv` would **print production secrets** into the transcript.
  Forbidden by this brief (§24 "Secrets: NEVER PRINT / COMMIT") and by every prior phase.
- `railway run -- <cmd>` is **Railway as a credential bridge**, banned by name in the
  Phase-5, Phase-6 and Phase-7 briefs and not lifted by this one, which says "Do not
  invent a secret bridge". Linking THIS worktree would also be a Railway configuration
  change, which §24 forbids.

⚠️ **And it would not be a read-only control even if it were permitted.** The bounded
window needs ~1,000 whole-market fetches on the PRODUCTION account's quota and rate
limits, initiated from a dev machine outside any deploy. That is production impact
wearing a validation label.

### What the unblock actually is

**One `MASSIVE_API_KEY` readable by a local process** — the documented dev path
(`CLAUDE.md:3364`, "set in Railway + local `.env`"). ⛔ Per standing instruction this
was NOT requested, and no mechanism was invented to get around it.

Everything downstream is built and waiting: `PROVIDER-CONTROL-PLAN.md` specifies four
windows and 19 PASS/FAIL invariants, the harness that drove the Phase-6 cached control
still runs, and the pipeline it exercises is the one the grind uses.

### §17 — the dark-family semantic audit · **DEFERRED** (BL-020)

Answered anyway, because it needed no provider access. **Can the canonical family
architecture represent "registered breadth but dark" as unavailable breadth?** **No** —
not without exposing the identity, which the constraint set forbids. `symbolFamily()`
knows only what the payload told it; a shape test makes `FOO:BAR` breadth and a prefix
test is the special case BL-008 reverted.

⚠️ The label is wrong; the BEHAVIOUR is right, and measured:

| | |
|---|---|
| dark identity, discovery | absent from `library`, `symbols` and search |
| dark identity, `/api/bars` | empty series |
| dark identity, `ohlcCapabilityOf` | **`NO_BARS`** — refused |
| chart saved before a rollback | source survives; series renders unavailable |
| `AAPL` · `NASDAQ:AAPL` · `FOO:BAR` · `UCTT` | security, unchanged |

Six new rails under `§17` in `breadthPublication.test.jsx` (22 passing in that file), so
the reasoning cannot rot into "nobody checked".

### Status — unchanged

| | |
|---|---|
| provider accessed | **NO** |
| grind run | **NO** |
| universes published | **NO** (`BREADTH_LIBRARY_UNIVERSES` unset) |
| Railway config / R2 / Cloudflare / production / Main Trading | **untouched** |
| pushed / deployed | **nothing** |

### EXACT NEXT STEP

**Make `MASSIVE_API_KEY` readable by a local process by whatever route the owner
considers legitimate.** The moment it is, the control is one command over a bounded
window, and its result is the GO/NO-GO for the US 2008→present grind.

---

## Phase 11 — US DATA GATE, provider-backed (2026-09-15) · **NO-GO**

**Branch** `feat/breadth-pit-foundation` · HEAD `07b2f81cb` at start ·
`origin/master` `d25a69b86` · 36 ahead / 13 behind · tree clean.

⭐ **The provider path PASSED. `sweep_history` did not.** The blocker is BL-021: two
defects at the boundary of every sweep CALL, invisible to any single-window run, found
because a resume produced a different artifact from an uninterrupted one.

### Execution mechanism

`railway run --service worker -- <venv python> <absolute script under C:\w\breadth-us-gate>`
from the already-linked main checkout. The secret was injected into the child process
and **never printed, echoed, inspected, copied, written or committed**. `railway
variables` was not run. No Railway configuration was changed.

⛔ **Code provenance was proved before the first provider request**, because the linked
checkout is a different worktree: the script prints the Breadth worktree path, branch,
HEAD and the resolved `__file__` of all eight Breadth modules, and REFUSES unless every
one resolves under `C:\b2`. All eight did.

### Stage 1 — connectivity · PASS

Client init OK. An **uncached** date (2015-06-10): RAW 7,875 rows in 0.72 s, ADJUSTED
7,875 in 0.97 s, full `o/h/l/c/v`, durable tier written (0.56 / 0.57 MB).

⭐ **RAW really is RAW**: 678 of the first 4,000 shared tickers differ on close. One
sample sits at raw **$1.19** against adjusted **$71.40** — a ~60:1 split, exactly the
case the $2 floor exists to catch.

### Stage 2 — RAW → cache → eligibility · PASS

Cache hit on re-read: 12 ms, 0 provider requests. `eligible_on('us', RAW)` → 3,172
members, coverage 0.977.

⛔ **The counterfactual is the proof.** The same call over the ADJUSTED frame gives
3,200 members and only 165 price rejections against RAW's 322 — **157 fewer**, and 31
names the adjusted frame would have wrongly admitted. One of them: raw **$1.94**
(excluded) vs adjusted **$19.40** (would have passed). Phase 6's blocker was real.

Eligibility contract unchanged: `{CS, ADRC}`, the nine US venues, `$2`, `$1M` over 20
sessions, no market cap.

### Stage 3 — bounded control · windows A and B

| window | sessions | rows | wall | provider req | cache hits |
|---|---|---|---|---|---|
| **A** US 2015-01-02 → 2015-12-31 | **252** | 9,828 | 4.1 min (0.99 s/session) | 515 | 397 |
| **B** US 2008-01-02 → 2008-06-30 | **125** | 4,875 | 1.8 min (0.84 s/session) | 189 | 465 |

**Zero missing sessions.** The control's own calendar check flagged 12 dates; every one
was a market closure confirmed by the provider returning 0 rows for both modes (MLK,
Presidents', Good Friday, Memorial, July 4, Labor Day, Thanksgiving, Christmas). ⚠️ The
flag was the CHECK, not the data: `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` covers 2025-2027
by design, so `is_trading_session` degrades to weekday-only over 2008/2015. Correct for
the forward seal (recent dates only); wrong tool for a historical audit. 252 and 125
both match NYSE exactly.

#### Membership funnel (RAW, provider-backed)

| date | frame | unres | notCS | noVen | wrgVen | px<$2 | liq | ELIGIBLE | cov |
|---|---|---|---|---|---|---|---|---|---|
| 2015-01-02 | 7,798 | 177 | 3,080 | 0 | 0 | 356 | 1,240 | 2,945 | 0.977 |
| 2015-03-10 | 7,804 | 176 | 3,073 | 0 | 0 | 344 | 1,218 | 2,993 | 0.977 |
| 2015-06-10 | 7,875 | 180 | 3,091 | 0 | 0 | 322 | 1,110 | 3,172 | 0.977 |
| 2008-01-02 | 7,960 | 161 | 3,650 | 0 | 0 | 216 | 1,240 | 2,693 | 0.980 |
| 2008-03-10 | 7,993 | 165 | 3,672 | 0 | 0 | 277 | 1,272 | 2,607 | 0.979 |
| 2008-06-30 | 7,977 | 170 | 3,622 | 0 | 0 | 298 | 1,196 | 2,691 | 0.979 |

Identical to the offline Phase-8 measurements — the provider path reproduces them.

#### Survivorship — the point of the PIT frame

| date | eligible | **delisted today** | |
|---|---|---|---|
| 2015-03-10 | 2,993 | **1,248** | 41.7 % |
| 2008-03-10 | 2,607 | **1,170** | 44.9 % |

A survivor-shaped universe would report ~0.

#### Reconciliation

| | |
|---|---|
| **US A50 2015-03-10** | **47.20** · Phase 1 ref 47.23 (−0.03 pp) · Phase 6 cached 47.20 (identical) |
| NETHL identity | 2015-03-09 115−102=**13** · 03-10 43−142=**−99** · 03-11 89−96=**−7** — exact on every date |
| 2008-03-10 | A50 19.90, NH 5, NL 529, NETHL **−524**, universe 2,571 — a bear-market shape |

### Stage 4 — invariants

| check | result |
|---|---|
| determinism (two independent runs) | ✅ identical rows |
| idempotency (re-run into the same store) | ✅ nothing changed, nothing grew |
| missing-RAW refusal | ✅ `failed`, `missing_raw=['2015-06-08']`, store unmoved |
| …and it heals on the next tick | ✅ sealed 6, date present |
| UCT parity | ✅ 0 UCT rows in every control store; the production DB was never opened |
| **resume converges** | ⛔ **FAIL — this is BL-021** |

### ⛔ THE BLOCKER — BL-021

Same dates, **different values**. 43 of 312 rows differ; 8 of them differ on the CLOSE.

**Defect A — warm-up rows are measured over the WHOLE MARKET.** `members_of` has
entries only for sweep dates, so warm-up dates pass `members=None` = "every priced
ticker": 7,835 names instead of 3,073. The two V1 metrics derived from that buffer are
wrong at the start of every chunk — **R5 for 4 sessions (up to 29.3 %), R10 for 9 (up
to 24.2 %)**. Only those two; every other V1 metric is byte-identical.

**Defect B — the first stored bar of every sweep call is a doji.** `o = prev.get(metric,
fv)` and `prev` starts empty per call, so `o = c`. Closes are right; bodies are not.

⛔ **The forward seal is the serious half.** A daily tick starts a fresh buffer, so
**100 % of the live portion of `US:R5`, `US:R10` and of every sealed candle body would
be wrong** — permanently, and plausibly.

Not fixed here: neither has one obvious safe answer (Defect A's fix reverses a
deliberate cost decision), both are production-path changes to the function the grind
depends on, and both need this control re-run afterwards.

### Provider behaviour

| | |
|---|---|
| requests | **704** — 663 frames, 41 empty |
| the 41 empties | **all market holidays** in warm-up spans — zero failures |
| rate limits / 429 | **none observed** |
| retries needed | **none** |
| cache hits | 871 · re-read of a cached frame 12 ms, 0 requests |
| mean fetch | **0.31 s** · total 3.7 min |

⚠️ **An operational risk found by reading, not by failure:**
`get_grouped_daily_ohlcv` wraps everything in `except Exception: return {}` and has
**no retry and no backoff**. A 429 or a transient 5xx is indistinguishable from a
holiday. `build_frame` guards the RAW side; the ADJUSTED side has no such guard, so a
dropped adjusted frame silently shortens the matrix and the date is skipped. None
occurred in 704 requests — but the grind is 9,185.

### Grind estimate — measured, and better than the offline guess

| | |
|---|---|
| frames needed | **9,185** (4,334 adjusted + 4,851 raw) |
| fetch | 9,185 × 0.31 s ≈ **48 min** |
| compute | 4,860 × ~0.35 s ≈ **28 min** |
| **total** | **~1.3 h** (the Phase-8 offline estimate said 3-4 h at 0.85 s/frame) |
| rows @ 39 stored metrics | ~190 k for US |

### Isolated artifact

`C:\w\breadth-us-gate\control.db` — **14,703 rows, 377 days, 2008-01-02 … 2015-12-31**,
universe `us` only. Frames landed in the existing local cache
`C:\w\breadth-library-cache\grouped_ohlcv` (926 → 1,598 frames). ⛔ No production DB, no
Railway volume, no R2 write.

### EXACT NEXT STEP

**Fix BL-021's two defects, then re-run this control.** The provider path, the
eligibility contract, the values, the survivorship property, determinism, idempotency,
the missing-RAW refusal, cache reuse and throughput are all proven and will not need
re-proving from scratch — only the resume convergence and the two ratios.

---

## Phase 12 — BL-021 FIXED, gate re-run (2026-09-15) · **GO**

**Branch** `feat/breadth-pit-foundation` · `1f5651c3e` → see below ·
`origin/master` `d25a69b86` · tree clean.

### What changed — BL-022 and BL-023

| | |
|---|---|
| `breadth_pit_frame.WARM_SESSIONS = 15` | the rolling metrics' warm window, defined ONCE |
| `build_frame` | resolves membership for those 15 sessions too; a warm date with no RAW frame refuses the chunk like any other |
| `sweep_history` | imports the length rather than typing 15; `_seed_carry_in` carries the last warm row into `prev` |
| `massive.get_grouped_daily_frame` | tri-state — rows / confirmed closure / `GroupedFrameError`; bounded serial retry 1-4-10 s |
| `.closed` markers | a confirmed closure is durable; a failure never is |
| `_sessions` / `build_frame` | the ADJUSTED half refuses too; RAW+ADJUSTED atomic per session |

⛔ **The cost objection was about the wrong number.** The 560-day span is the frame's
PER-TICKER warm-up and needs no membership; the rolling metrics need fifteen sessions.
**~195 extra raw frames on ~9,185 — about 2 %.**

### The acceptance run — real provider, corrected pipeline

US 2015-03-02 … 2015-06-30 · 85 sessions · 3,315 rows · computed five ways:

| | R5 | R10 | O/H/L/C |
|---|---|---|---|
| two chunks vs one sweep | **0** | **0** | **0** |
| four chunks | **0** | **0** | **0** |
| **85 one-date invocations** (the forward-seal shape) | **0** | **0** | **0** |
| interrupted + resumed | **0** | **0** | **0** |

Boundary body 2015-04-30: open **55.7** = prior close **55.7** (the doji would have been
43.9). Controls unmoved: **A50 2015-03-10 = 47.20**, NETHL **13 / −99 / −7**, and
`NETHL == NH − NL` with **0 violations** across all 85 sessions. Provider: 3 requests,
40,280 cache hits, 1,433 confirmed closures, **0 failures**. UCT rows in all seven
isolated stores: **0**.

### Tests

| | |
|---|---|
| `tests/test_breadth_chunk_invariance.py` | **9** — one/two/four chunks, 30 one-date invocations, R5, R10, full OHLC, the boundary open, the true-first date, and **both bite-checks** |
| `tests/test_grouped_frame_failure_semantics.py` | **14** — three states, retry-recovers, retry-exhausts, permanent-never-retried, malformed body, cache poisoning, durable closure, both walker refusals |
| backend `-k breadth` | **721 passed**, 12 skipped, 0 failed |
| backend `-k "breadth or grouped or massive"` | **869 passed**, 1 failed |
| ↳ that 1 | `test_massive_ws_stop` — reproduced with these changes STASHED; pre-existing, websocket worker, unrelated |
| frontend | not run — no frontend code changed |

### Grind estimate — unchanged

~9,380 frames (9,185 + ~195 warm) × 0.31 s ≈ **48 min fetch** + ~28 min compute ≈
**1.3 h**. Closure markers remove the repeated re-asking of holidays.

### EXACT NEXT STEP

**Authorise the US 2008 → present historical grind.** Nothing else is outstanding: the
provider path, the eligibility contract, membership, survivorship, the values, chunk
invariance, resume, forward-seal equivalence, the missing-RAW refusal, the
failure/closure distinction, cache reuse, throughput and UCT parity are all proven on
real data. The grind writes to an isolated artifact; publication stays a separate flag
and a separate decision.

---

## Phase 13 — US HISTORICAL GRIND, 2008 → present · **COMPLETE, INTEGRITY PASS** (2026-09-15)

**Branch** `feat/breadth-pit-foundation` · `origin/master` `65899a8f7` (no breadth/
provider/storage overlap; trial merge clean) · tree clean · nothing pushed.

### The artifact

| | |
|---|---|
| path | `C:\w\breadth-us-gate\us_grind.db` — **isolated**, production DB never opened |
| range | **2008-01-02 … 2026-09-11** (last SETTLED session; today excluded by design) |
| rows | **183,417** |
| sessions | **4,703 of 4,703 expected — 0 missing, 0 partial** |
| metrics | **39 producible** (of 51 registered); 0 leaked, 0 unproducible stored |
| size | 41.1 MB |
| source | `close_recon` on every row |

### The run

17 chunks, 365 days each, walking BACKWARD from the ceiling. **68 min wall, 39.3 min
fetch**, 6,717 provider requests, 8,897 cache hits, 381 closures (113 new markers),
**0 provider failures, 0 rate limits**. Sentinels ran and passed at every chunk boundary.

⚠️ **Resume was exercised for real, not simulated.** The run was stopped mid-flight to
fix a throughput defect and restarted; it picked up from coverage at 19,539 rows and
continued correctly. Coverage-driven resume needs no progress file.

### Integrity

| check | result |
|---|---|
| missing sessions | **0** |
| partial sessions | **0** |
| per-metric gaps after first value | **0** on all 39 |
| domain violations | **0** on all 39 |
| **R5 boundary anomalies** | **0** across all 17 boundaries |
| **R10 boundary anomalies** | **0** |
| **OHLC continuity** | **183,378 bars checked · 0 opens != prior close · 0 boundary dojis** |
| NETHL == NH − NL | **0** violations |
| non-finite / geometry / duplicates | **0 / 0 / 0** |
| non-US rows in the artifact | **0** |
| universe_count: >10 % day moves, zero readings | **0 / 0** |
| idempotency (re-run + explicit re-sweep) | every row identical |
| deterministic replay, 2008 / 2015 / 2020 / 2026 | **IDENTICAL** in all four |

### Sentinels — the history reads like the history

`2008-03-10 A50 = 19.9` (ref 19.9) · `2015-03-10 A50 = 47.20` (ref 47.20) ·
NETHL 13 / −99 / −7 on 2015-03-09/10/11.

October 2008 behaves like October 2008: A50 **21.6 → 13.7 → 9.4 → 6.9 → 2.9 → 2.5 →
0.7**, NETHL bottoming **−1,539** on 2008-10-09.

`universe_count` 2,069 → 4,102, mean 2,999, no discontinuity above 10 % in 4,703
sessions; the yearly means trace listings sensibly (2,514 in 2008 → 3,899 in 2021 →
3,544 in 2026).

### §21 survivorship — the property the PIT frame exists for

| date | eligible | delisted TODAY | share |
|---|---|---|---|
| 2008-03-10 | 2,607 | 1,170 | **44.9 %** |
| 2010-06-15 | 2,506 | 1,061 | 42.3 % |
| 2015-03-10 | 2,993 | 1,248 | 41.7 % |
| 2020-03-16 | 3,117 | 815 | 26.1 % |
| 2023-06-15 | 3,377 | 546 | 16.2 % |
| 2026-09-11 | 3,591 | 0 | 0.0 % |

⛔ A today's-universe frame reports ~0 % in every row. The decline toward the present is
the expected shape — recent listings have not had time to die.

⚠️ `universe_count` runs 14-100 names (0.5-3 %) below the eligibility set on the same
date: names eligible on the RAW frame that carry no ADJUSTED close that session, so the
metric engine sees no price for them. Small, consistent, explainable.

### §26 forward-seal handoff — proven, after a false pass

⚰️ **The first §26 run passed for the wrong reason and that is worth recording.** The
helper captured its reference with `snap(ARTIFACT, …)`, which sets `BREADTH_OHLC_DB` as a
side effect — so the truncation meant for a COPY ran against the artifact, the store
still ended where it began, the seal had nothing to do, and the tail "matched" trivially.
It also deleted 2026-09-04 … 2026-09-11 (183,417 → 183,222 rows).

That turned §26 into a real test. With the store genuinely truncated:

- `forward_seal_tick` sealed **5 of 5** expected sessions, no failure, no partial;
- what it produced is **IDENTICAL** to an independent deterministic replay of the same
  dates into a fresh store — which IS the "historical value == daily-seal value" claim;
- the join opens at the prior close for every metric checked (A50, R5, R10, NH, NETHL,
  universe_count);
- the artifact is restored to exactly **183,417 rows / 4,703 sessions / …2026-09-11**,
  and the full audit passes again on the restored copy.

⛔ The lesson is the repo's own: a helper that mutates process state as a side effect
turns a rail into a rubber stamp. Every store path in the repair script is explicit.

### Performance — measured, against the 1.3 h estimate

68 min wall for the completed run. The FIRST attempt was far slower and the reason was a
defect I introduced (BL-024): throughput collapsed from ~1.6 req/s to ~0.05 req/s.

⚠️ **Memory: the process held 4-5 GB resident**, because the shared `TTLCache` keeps
~1,000 whole-market frames. Fine on this machine. ⛔ It is a sizing question before this
ever runs on the Railway worker, which has OOM'd on bar-warming before.

The durable frame cache is now **9,996 files** (~5.5 GB) and is reusable by NASDAQ and
NYSE without a single extra fetch — their date ranges are subsets of US's.

### Status

| | |
|---|---|
| US published | **NO** — `BREADTH_LIBRARY_UNIVERSES` untouched |
| production DB opened or mutated | **NO** |
| R2 / Railway config / Cloudflare / deploy | **NO** |
| NASDAQ / NYSE computed | **NO** |
| Main Trading | **NO** |
| secret displayed | **NO** |

### EXACT NEXT STEP

**The dark-integration decision.** The artifact is complete, audited and reproducible;
integration (merging it into production serving storage, or shipping it via R2) and
publication remain separate, unauthorised steps.

---

## Phase 14 — DARK INTEGRATION · **SAFELY BLOCKED** on the deploy (2026-09-15)

**Branch** `feat/breadth-pit-foundation` @ `9e23e8c7b` · `origin/master` `65899a8f7` ·
43 ahead / 20 behind · tree clean · **nothing written to production, R2 or any pod.**

### Reconciliation — clean

Master's only breadth-matching changes since the merge-base are the OTHER programme's
docs (`docs/breadth/`, `docs/breadth-history-reader/`). **Zero file overlap**, trial
merge clean. The publication gate still defaults UCT-only and `is_published()` is still
the single reachability authority.

### ⛔ THE BLOCKER — BL-026

Production's breadth database, downloaded read-only from the live R2 path
(`breadth_ohlc/latest.txt` → `snap/1789472774.tar.gz`, worker-uploaded 11:46 UTC that
day), is **PRE-MIGRATION**: `PRIMARY KEY (date, metric)`, no `universe` column, 170,545
rows, 2008-01-02 … 2026-08-07.

Production runs master, whose `_MERGE_SQL` is universe-blind. Uploading the US snapshot
would have the web pod merge US and UCT **onto the same `(date, metric)` keys** — one
universe's number written under the other's name, across a year-plus of published UCT
history, silently and plausibly. That is precisely the corruption this branch's merge
comment exists to prevent, and it is what the deployed code would actually do.

**So nothing was promoted.** The ordering this establishes:

> **DEPLOY FIRST, INTEGRATE SECOND.** The universe-keyed schema is a precondition for US
> rows existing at all.

### The integration was fully rehearsed against the real production database

| step | result |
|---|---|
| migration on the production copy | **0.9 s**, 41.7 → 37.4 MB (VACUUM) |
| UCT value fingerprint across it | **IDENTICAL** (`c7578ff9…`) |
| `_merge_from` the audited artifact | **183,417 rows in 1.2 s** |
| re-merge | **0 rows** — idempotent |
| UCT after the US merge | **IDENTICAL**, 170,545 rows |
| US after the merge | identical to the audited artifact (`76091392…`) |
| derived reconstructed table | rebuilt to 4,679 rows by watermark |

### The darkness gate — passed on real integrated data (BL-027)

With publication untouched, each of the 18 V1 US identities has **4,703 rows in the
table** and is unreachable at every surface: `resolve` None · `is_breadth_symbol` False ·
ticker-search absent · catalogue absent · **`/api/bars` 0 bars**. The `symbols` payload
is byte-identical to the legacy 44. UCT serves 400 bars and stays searchable; no colon
leaks into prebuilt watchlists; `UCTA50` keeps its spelling. Dark warming: **0 series**.

`library_health()` separates the two facts: US `state=available`, **183,417 rows**,
`published=False`, `metrics_published=0`, overall `ok=True`.

**Flip rehearsal:** enabling US publishes **62 rows = 44 + exactly 18 V1 metrics**; the
V1 model is **70 = 16 UCT + 54 new**; `US:NETHL` keeps histogram/signed/count and serves
real negative closes; warming becomes 7 participation series. Disabling returns the
payload to the byte-identical 44 and **leaves all 183,417 rows in place**. `US:MU` and
`US:S2` hold 4,703 rows each and stay unreachable even when US is published — **stored is
not approved**.

### Rollback artifact

`C:\w\breadth-us-gate\rollback\prod_1789472774.tar.gz` — the exact pre-integration
production snapshot, plus its extracted DB and a recorded SHA-256. Restoring it is the
rollback; no row-level deletion is ever required.

⚠️ **The R2 artifact roughly doubles**: 8.1 MB → **16.5 MB** compressed (85.7 MB on
disk), ×5 retained ≈ 82 MB. The module still calls this store "single-digit MB".

⚠️ **One-directional sync is a durability gap.** The worker uploads, the web pod pulls,
**the worker never pulls** — so US history produced outside the worker has no supported
route into the origin of the snapshots. After the deploy the honest option is to let the
worker recompute US (68 min; every frame is already cached), rather than ship a merged
artifact the worker will re-point away from within hours.

### EXACT NEXT STEP

**Deploy the branch dark**, which runs the proven universe migration on both pods and
changes no member-visible behaviour, and only then integrate the US rows.

---

## Phase 15 — DARK FOUNDATION DEPLOY · **SAFELY BLOCKED** (2026-09-15)

**Branch** `feat/breadth-pit-foundation` @ **`281860228`** — master merged, **45 ahead /
0 behind** `origin/master` `65899a8f7`, tree clean. **Nothing deployed. Nothing migrated.
Production untouched.**

### Reconciliation — and one failure the merge resolved

`origin/master` merged cleanly (docs + the joystick gate harness; zero overlap with
breadth code). ⚠️ **The merge was not cosmetic**: `hub/surfaceMatrixIsCurrent.test.js`
was failing on the branch and passing on master, because the branch carried the OLD
`tools/hub_surface_matrix.mjs` (`67845d9e0` vs master's `5d70afc0e`) against an identical
committed doc — a file pair that must move together. The branch touches neither file;
being 20 commits behind was the whole cause, and the merge fixed it.

### Frontend gate — CLEAN against master

| | |
|---|---|
| branch (merged) | **8 files failing** |
| clean `origin/master` `65899a8f7` | **the same 8 files**, verified in a throwaway worktree |
| new failures attributable to this branch | **ZERO** |

The eight: `surfaces/manifest` (`/admin/wisdom` has no manifest row), `styles/tapFloor`
(journal-2-0 CSS), `pine.blindCorpus`, `ChartDrawingOverlay.surfaces`, `manifestProse`,
`ThemeTrackerPage.chartmount` (2), `pollingSites.rail`, `screener/reachable`. Every one
names a file outside this branch's diff. Pre-merge the branch showed 20,217 passed / 10
failed; post-merge the extra failure is gone.

⏳ The full backend A/B was restarted on the merged tree and is still running; it does
not change this phase's outcome, which is blocked on a hazard the tests cannot see.

### ⛔ THE BLOCKER — BL-028

The rolling-deploy audit was run against real SQLite with master's actual deployed SQL.
**Forward is safe in both mixed-version directions** — and only because US is absent.
**Backward is fatal**: master's `ON CONFLICT(date, metric)` matches no index after the
migration, so old code on an already-migrated volume cannot write breadth at all. That
state is reachable by a failed health check, not only by a deliberate rollback, and
`_migrate_universe_column` `DROP`s the original table.

⛔ **And the restore path does not exist.** The R2 bridge is an additive gap-fill merge
that never replaces a database; putting `prod_1789472774.tar.gz` back needs filesystem
access to the Railway volume. We hold the bytes; we have no way to install them.

§3 of the brief says to STOP before the production migration when a real old-code/
new-schema hazard exists and design the safe sequence first. **That is what this is.**

### The designed safe sequence

A temporary `UNIQUE INDEX (date, metric)` alongside the migration makes old code's UPSERT
match again — so a rollback stops being fatal — leaves new code unaffected, and **cannot
survive a second universe**, which turns "drop the compatibility index" into an
unmissable first step of US ingest rather than a remembered one. Deploy dark with it →
soak → confirm both pods new and one R2 round trip → drop it as step one of ingest.

### Rollback artifact

`rollback/prod_1789472774.tar.gz` · sha256 `5518974638daef7b…` · 8.1 MB gz / 41.7 MB ·
PRE-MIGRATION `(date, metric)` · 170,545 UCT rows · 2008-01-02 … 2026-08-07 · UCT value
fingerprint `c7578ff928440901…`.

### EXACT NEXT STEP

**Authorise (or amend) the compatibility-index sequence.** Until a rollback path exists,
the migration is a one-way door, and that is the owner's decision rather than mine.
