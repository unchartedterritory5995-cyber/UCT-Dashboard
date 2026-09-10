# Session state — `feat/indicator-r0r1`

**Written 2026-09-09 before a machine restart, so this wave can be picked up cold.**
Delete or rewrite it when the wave closes; it describes work in flight, not a ruling.

- Branch `feat/indicator-r0r1`, worktree `C:\Users\Patrick\uct-worktrees\indicator-r0r1`
- Pushed to `origin/feat/indicator-r0r1` (backup only — **not** a deploy); local and remote
  match. ⚠️ **No tip hash is written here on purpose** — this line named one and it went stale
  within the same session, which is the exact defect this repo keeps paying for. Read it with
  `git log --oneline -1`.
- Working tree clean. The `tests/fixtures/compat_harness/**` rows that show as modified are
  **CRLF churn with an empty content diff** — do not commit them.
- Engine suite: `cd app && npm run test:engine` → **4,956 passed, 2 failed** (see *Known reds*)

---

## The owner's order of work — where it stands

| # | item | state |
|---:|---|---|
| 1 | Land Kind 4 | ✅ merged from `worktree-indicator-ecosystem` (`cd078bbd2`), pieces verified |
| 2 | Barstate per the ruling | ✅ done end to end AND **MERGED + LANDED 2026-09-09** — semantics, calendar census, both runtimes, door, stability tests, divergence row, recorder, extended-hours rail |
| 3 | Volume through strict mode | ✅ measured, list below |
| 4 | TradingView visit | ⚠️ **DONE-EXCEPT (2026-09-10)** — A (Aroon) and B (fold numeric half) CAPTURED; C/D/E blocked, see below |
| 5 | SAR memoisation | ⚠️ **believed already spent — see *Open questions*** |
| 6 | Group B (eight names) with fixtures | ⬜ not started; measurements in `r11-group-b-arity.md` |
| 7 | `time(timeframe)` + `ta.valuewhen` | ⬜ not started; measurements in `r11-time-and-valuewhen.md` |
| 8 | Remaining real names in demand order | ⬜ not started; list in `r11-remaining-nine.md` |
| 9 | Group C order-asserting rail | ⬜ not started; why the outcome-shaped version is vacuous is in `r11-vocabulary-gap.md` |
| 10 | M1 — Volume's numeric plots as a pane behind the flag | ⬜ not started |
| 11 | **NYSE calendar cross-lane parity** — see below | ✅ **11a DONE** (`1c98b4493`) — the rail already existed and the sets AGREE; two blind spots closed. 11b still logged |

⛔⛔ **ITEMS 6–10 ARE GATED.** `pineRuntimeFrontend.js` may not be wired to any
route until a producer feeds `opts.newestBarIsForming` from Python's
`bar_close_state`. Until then the JS lane renders CLOCK_REALTIME blank by design.
Measured: at `35ba654da` the lane was already blank; at `3a1d9d4a3` it was
confidently wrong. Enforced by
`app/src/components/chart/engine/__tests__/pineRuntimeFrontendGate.test.js` —
when it goes red, build the producer and delete the test in that same commit.

### Item 11 — the JS-side NYSE calendar (logged, deliberately NOT in this merge)

⛔ **`app/src/lib/marketClock/nyseCalendar.js` IS OUT OF SCOPE FOR THE BARSTATE MERGE.**
Owner ruling 2026-09-09: do not touch it or its six consumers. It ships
`NYSE_HOLIDAYS_2026/2027` **and** `NYSE_EARLY_CLOSES_2026/2027` as code and is
load-bearing for `useMarketOpen`, `StockChart`, `sessionModel`, `sessionStale`,
`useBrokerMarkPreference`, `EarningsCard`, `weekAnchor`, `ChartDayGain`,
`GridChartCell` — deleting it breaks live UI.

⚠️ It is nonetheless a **second authority over the same NYSE dates, in a second
language** — the exact hazard the barstate seam ruling is built around, sitting one
directory away. It predates this wave and is not something this merge introduced.

