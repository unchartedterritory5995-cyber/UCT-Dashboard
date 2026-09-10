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
| 4 | TradingView visit | ✅ **DONE (2026-09-10 evening)** — A, B, C, D, E all captured; seven probes are SAVED SCRIPTS (`saved-scripts.json`). ⚰️ **The rest of this row was a FORECAST AND IT IS MEASURED FALSE (2026-09-10, later the same evening):** *"so every future visit is `createStudy` by id: no editor, no paste, no binding hazard"*. Seven variants were tried and every one refused — the table is in `docs/pine/capture-procedure.md`. ⭐ What DOES work with no chart at all: `pine-facade/translate/<id>/last` returns the vendor's own plot roster, which is the H6 shape gate (`tests/fixtures/vendor/saved-probe-integrity-2026-09-10.json`, all seven pass). Adding a study still needs the editor route |
| 5 | SAR memoisation | ✅ **CLOSED 2026-09-10 — NOT BEING RETRIED, and the reason is a measurement.** The memo was built in this wave and DISCARDED: it silently dropped `accum(...)` from four supertrend-family scripts — same guards, `ok:true` both ways, a formula that had quietly stopped being stateful — caught only by a byte-for-byte corpus comparison against the previous translator. It also bought almost nothing (2 cache stores on SAR); the whole **11.6s → 43ms** came from the depth bound, which is shipped with three tests and a 1,000 ms regression ceiling. ⛔ Re-attempting it re-introduces a KNOWN-WRONG result for a win already banked elsewhere, so it needs a new reason, not a new attempt |
| 6 | Group B (eight names) with fixtures | ⚠️ **UNBLOCKED, NOT DONE** — still "eight vendor readings, not eight guesses", and `ta.tr(true)` is still the template (the argument CHANGES THE MATHS). ⭐ The stated blocker — *"the same editor binding as item 4's C/D/E"* — is gone, but a DIFFERENT one replaced it: five Group B probes are authored and three are saved, and the three unrun readings (pivothigh/low, math.round, math.max variadic, vwap 1-arg) are blocked on the add mechanism refuted under item 4. `ta.highest`/`lowest` defaulting — the 81-site question — is authored and SAVED (`UCTPROBE_GB_HILO`, roster 11 confirmed against the vendor) and still unread |
| 7 | `time(timeframe)` + `ta.valuewhen` | ⚠️ **PROBES AUTHORED 2026-09-10, READINGS NOT TAKEN** — all eight questions of `r11-time-and-valuewhen.md` are now committed as three probes, split so one risky arity cannot take the others down: `r11-time-tf.pine` (Q1/Q2/Q4, 10 plots), `r11-time-session.pine` (Q3 alone — the two-arg session form; ⛔ read it INTRADAY or every bar is inside the session and it answers nothing), `r11-valuewhen.pine` (12 plots, and it carries its own oracle: `bar_index % 5 == 0` makes the right answer computable, with the inclusive/exclusive discriminating bars marked). Blocked on the same add mechanism as item 6 |
| 8 | Remaining real names in demand order | ⚠️ **NOT DONE, AND "CHEAP TO TAKE" NO LONGER HOLDS** — it rested on the by-id add refuted under item 4. Still "a vocabulary backlog, not an unlock plan"; the next visit should fix the add route FIRST, because items 6, 7 and 8 are all queued behind that single mechanism |
| 9 | Group C order-asserting rail | ✅ **DONE** (`771a101ac`) — asserted on ORDER over pine.js's AST, with two non-vacuity controls; mutation-proved |
| 10 | M1 — Volume's numeric plots as a pane behind the flag | ⛔ **BLOCKED ON THE OWNER** — §6 was truncated mid-sentence at "Feature fl…"; the runbook says ask for the tail before starting M1 |
| 11 | **NYSE calendar cross-lane parity** — see below | ✅ **11a DONE** (`1c98b4493`) — the rail already existed and the sets AGREE; two blind spots closed. 11b still logged |
| 12 | `record_clock_parity.py --check` in CI | ✅ **DONE** (`86e31c706`) — red observed on a perturbed fixture, then reverted |
| 13 | live window reads the calendar leaf | ✅ **DONE** (`2a89bf997`) — half-days shorten the window to 13:00 ET; discriminator + control mutation-proved |

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