- **11a.** A cross-lane PARITY test: `nyseCalendar.js` full closures ==
  `ast_interpret._nyse_full_closures()`, early closes ==
  `liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD` — as SETS, asserted in BOTH
  directions so neither lane may carry a date the other lacks. Runs in the JS suite,
  either off a small JSON the Python side emits or by reading both files directly.
- **11b.** Later, not now: GENERATE `nyseCalendar.js`'s data from the Python sets so
  there is one hand-maintained source and the parity test becomes structural rather
  than a diff.

⛔ Nothing is written for item 11 in this merge beyond this entry.

Also outstanding from the owner's §3: apply the *"guard shipped unable to fire"* control rule
**retroactively to the object pool and the licence rail**.

---

## ⛔ Item 4 — exactly what is blocked, and the likely fix

The visit needs, before **any** study is added:

```js
document.visibilityState === 'visible' && document.hasFocus() === true
```

Both read false all session (`hidden` / `false`), so nothing was added — per the standing
instruction to stop rather than proceed.

⭐ **The probable cause is recoverable and the restart may fix it by itself.** The tab was
opened with `tabs_context_mcp{createIfEmpty:true}`, which creates a **new Chrome window**.
Foregrounding the owner's own window therefore never raised it. On resume: open the chart in
the window actually in front, and drive **that** tab.

Chart used: `https://www.tradingview.com/chart/VEeQHWPh/` — layout *UCT Vendor Capture*, and
it already carries `UCTPROBE_NS`, `UT Vol` and the other session's `Uncharted Clouds`.

⚠️ **Chart state was restored and verified before the session ended**: `AMEX:SPY`, `1D`, pane
stretch `[2000, 1000, 1000]`, all studies intact, no injected globals. Nothing to undo.

**Jobs waiting on that visit, in order:** live Aroon (SPY 1D, length 14) · the fold probe's
*numeric* half · the five-symbol containment probes · the three remaining barstate predicates
(`isrealtime`, `isnew`, `islastconfirmedhistory`) for completeness of the vendor fixture, even
though we no longer match them.

Probe sources are committed and ready to paste: `tools/visual_conformance/probes/`.

⛔ **What a hidden tab does and does not cost** is now written up in `capture-procedure.md` —
value reads are immune, **adding a study is not**, and `insertStudy` reports success while
inserting nothing.

---

## Volume's refusal list — verbatim, as of the barstate work landing

```
SCREENER (default)     ok=false  refusals=5
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:function  line 225  token `ta.cum`
    pine:window    line 233  token `isWeekly`
HOST / pane (strict)   ok=false  refusals=4
    pine:window    line 233  token `isWeekly`
    pine:window    line 233  token `isWeekly`
    pine:window    line 233  token `isWeekly`
    pine:reassign  line 250  token `:=`
```

⚠️ **`strict: true` is HOST/pane, not screener** — an earlier report in this wave had the two
labels inverted. The list above is the corrected one.

All five `barstate.*` sites (296, 299, 399, 429, 450) translate now. `ta.cum` refusing for a
screen and not a pane is the `window_dependent` ruling working. `pine:reassign` at 250 is new
and expected — it was always there and translation never reached it because barstate refused
first. `pine:window` 233 is the bind-time fold, the **other session's** work.

## Three-number metric: **30/266 host · 45/266 screener — unmoved**

Barstate moved the *pane*, not the corpus: `isconfirmed` already folded for the screener, and
those scripts are blocked by `pine:function` / `pine:request` / `pine:tuple` regardless.

---

## Known reds — routed, not silenced

1. **`tests/test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE`** — inherited
   from the Kind 4 merge, **not ours**. Verified pre-existing by checking out HEAD's own
   `closedTable.json` and `indicator_compute.py`, running it, and restoring (hashes verified
   both directions): it fails identically with none of this wave's changes.