## ✅ Item 4 — DONE. What was "blocked" and what it actually was (2026-09-10)

⚰️ **THIS SECTION SAID THE VISIT WAS BLOCKED ON `document.visibilityState === 'visible' &&
document.hasFocus()`, AND THAT WAS THE WRONG DIAGNOSIS TWICE OVER.** The hidden-tab gate was
already retired on evidence (`0daa7d1fd`); what remained was a claim that a new study needed a
human paste and a human unbind. Neither is true.

⭐⭐ **THE FOUR PROBES ARE SAVED TRADINGVIEW SCRIPTS.** Ids, receipts and the capture
procedure live in `tools/visual_conformance/probes/saved-scripts.json` — read them from there,
never from prose:

| probe | saved as | plots | state |
|---|---|---:|---|
| `fold-pass.pine` | UCTPROBE_FOLD | 5 | ✅ compiles, on chart |
| `tuple-security.pine` | UCTPROBE_TUPLE | 26 | ✅ compiles, on chart |
| `barstate-full.pine` | UCTPROBE_BARSTATE_FULL | 26 | ✅ compiles, on chart |
| `exchange-spelling.pine` | UCTPROBE_EXCHANGE | 11 | ✅ compiles, on chart (v1 did not — see below) |

**Every future visit is `createStudy` by id.** No editor, no paste, no binding hazard, no
person. Per probe the route was: script-title dropdown → Create new → Indicator (the unbind —
three pointer clicks, not a human action), `model.setValue()` through the Monaco handle,
sha256-verified IN THE EDITOR against the committed file, Save, Add to chart.

**Captures landed:** A (Aroon) and B (fold numeric) earlier; then
- **C** — `exchange-spelling-seven-witnesses-2026-09-10.json`
- **D** — `barstate-full-spy-1d-closed-2026-09-10.json`
- **E** — `tuple-security-spy-1d-closed-2026-09-10.json`

⛔⛔ **AND THE EXCHANGE PROBE COULD NEVER HAVE RUN.** `syminfo.exchange` is not a Pine v6
identifier — the vendor answers `CE10272`. The field is `syminfo.prefix`. Renamed everywhere on
a measurement (0 uses of the old name across all 502 tracked `.pine` files, with an R6 control
proving the reader could see it), N11 deleted as vacuous, and `symbolScope.json::confirmed`
filled with six witnessed rows. Both vendor fields now SERVE for the yfinance leg of our store.

⚠️ **WHAT STILL NEEDS MARKET HOURS.** Job E's N23 (the HTF arm, the only place the
gaps × lookahead combinations can diverge) and the D-realtime run both need 09:30–16:00 ET.
The closed-session run finished at ~17:05 ET, and its four equal gaps/lookahead readings
discriminate nothing — recorded as measured, explicitly not as an answer.

⛔ **What a hidden tab does and does not cost** is written up in `capture-procedure.md` —
value reads are immune, **adding a study is not**, and `insertStudy` reports success while
inserting nothing. That file also now carries FOUR THINGS THAT LOOK LIKE SUCCESS AND ARE NOT,
each hit in this session: a failed study keeps a one-plot stub whose roster reads fine; the
vendor stores CRLF so a naive sha compare fails on every script and means nothing; plot rosters
need a balanced-paren scan, never a regex (the third regex under-count in two days); and the
action button is icon-only in some states with an x that moves within a session.

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