2. **Two census floors** — `capabilityDemandCensus` and `historyDemandCensus`, both
   `expected 129 to be greater than 150`. Diagnosed: `tests/fixtures/oos2_parity` is **empty**,
   and neither census includes `corpus/committed` at all. ⛔ **So "re-census" in items 5–8 is
   measuring 129 scripts, not 395** — worth settling before those items lean on it.

⛔ **Do not claim repo-green** while either stands.

---

## Open questions for the owner

1. **Item 5 (SAR memoisation) looks already spent.** The memo was built in this wave and
   **discarded**: it silently dropped `accum(...)` from four supertrend-family scripts — same
   guards, `ok:true` both ways, a formula that had quietly stopped being stateful — caught only
   by a byte-for-byte corpus comparison against the previous translator. It also bought almost
   nothing (2 cache stores on SAR). The whole **11.6s → 43ms** came from the depth bound, which
   is shipped with its three tests and a 1,000 ms regression ceiling. Re-attempting the memo
   would re-introduce a known-wrong result, so it is **not** being retried without a reason.
2. **`symbolScope.json::confirmed` is still empty and this wave did not fill it.** The
   five-symbol capture read `syminfo.tickerid`, which is a **different field** from
   `syminfo.exchange` that the map is keyed on. Filling it from what we measured would be the
   *"assertion wearing a data structure"* that file warns against.

---

## Where the reference material lives

| topic | file |
|---|---|
| barstate semantics, calendar, stability property | `docs/pine/barstate.md` |
| rails earned this wave (incl. the swallowed-host-error rule) | `docs/pine/rails.md` |
| hidden-tab / capture rules | `docs/pine/capture-procedure.md` |
| Group B arity, measured | `docs/pine/r11-group-b-arity.md` |
| `time()` + `ta.valuewhen` demand | `docs/pine/r11-time-and-valuewhen.md` |
| the remaining nine names | `docs/pine/r11-remaining-nine.md` |
| census + Group C | `docs/pine/r11-vocabulary-gap.md` |
| vendor captures | `tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json` |
| divergence disclosure | `tests/fixtures/vendor/divergences.json` |

## Standing constraints for this wave

Open-source scripts only; never read/reproduce protected or invite-only scripts; **AGPL
projects (PineTS, piner, pyne, pinescription, vela-pinets) must not be read, vendored or
linked**; the $1,199/dev/yr licence is declined; product copy says *"supports Pine Script®"*
descriptively only; nothing shipped is named Pine.

Shared worktree: **never `git add -A`**, pathspec commits only, never `git checkout` to revert
a mutation probe, never bare `git stash`. Merge `worktree-indicator-ecosystem` at every phase
boundary and record conflicts touched.

**Pause on:** member data · a vendor contradiction (Aroon, valuewhen, the fold probe) · the
other session's files · the calendar census contradicting the screener's session logic · a real
blocker.

---

# ✅ THE MERGE IS LANDED — the collision below is CLOSED (2026-09-09)

`worktree-indicator-ecosystem` merged into `feat/indicator-r0r1` and pushed. The
probe worktree and `merge-probe/r0r1-x-ecosystem` are retired; nothing is left to
replay. Everything from here down is the RECORD of how it was resolved, not work
in flight.

- Merge commit `b91101ae0`, landed fast-forward; branch tip pushed.
- 16 files / 47 hunks resolved. Two defects the auto-merge itself created were
  found and fixed: a second, unreachable barstate dispatch in `pine.js`, and the
  `pine:window-dependent` guard it took with it.
- `tools/record_clock_parity.py` is new — `clock_parity.json` is reproducible now,
  and both prior fixtures turned out to be correct recordings at different forming
  states (mine `false`, theirs `true`). The conflict was serialization noise.
- The NYSE sets moved to `api/services/nyse_calendar.py`, a dependency-free leaf.
  `bars_fetch` and `liveflow_monitor` re-export them; all 55 read sites untouched.