1. ✅ **ANSWERED AND CLOSED 2026-09-10 — item 5's row in the table above now owns this, and this entry is kept only so the reasoning is not lost.** The memo was built in this wave and
   **discarded**: it silently dropped `accum(...)` from four supertrend-family scripts — same
   guards, `ok:true` both ways, a formula that had quietly stopped being stateful — caught only
   by a byte-for-byte corpus comparison against the previous translator. It also bought almost
   nothing (2 cache stores on SAR). The whole **11.6s → 43ms** came from the depth bound, which
   is shipped with its three tests and a 1,000 ms regression ceiling. Re-attempting the memo
   would re-introduce a known-wrong result, so it is **not** being retried without a reason.
2. ⚰️ **`symbolScope.json::confirmed` IS NO LONGER EMPTY — FILLED 2026-09-10 with six
   witnessed rows.** This read *"still empty and this wave did not fill it"*, and it was right
   at the time: the five-symbol capture read `syminfo.tickerid`, a **different field** from the
   one the map is keyed on, and filling it from that would have been the *"assertion wearing a
   data structure"* that file warns against. ⛔ **THE FIELD IT NAMED DOES NOT EXIST.**
   `syminfo.exchange` is not a Pine v6 identifier (CE10272); the exchange is **`syminfo.prefix`**.
   The binding was renamed everywhere on a measurement — 0 uses of the old name across all 502
   tracked `.pine` files — and job C's seven witnesses landed six rows, so both vendor fields
   now SERVE for the yfinance leg of our store and still refuse for the FMP free-text half.
   Capture: `tests/fixtures/vendor/exchange-spelling-seven-witnesses-2026-09-10.json`.

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

### R7 — PYTHON LANE DISCIPLINE (owner, 2026-09-10, verbatim)

> Never run a bare `pytest tests/`. The full Python lane runs ONLY via the repo's
> chunked config (the 12-chunk mode used for the F9/L4 runs), chunks sequential,
> never in parallel. Named files for anything targeted. Never read pytest's status
> through a pipe: redirect to a file, then read the file and `${PIPESTATUS[0]}` /
> the process's own exit code. A run that 'finished quietly' with a tiny log and no
> exit code is an OOM kill until proven otherwise. Same for vitest: a reporter that
> 'passed' without running is caught by asserting the test count moved. Record R7 in
> SESSION-STATE and the runbook with tonight's three kills as the reason.

**Tonight's three kills are the reason.** 2026-09-10: three unscoped `pytest tests/`
runs were OOM-killed by the host -- pid 5024, then pid 12872 at **15.9 GB** and pid 33464
at 6.6 GB, the last two found and reported by ANOTHER SESSION whose background work they
took down with them. All three were invisible here, and the same mistake hid each one: the
run was piped to `tail`, so the shell reported TAIL's exit code. A killed pytest behind a
pipe leaves an empty log and a zero exit, which reads first as "still running" and then as
"finished quietly". Two of the three were read that way on the same night.

⭐⭐ **The memory goes on COLLECTION, not execution** (measured by the peer session:
`--collect-only` alone reaches ~4.5 GB), because `api/main.py` is ~9,800 lines mounting
~986 routes and the repo-root `conftest.py` runs an AST census over `api/**`, `scripts/`
and `tools/` at import. So `-k` and `--timeout` cannot contain it -- they filter AFTER
collection. Only giving pytest FEWER FILES does, which is what makes chunking work.

⛔ The runner is `tools/pytest_chunks.py` (committed with this rail -- the repo had SAID
"chunked suite runners" in `pytest.ini` and `tools/tests_reaching.py` for months while no
chunk runner existed; a rule that lives only in prose is one that gets skipped by whoever
has not read the prose). It walks `pytest.ini::testpaths` off the FILESYSTEM rather than
asking pytest to enumerate the suite -- that enumeration is the very thing that blows up --
keeps each chunk's own `returncode`, and reports a chunk with no summary line as **KILLED**
rather than folding it into "0 failed".


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
6. **Track B's helper was made PRIVATE (`_session_length_et`) rather than public.**
   Named public it turned `test_scan_evaluator_off_request_path.py` red — a rail requiring
   every PUBLIC function of `scan_evaluator` to be explicitly ruled either "the sweep" or
   "proven free of universe-scale work". Editing that rail's declared list for an internal
   helper would have been a reach ruling taken unilaterally; renaming was the smaller,
   truer change. The module's ruled public surface is byte-for-byte unchanged.