- ⛔ **Items 6–10 are GATED** — see the gate note above the order table.
- ⛔ **Routed to the ecosystem session**, not fixed here: `test_definition_concierge`
  ×2 is red on `35ba654da` itself. Diagnosis in `requests.md`.

---

# ⛔⛔ FIRST THING ON RESUME — the two sessions BOTH implemented barstate

Discovered at the end of the session, after `84a52adf7`. `worktree-indicator-ecosystem`
carries three new commits, one of which is **`ae2ed68ec` "barstate: six columns from the clock
and the fetch, one refusal, two named gaps"**.

⭐⭐ **THE TWO IMPLEMENTATIONS AGREE ON THE RULING, INDEPENDENTLY** — which is the evidence
standard this repo values, and it is worth more than either version alone. Both arrived at:
six clock columns owned by `computeClock` / `compute_clock`; `islast` **not** window-dependent
and `isfirst` **is**; `BUILTIN_REQUEST_DEPENDENT` emptied-but-kept with its reasoning;
`barstate.isnew` refused on both contracts; the host no longer refusing `pine:live-bar-state`;
the screener fold untouched.

## ⚠️ …but the CALENDAR CENSUS disagrees, and they may be right

| | this branch (`cc1171d23`) | theirs (`ae2ed68ec`) |
|---|---|---|
| full closures | `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` | same — agreed |
| **early closes** | **represented** — found `liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD` and used it | **not known** — cites `bars_fetch`'s own words that half-days are *"intentionally NOT"* included; ships regular-session-only with the gap NAMED |
| **extended hours** | assumed regular-session-only, *"an assumption with a test"* | ⛔ **measured that extended-hours bars CAN appear** — `bars_fetch` keeps those prints deliberately and the yfinance fallback asks `prepost=True` |

⛔ **Their extended-hours finding is a measurement and mine was an assumption, so mine is the
one to distrust.** `docs/pine/barstate.md` on this branch asserts *"The bars pipeline delivers
regular-session bars"* — **treat that sentence as unverified until re-measured.** If they are
right, "the regular session was open" is not a precondition any of this may rely on, and the
scheduled-close logic for a daily bar needs revisiting.

⚠️ On early closes we each found something the other did not: they read the `bars_fetch`
comment, I found a second set in `liveflow_monitor`. **Both facts are true** — the half-day
dates exist in the repo, and the bars authority deliberately excludes them. What that means for
`isrealtime` is a decision, not a lookup.

## The merge is deliberately NOT done

`git merge worktree-indicator-ecosystem` conflicts in **16 files**:

```
api/services/indicator_compute.py
app/src/components/chart/indicators.js
app/src/components/chart/engine/ast/closedTable.json
app/src/components/chart/engine/ast/pine.js
app/src/components/chart/engine/ast/pine.barstate.test.js
app/src/components/chart/engine/ast/pineStrictMode.test.js
app/src/components/chart/engine/ast/pine.blindCorpus.test.js
app/src/components/chart/engine/ast/pine.refusalAuthority.test.js
app/src/components/chart/engine/ast/parse.test.js
app/src/components/chart/engine/ast/sentence.test.js
app/src/components/chart/engine/__tests__/clockTimeframeWire.test.js
tests/fixtures/ast/clock_parity.json
tests/fixtures/vendor/divergences.json
tests/test_ast_interpret.py
docs/formulas/GRAMMAR.md
docs/pine/barstate.md
```

Assessed with `merge --no-commit` and then **aborted**, so the tree is clean at `84a52adf7`.
⛔ A half-resolved merge left across a machine restart is the worst possible state; the merge
wants a session that can finish it.

## ✅ RESOLVED 2026-09-09 (post-restart) — the calendar question, settled on evidence

Steps 1 and 2 below are **done**. Measured in the code, not assumed, and it moved **both**
branches.