7. **⚰️ `_live_window_reason` DOES NOT EXIST AND NEVER DID.** Three artifacts named it —
   a comment in `scan_evaluator.py`, one in `test_scan_sweep_bar_close_state.py`, and the
   directive that sent this work. The real gate is `_live_session_state`. The two in-repo
   copies were corrected. ⛔ A function name repeated across three artifacts reads as
   corroboration; none of them was checked against the module.

8. **The census floors were routed, not fixed, and the "repopulate the fixture" remedy was
   explicitly closed off.** `tests/fixtures/oos2_parity` contributes 0 scripts *by
   deliberate licence policy* — its `.gitignore` is `*.pine` because six of ten members are
   redistribution-restricted, so all ten are withheld. Counted at the commit that wrote the
   floor, the census was **129** then too: `> 150` has never been satisfiable and this is
   not a regression from the corpus expansion. Both remedies are in `requests.md` with
   their costs and neither is recommended — the census population is their measurement
   decision.

9. **Track C (items 6–10) was NOT started.** Its first task is a producer that wires
   `pineRuntimeFrontend.js` to a member-visible route and retires the L1 gate in the same
   commit. The path is now fully mapped (below), but building it under time pressure at the
   end of a long run is how a member-visible regression (H3) or a weakened rail (H4) gets
   shipped. Mapping it and stopping is the honest state.

### Later the same day — the directive of 2026-09-10 evening (R7 / Rulings A-C / browser)

10. **⛔⛔ RULING C WAS GIVEN TWO BRANCHES AND THE MEASUREMENT FITTED NEITHER.** The directive
    said: if `barssince` serves the Pine lane only, pin `na` semantics and a 1-arg signature;
    if it also serves native features, split it. Both branches presuppose our 2-arg
    declaration is a mis-transcription. The census (R6 control: 712 occurrences / 111 files,
    then narrowed) says it is not — `barssince(condition, n)` is one of the FIVE BOUNDED STATE
    entries and `n` is the WINDOW the count saturates at, the bound the budget is priced on.
    Narrowing to Pine's arity would DELETE that bound. So neither branch was taken; the
    divergence row was written at MEASURED tier as the directive required, and the third
    answer was reported rather than forced into one of the two offered. ⚰️ It also corrects
    `8f1d9836c`, which wrote the obvious reading down on the day of the capture.

11. **A PRE-EXISTING RED WAS FIXED RATHER THAN ROUTED, because the rail was right.**
    `barstate-viewer-dependent-on-vendor` claimed `confidence: measured` while its `measured`
    block was a bare sentence holding no number, so the note-vs-ledger rail had nothing to
    hold the member's sentence against. Proved older than tonight by running the rail against
    the committed tree BEFORE editing. Both halves were repaired, never relaxed: numbers
    DERIVED from the captures, and the member note given the same numbers.

12. **THE `createStudy`-BY-ID HUNT WAS STOPPED AT SEVEN VARIANTS AND WRITTEN DOWN.** Each was
    measured with the roster checked afterwards; the furthest reached
    `_canApplyStudyToParent`. Continuing was the rabbit hole, and switching to the editor
    route at the tail of a mechanism hunt is how the binding hazard (H1) gets tripped. What
    the hunt DID produce is better than what it replaced for one job:
    `pine-facade/translate/<id>/last` gates a saved probe's roster with no chart at all.

13. **Item 7 was advanced by the half that does not need the browser.** All eight questions
    are committed as three probes, split so one risky arity cannot sink the others. Item 8's
    "the readings are now cheap to take" was WITHDRAWN rather than left standing — it rested
    on the by-id add, and items 6, 7 and 8 are now all queued behind that one mechanism.