**Extended hours — theirs is right, mine was wrong, and mine was wrong twice.**
Extended-hours prints **do** reach a fetch, but **only an intraday one**:
`bars_fetch._fetch_intraday_yfinance` asks `prepost=True`, the serve-time filter keeps those
prints on purpose (*"Zero volume is legitimate (illiquid / extended-hours) and is kept"*), and
the freshness gate names 04:00–20:00 ET as the window where *"extended-hours and RTH coexist"*.
**D/W/M do not carry them** — the single `prepost=True` site reads `_YF_CONFIG`, which is
intraday-only, the daily path passes no `prepost`, and `api/index_bars.py` passes `False`.

⛔ **Worse than the wrong premise:** `barstate.md` called it *"an assumption with a test"* and
**there is no such test** — `pine.barstate.test.js` asserts nothing about sessions, hours,
holidays or early closes. A safety net was cited as the reason to accept an assumption and was
never built. Corrected on this branch; the false sentence is gone.

**Consequence is bounded — no number changes.** Intraday `bar_open + interval` is right for a
different reason than the doc gave, and the D/W/M scheduled close survives intact.

**Early closes — MINE is right and THEIR commit message is factually wrong for this repo.**
`ae2ed68ec` ships *"Gap 1 — early closes are not known"*, reasoning from `bars_fetch`'s comment
that half-days are *"intentionally NOT"* in **that** set. True of that set; false of the repo.
`liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD` (line 84) is a real frozenset —
`20250703, 20251128, 20251224, 20261127, 20261224, 20271126` — with **five** consumers
(`flow_gap_autofill`, `voice_temporal_awareness`, `liveflow_monitor` ×2, and the parity test
`tests/test_nyse_calendar_parity.py`), and `indicator_compute.py:1514` already names it the ONE
authority. ⭐ **So their `barstate.test.js` asserts a defect that does not need to exist**, and
their Gap 1 closes outright on merge.

### What the merge should therefore produce — strictly better than either branch

| take | from | why |
|---|---|---|
| intraday reasoning + the extended-hours test | **theirs** | measured; mine reached the same formula from a false premise |
| the early-close set, wired in | **mine** | it exists, has five readers and a parity test — closes their Gap 1 |
| closure set handed in as a parameter (their Gap 2) | **theirs** | correct, and it honours the calendar-must-not-enter-JS rule |
| `barstateStability.test.js`, the `divergences.json` row, the `pine:window-dependent` guard, both rail-tightenings | **mine** | theirs lacks all four |

⛔ **Still NOT merged** — 16 files, and it wants one uninterrupted session. Nothing above has
been applied to the merge; only `barstate.md` on this branch was corrected.

---

## What resume should do, in order

1. ✅ **DONE — do not blind-merge.** Read `ae2ed68ec` in full first. The conflicts are two correct
   implementations of one ruling, not a mistake to be resolved mechanically.
2. ✅ **DONE — settled on evidence; see the RESOLVED block above.** Re-measure whether
   extended-hours bars reach a fetch. That answer decides the scheduled-close logic and it is
   the only place the two versions genuinely disagree about behaviour.
3. Decide which implementation survives — probably theirs for the calendar half, since it was
   measured — and carry over anything this branch has that theirs lacks: the
   **stability tests** (`barstateStability.test.js`), the **`divergences.json` row**, the
   **`pine:window-dependent` guard**, and the **rail-tightenings** (both
   `pineTimeframeAlias` and `clockTimeframeWire` had been deriving "timeframe flag" as
   *clock keys starting with `is`*, a correct set reached by a wrong rule).
4. Then resume the ten-item order at item 4.

---

## Decisions taken autonomously — 2026-09-10

Logged under the autonomous directive of 2026-09-10T12:02:54-04:00. Each is a choice the directive did not
settle; the rails were preserved in every case.