14. **The JS lane was HELD while the chunked Python lane ran.** Another session's pytest was
    also live on this box at ~1 GB. R7 exists because three unscoped runs OOM-killed the host
    tonight and took a peer session's work down with them; stacking a 220-file vitest run on
    top of two live pytest processes is the same mistake wearing a different runtime.
### ✅ The producer — BUILT 2026-09-10 (`521a52816` + `9dfe101e0`)

The JS seam ALREADY EXISTS and already consumes the tri-state — what is missing is only
something that produces it:

| where | today | needs |
|---|---|---|
| `api/routers/bars.py` | ✅ emits `newest_bar_is_forming` via `_augment_with_bar_close_state` |
| StockChart.jsx bars SWR | ✅ `data?.newest_bar_is_forming ?? null` onto the binder ctx |
| `binder.js` | ✅ `computeFor(..., { sym, tf, newestBarIsForming })` |
| `nativeRegistry` | ✅ both `interpret()` call sites thread it |
| `interpret.js:2777` | already reads `opts.newestBarIsForming` | ✅ nothing to do |
| `indicators.js:1253` `computeClock(bars, tf, newestBarIsForming = null)` | already tri-state | ✅ nothing to do |

⛔ The gate test `pineRuntimeFrontendGate.test.js` is retired in the SAME commit that wires
the route — never before, and never by editing it to keep passing.

⭐⭐ **MEMBER-VISIBLE, AND IT IS AN ADDITION.** `barstate.isrealtime`,
`isconfirmed`, `ishistory` and `islastconfirmedhistory` had rendered BLANK on every
chart since the barstate ruling landed — nothing in `app/src` ever set the value the
column layer was already reading. They now answer. Nothing that worked before stops.

⚠️ **THE WIRE FORMAT NEEDED AN ADAPTER, and its absence would have been silent.**
`bar_close_state` reads `bars[-1]["t"]` in UNIX SECONDS; the daily/weekly wire format
is `"YYYY-MM-DD"`. Without the conversion every daily chart answers `None` — a LEGAL
answer, so nothing complains and the columns stay blank while the producer looks like
it is working and merely cautious. The adapter lives in the ROUTER because the router
is the layer that departed from the clock's contract.

⛔ **THE L1 GATE STILL STANDS, DELIBERATELY.** The producer now exists, which is the
gate's stated precondition — but `pineRuntimeFrontend.js` is still reachable from no
route, and `pineRuntimeFrontendGate.test.js` is still the thing that says so.
Retiring it without wiring would leave the module unreachable AND unguarded, which is
strictly worse. It is retired in the SAME commit that wires the module, and wiring a
new member-facing surface is a product decision, not a mechanical next step.
**Items 6–10 are no longer blocked BY THE PRODUCER** — they concern the engine's
vocabulary, not that route.

---

## ⚠️ Runbook item 1 (the bind-time fold) — STAGE BUILT 2026-09-10, DOOR STILL REFUSES

The runbook calls it *"the single change that clears the largest remaining refusal"* and says
`fold_bound`/`foldBound` are *"built, railed and cross-lane-pinned but not yet called by the
door"*. All of that is true. What it does not say is that **there is no door to call it from.**

Measured, with a positive control on each search:

| fact | evidence |
|---|---|
| `foldBound` (`bind.js:333`) and `fold_bound` (`ast_bind.py:360`) exist | ✅ |
| neither has a single NON-TEST call site | ✅ searched both lanes |
| ⛔ **`bind.js` has ZERO live importers** — the whole module, not just the function | ✅ only tests import it |
| the door refuses at `pine.js:6980` — `resolved.type !== 'num'` → `pine:window` | ✅ |
| ⛔ **`translatePine`'s opts carry NO binding constants** | ✅ read the opts surface |

⭐⭐ **AND THAT LAST ROW IS THE WHOLE PROBLEM, NOT AN OVERSIGHT.** `translatePine` runs at
SAVE time. There is no symbol and no timeframe yet, so it *cannot* fold
`timeframe.isweekly ? 5 : 20` — and `foldBound`'s own header says why that matters: it returns
a new tree and mutates nothing, because **the NEXT symbol folds it differently**, and a pass
that rewrote in place would let the second symbol of a sweep inherit the first's lengths —
"a defect that shows as a WRONG NUMBER, not an error."