1. **Track B ran in a subagent that was forbidden to commit.** The directive allows a
   subagent but requires one committer and one pusher. Rather than coordinate two writers in
   one worktree, the subagent was scoped to edits + test runs only and this session commits
   everything. Reason: `feedback_agent_authority_and_worktree_isolation` (incident #4).

2. **A1's unbind: two pointer attempts, not three, before the API fallback.** The editor's
   ⋯ menu holds only editor settings / open-editor / developer tools — no new-script action —
   and the script-title control was not resolvable from the DOM among the chart-header
   controls. The directive's own fallback (`createModel` + `setModel`) was taken early
   because it is deterministic. Reason: a third pointer guess is not evidence, and the
   fallback was explicitly sanctioned.

3. **⛔ C / D / E ARE BLOCKED, AND THE BLOCK IS REPORTED RATHER THAN WORKED AROUND.**
   `createModel` + `setModel` swaps the Monaco buffer but the action button still reads
   "Update on chart" — TradingView keeps the binding outside the model. Clicking it would
   write to `Script$USER;787899e2…`, which is the owner's account-scoped script: **hard stop
   H1**. So EXCHANGE, TUPLE and BARSTATE were not added. Their bytes were verified in the
   buffer (EXCHANGE: 8791 chars, sha256 e63b4872…e30f, EXACT) before stopping.

4. **The FOLD study was captured before the binding hazard was understood, and its capture
   stands.** Its bytes were verified byte-identical to the committed source *before* the
   Update, and its roster matched `_metaInfo.plots` order, so the measurement is sound even
   though the add mechanism turned out to be an in-place edit. Job B is committed at
   `e8406af75`.

5. **`UCTPROBE_NS`'s on-chart variant is left absent rather than restored.** Restoring it
   would require another Update against the bound editor — the exact H1 action. It is
   recoverable from `a57b06986`; noted in `UCTPROBE_NS.provenance.json`.

### Item 4 — what landed and what did not (2026-09-10)

| job | state | evidence |
|---|---|---|
| A · Aroon 2c | ✅ **CAPTURED** | `bb486dc36` + `3d845dd94` · `tests/fixtures/vendor/aroon-spy-1d-2026-09-10.json` |
| B · fold numeric half (1g) | ✅ **CAPTURED** | `e8406af75` · 1D `fold==sma20` 400/400 · 1W `fold==sma5` 400/400 |
| C · seven witnesses | ⛔ blocked | bytes verified in the buffer (8791 chars, sha256 `e63b4872…e30f`); study never added |
| D · barstate ×3 | ⛔ blocked | `barstate-full.pine` committed, 26 plots BY SOURCE only |
| E · tuple-security | ⛔ blocked | probe committed, not attempted |
| V1 · NS source | ✅ **COMMITTED VERBATIM** | `a57b06986` · sha256 `2b9fecc6…caa3`, receipt agreed four ways |

⛔⛔ **WHAT BLOCKS C/D/E IS ONE HUMAN ACTION, NOT A DECISION.** The Pine editor is
BOUND to the script whose source was opened, so its action button reads *"Update on
chart"* — which edits that study in place rather than adding a new one. Clicking it
against `Script$USER;787899e2…` would write to the owner's account-scoped script.
Swapping the Monaco model does **not** unbind it (measured: uri changes, button does
not). The unbind is *New indicator* in the editor's script-title dropdown.

⭐ **ONCE EACH PROBE IS SAVED UNDER ITS NAME, EVERY FUTURE VISIT IS `createStudy`-BY-ID
WITH NO EDITOR AT ALL** — and the Monaco handle (webpack module scan, see
`capture-procedure.md`) writes the buffer with no paste, so the rest is unattended.

⭐⭐ **RULING 1g IS SETTLED BY MEASUREMENT.** The vendor folds a timeframe-conditional
length to a plain integer at bind time: `fold == sma20` on 400/400 daily bars and
`fold == sma5` on 400/400 weekly. That is the shape at Uncharted Volume line 233 which
`pine:window` still refuses — so runbook item 1 (wire the bind-time fold into the
translate path) now has its vendor confirmation.