⛔ So the refusal at save time is arguably CORRECT, and "call `foldBound` from the door" would
be the exact bug the function was written to avoid. The real question is a design one:

1. **Where does the fold run?** It is per-binding, so it belongs in a bind stage between save
   and compute — a stage `bind.js` was clearly written for and that nothing currently calls.
2. **What does the door emit instead of refusing?** Today a non-literal length is a hard
   `pine:window`. To defer it, the door needs a node the bind stage can later fold, and a
   guarantee that an UNFOLDABLE one still refuses — with the member's own expression named.
3. **What stops a folded tree being saved?** The saved definition must go on meaning what it
   said. Whatever is persisted must be the UNFOLDED tree.

⚠️ `pine:window-dependent` is NOT this mechanism — it refuses values that depend on how much
history was loaded, which is a different question.

⭐ **THE VENDOR HALF IS NOW SETTLED**, which is what changed on 2026-09-10: job B measured that
the vendor really does fold a timeframe-conditional length to a plain integer at bind time
(`fold == sma20` on 400/400 daily bars, `fold == sma5` on 400/400 weekly). So the behaviour is
confirmed and only the placement is open. ⛔ It was NOT attempted here: it is the owner's #1
item, its failure mode is a wrong number rather than an error, and guessing the placement at
the end of a long session is how that ships.

### ✅ The bind stage — BUILT AND WIRED (`a6faf65b7`)

`bind.js` no longer has zero importers. The stage runs inside
`nativeRegistry.astColumnsFor`, keyed on the binding's `(symbol, timeframe)`:

    bindingConstants({ timeframe: timeframeFlags(ctx.tf), inputs, symbol: ctx.sym })
      -> foldBound(tree, consts)   // a NEW tree; the saved one stays symbolic
      -> interpret(bound, …)

⭐ **PROVEN END TO END, not just in the unit:** `computeFor` on ONE definition with
`tf:'D'` and `tf:'W'` produces DIFFERENT columns. Every other assertion in that file
would hold if `foldBound` were perfect and nothing called it — which was the actual
state of this repo. Folded integers are **20 daily / 5 weekly**, which is job B's
measured vendor reading rather than a guess about it.

⭐ `timeframeFlags(tf)` was extracted so ONE derivation decides what `isweekly`
means; `computeClock` now calls it instead of holding its own copy. `null` on an
unknown code, never a default.

⛔ **NEITHER R-a NOR R-c's STOP FIRED.** bind.js still had zero live importers when
the placement was confirmed, and `astColumnsFor` writes nothing back onto `def`, so
no folded tree can reach the save path and no guard had to be invented.

⛔⛔ **BUT LINE 233 IS STILL REFUSED, AND THE RULING PREDICTED IT WOULD NOT BE.**
Measured after wiring, on the real fixture:

    translatePine(uncharted-volume.pine) → pine:window @ line 233
    "a Pine length has to reach the engine as a plain whole number
     — argument 2 of `ta.sma`"

The DOOR refuses at SAVE time, so such a definition never reaches a bind at all.
That is design question **(b)** from the scoping above — *what does the door emit
instead of refusing, so a bind stage can fold it later* — and the ruling settled
where the fold RUNS, not whether the door should ADMIT a bind-time-foldable length.

⚠️ **THE REMAINING DECISION IS ABOUT WHAT GETS SAVED, NOT ABOUT THE FOLD.** Relaxing
the door means a definition whose length is not yet a number becomes persistable,
and the guarantee that has to come with it is that an unfoldable one still refuses
BY NAME at bind time. The stage already does that half (measured: an unknown
timeframe refuses naming the window). What is missing is the door's admission rule,
and R-a explicitly put the fold *not* at the door — so this is a separate ruling.

