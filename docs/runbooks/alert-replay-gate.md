# The alert replay gate — what replaces the pixel gate in Phase C

Phases B1–B5 were measured with pixels: render the chart twice, diff the PNGs, report
0. Phase C ships a **notification**. No screenshot catches a wrong alert and **an email
cannot be un-sent**, so the pixel gate has no analogue here and three measurements take
its place. Two of them live in `tools/alert_replay.py`.

| # | measurement | artifact | command |
|---|---|---|---|
| 1 | **the fire log as an EQUALITY** | `tests/fixtures/alerts/fire_log_forming.json` | `python tools/alert_replay.py --check` |
| 2 | **the repaint oracle** | this document's number, below | `python tools/alert_replay.py --repaint --k 1 2 4 8` |
| 2b | **the DECLARED lane diff** (Task 6) | `tests/fixtures/alerts/fire_diff_declared.json` | `python tools/alert_replay.py --diff --mode-a forming --mode-b closed` |
| 3 | the ledger admission census | Task 9 | — |

🔴 **(2) AND (2b) ARE DIFFERENT QUESTIONS AND ONE DOES NOT IMPLY THE OTHER.** The
repaint oracle asks *"does this lane agree with ITSELF across granularities"* — Task
5 drove it to 0/0. The diff asks *"does the NEW lane agree with the OLD one, and
where it does not, is every difference DECLARED"*. Task 5 measured that the oracle
is **necessary and not sufficient**: its M1 (the defect restored) and M4 (a
uniformly shifted column) both repaint ZERO and are both wrong. Never read "0
repaints" as "the lane is correct".

---

## 🔴 THE HEADLINE "BEFORE" NUMBER

> **Measured on `24341123` (= `bb089bf2` + this task's fire log), over all four
> frozen fixtures — 1,845 bars, 1,244 alerts, k ∈ {1, 2, 4, 8}:**
>
> | resolution | disagreement vs k=1 |
> |---|---|
> | **keyed** (`alert_key`, `bar_index`, `bar_time`, `value`, `triggered`) | **636,205** |
> | **identity** (`alert_key`, `bar_index` only) | **17,295** |
>
> Fires per k, summed over the four fixtures:
> `{1: 139,870 · 2: 276,500 · 4: 551,325 · 8: 1,089,548}`.
>
> | fixture | bars | fires k=1 | keyed diff | identity diff |
> |---|---|---|---|---|
> | `intraday5m` | 579 | 44,543 | 208,107 @k8 | 5,218 @k8 |
> | `spy_daily` | 400 | 30,578 | 143,438 @k8 | 3,514 @k8 |
> | `nvda_5m_extended` | 800 | 61,963 | 262,258 @k8 | 6,911 @k8 |
> | `wick_that_unwinds` | 66 | 2,786 | 12,185 @k8 | 1,652 @k8 |
>
> **Task 5 has to drive both totals to exactly 0.**
>
> Reproduce: `PYTHONDONTWRITEBYTECODE=1 python tools/alert_replay.py --repaint --k 1 2 4 8`
> (~13 min, exit 0).

`keyed` counts a fire whose NUMBER moved. `identity` counts a fire that **exists at one
granularity and not at another** — the number that cannot be waved away as numeric
jitter. Both are reported and both are refused if zero, because a disagreement made
only of moved decimals would not be a repaint.

**Why it is non-zero, and why a zero would be the bug.** Today's evaluator scores the
**forming** bar and takes `prev` from `last_value` — the value persisted by the previous
60-second poll, **not** the previous bar. So "RSI crossed above 70" fires on a wick that
unwinds before the bar closes, and the fire set depends on **when you looked**.
`--repaint` refuses to report a zero: `cmd_repaint` raises `SystemExit` with
`ABORTING AS VACUOUS`. A repaint oracle that reads "no repaints" against the evaluator
this phase exists to fix is a gate that cannot fail.

**The control that makes the number mean something.**
`tests/test_alert_replay.py::test_a_closed_bar_evaluator_reads_zero_on_the_same_oracle`
drives a hypothetical closed-bar evaluator through the *same* oracle, the *same* bars and
the *same* grid. Measured on `wick_that_unwinds`:

| evaluator | fires per k `{1, 2, 4, 8}` | keyed | identity |
|---|---|---|---|
| **today (forming)** | `2786 · 5570 · 11135 · 21385` | **13,049** | **1,652** |
| **closed-bar control** | `2716 · 5432 · 10864 · 21728` | **0** | **0** |

Without that control, `> 0` could be a property of the harness rather than of the
evaluator, and Task 5's target ("drive it to 0") would be unreachable by construction.
The zero is also **not** "it never fired" — the control fires 2,716 times at k=1.

⚠️ Read the control's row carefully: its **delivery count still doubles with k**
(2716 → 5432 → 10864 → 21728) while its **disagreement stays 0**. That is exactly right,
and it is the cleanest statement of what these two numbers separate. The fire *set* — what
fired, on which bar, at what value — does not depend on when you looked; the number of
times it is *delivered* does, and that is the no-fire-once finding below, which is a
delivery-side defect and orthogonal to repainting.

---

## The frozen bars — `tests/fixtures/alerts/replay_bars.json`

| fixture | bars | what it is for |
|---|---|---|
| `intraday5m` | 579 | **a REFERENCE, not a copy.** `barsFrom: app/src/pages/parityBars/intraday5m.json` + a sha256 that `load_fixture()` re-checks. The same series `tools/chart_parity.py` renders through `?fixedbars=` and the same series `tests/fixtures/indicators/intraday5m_sessions.json` pins in **both** lanes at rel-tol 1e-9. Carries the weekend gap, the **EDT→EST transition**, and 20:00 ET == 00:00 UTC. |
| `spy_daily` | 400 | real daily SPY from `bars_sqlite`. Real gaps, real holidays. `t` is a `YYYYMMDD` int — exactly what the live evaluator is handed. |
| `nvda_5m_extended` | 800 | real extended-hours 5-minute tape, 04:00–19:55 ET, real overnight gaps, real zero-volume pre-market prints. |
| `wick_that_unwinds` | 66 | hand-built. RSI(14) parks at 67.0, one bar's HIGH takes it to 77.4 intra-bar, its CLOSE leaves it at 68.84, then flat. |

### …and the seven added for the cutover — `tools/alert_corpus_extend.py`

🔴 **WHY.** Production's shadow lane held 8,130 rows and **every one was recorded
between 16:52 and 21:30 ET**. The closed-bar lane exists to judge the last
*confirmed* bar instead of the forming one, and after hours nothing is forming —
so that data says almost nothing about the behaviour the cutover changes. Four
fixtures were the whole offline corpus. These seven are **real bars out of the
local store**, each carrying a condition a regular session can actually present,
and each carrying an executable `checks` function (re-run against the frozen bars
by `test_every_extended_fixture_still_supports_its_own_claim`) so the claim can go
red instead of rotting.

| fixture | tf | bars | the condition it covers |
|---|---|---|---|
| `gap_open_5m` | 5 | 230 | **a gap open.** SNOW 2026-05-27→28: the regular session closes 175.26 and reopens at **237.00, +35.2%**, with 160 bars of warmup before it. Where a level alert most plausibly fires differently between the lanes. |
| `high_vol_5m` | 5 | 200 | **a high-volatility session with many threshold crossings.** ZS 2026-06-25→26: 6.85% range, close crosses its own median **47 times**, no bar spanning >1.23% of its close (so it is tape, not a print artifact). |
| `thin_illiquid_5m` | 5 | 220 | **a thin ticker with missing and repeated bars.** ADXN over SEVEN WEEKS: 171 of 219 steps are off the 5-minute grid (up to 12 h), **108 zero-volume bars**, 34 byte-identical consecutive OHLC pairs, 85 distinct closes in 220 bars. |
| `warmup_first_bars_5m` | 5 | 84 | **a series that starts mid-fixture.** The FIRST 84 bars UBER has in the store. 27 of 31 addresses produce their first value after index 0 (latest at 51 of 84); `ichimoku.chikou` is None for the last 51. |
| `halfday_30m` | 30 | 213 | **a real half day, a holiday hole, EST, and tf=30.** SPY 2025-11-21→12-02: Thanksgiving 11-27 is a whole-session hole; 11-28 closes 13:00 ET so its last regular bucket is the **closing auction alone** (2,357,259 shares in eight cents) followed by a 3-hour hole. |
| `hourly_open_60m` | 60 | 208 | **session boundaries on tf=60.** SPY, 17 sessions. Carries the irregular open grid (below), the last bar before 16:00, the first after 04:00, and 16 overnight gaps. |
| `gap_daily` | D | 210 | **daily bars whose boundary is ET midnight.** SMCI 2025-10-03→2026-08-05: **−26.9%** (2026-03-20) and **+13.3%** (2026-07-22) overnight gaps, `t` a YYYYMMDD calendar key. |

Before the extension **every** fixture was tf `5` or `D`; `bar_close_epoch`'s
30- and 60-minute branches had no real tape behind them at all.

⛔ **THE FIRE LOG GROWS BY `--record --append --only <name>`, NEVER BY `--force`.**
That mode replays only what it is named, refuses a fixture it has already
recorded, and compares every pre-existing fixture object before and after —
refusing to write if one moved. **A new fixture may ADD entries; it may not move
one existing digest.** If an existing digest moves, that is a finding about the
closed lane, not a number to regenerate.

⛔ **AND `--check` NOW REFUSES A CORPUS AND A FIRE LOG THAT DISAGREE**, in both
directions, before replaying anything. A series frozen into `replay_bars.json` and
never recorded used to be not checked, not missed and not reported — it sat in the
tree looking like coverage. `--only` cannot suppress it: the rail is a property of
the two artifacts, not of the subset a run selected.

⛔ **`--diff` IS SCOPED TO `fire_diff_declared.json`'s OWN `measured.fixtures`, AND
IT NAMES THE REST EVERY RUN.** Each declared `count` is a bound observed over the
four series the declaration names; driving eleven through the same bounds
over-budgets rows for a reason that has nothing to do with the lane. Measure a new
fixture with `--diff --only <name>` and read the result as a **census**.

⚠️ **`nvda_5m_extended` does NOT carry spec §9.1's two session traps, and the fixture
says so.** The bars store retains NVDA 5m only from **2026-04-16** (entirely EDT) and its
last print of the day is **19:55 ET**, five minutes short of the 20:00 ET == 00:00 UTC
boundary — so no DST transition and no UTC-midnight crossing are reachable from real
tape today. `intraday5m` carries both. That is why the reference fixture is in the
document at all, and
`test_nvda_records_the_session_coverage_it_does_and_does_not_have` asserts the note stays
true.

**DO NOT REGENERATE.** Every row of `fire_log_forming.json` is measured against these
exact bars.

---

## The intra-bar path model, and its stated limits

A repaint is **by definition** a dependence of the fire set on the intra-bar path. There
is no tick data, so `intrabar_path(bar, k)` synthesizes one: an UP bar walks
`o → l → h → c`, a DOWN bar walks `o → h → l → c`, sampled at `k` evenly spaced points,
with the last partial byte-identical to the closed bar (so **`k=1` is the closed-bar
answer for any evaluator**).

It is a **model**, and it **under-counts**, which is the safe direction — a repaint this
model does not see is one the real tape can still produce, so a future `closed`-lane zero
is a claim about a **superset** of the paths this harness drives, never a subset. The
four limits, in the code above `intrabar_path` and asserted by
`test_the_path_model_states_its_limits`:

1. it cannot reproduce a path that touches an extreme **twice**;
2. the running **close** only lands exactly on `h`/`l` when `k` is a multiple of 3 (the
   walk has three legs), so a threshold in the last sliver below an extreme is missed;
3. **volume accrues linearly** — real volume clusters at the open and close, so
   MFI/OBV/VWAP partials are smoother here than on tape (direction of that error is not
   provable, and it is written down rather than glossed);
4. `k` is a **granularity, not a schedule**. Production polls on a 60-second timer, so on
   a 5-minute bar k≈5 and on a daily bar k≈390. Reported k values are a **lower bound**
   on the sampling the live loop performs.

---

## Running the gates

```bash
# THE FIRE-LOG EQUALITY (~5 min; walks 1,845 bars at k ∈ {1,4})
PYTHONDONTWRITEBYTECODE=1 python tools/alert_replay.py --check ; echo "EXIT=$?"

# THE REPAINT ORACLE (~10 min; k ∈ {1,2,4,8}). Exits non-zero — loudly — on a zero.
PYTHONDONTWRITEBYTECODE=1 python tools/alert_replay.py --repaint --k 1 2 4 8 ; echo "EXIT=$?"

# THE DECLARED LANE DIFF (~15 min; both lanes at k=4, all 30 addresses). Exits
# non-zero on an UNDECLARED difference in EITHER direction, on a declaration that
# under-counts, and — loudly — on a one-sided or empty diff.
PYTHONDONTWRITEBYTECODE=1 python tools/alert_replay.py --diff --mode-a forming \
    --mode-b closed --out tools/alert_replay_out/diff.json ; echo "EXIT=$?"

# The diff's fast rails, incl. the whole shadow lane (seconds; wick fixture only)
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_shadow.py -q
# …and the same file measuring all four fixtures instead of one
ALERT_DIFF_FULL=1 PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_shadow.py -q

# The fast rails (seconds)
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_replay.py -q

# The whole fire log from pytest instead of the tool
ALERT_REPLAY_FULL=1 PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_replay.py -q

# The harness's own mutation gauntlet (proves the instrument can SEE a change)
PYTHONDONTWRITEBYTECODE=1 python tools/phase_c_gauntlet.py
```

Measured on `24341123`: `--check` **exit 0** (8 (fixture, k) pairs) · `--repaint`
**exit 0** · `pytest tests/test_alert_replay.py` **53 passed, 1 skipped** ·
`phase_c_gauntlet.py` **7/7 KILLED, exit 0**.

⛔ **THE FIRE COUNT IS DELIBERATELY NOT WRITTEN DOWN HERE ANY MORE, AND THAT IS A FIX,
NOT A GAP.** This page used to carry it in three places. It is asserted in exactly one:
`tests/fixtures/alerts/fire_log_forming.json`, by `--check`'s **exit code**. A copy of a
test's expectation in prose is a control that rots green — it goes on agreeing with a
number nobody re-measured — and this page proved it by rotting: the log was legitimately
re-frozen when the daily-VWAP unit fix landed (`2999e8f0`, the ONE sanctioned exception
to *"if the log moves that is a finding, never a number to regenerate"*), and all three
copies here went stale in the same minute while every gate stayed green. **Read the
number off `--check`; do not carry it.**

⛔ **`PYTHONDONTWRITEBYTECODE=1` IS NOT OPTIONAL.** A same-size mutation applied within
one second of the last run imports the previous `.pyc` and the mutation silently never
executes — measured on this branch.

⛔ **`--freeze-bars` and `--record` are ONE-SHOT.** Both refuse to overwrite without
`--force`. Re-running `--record` after a change re-records whatever the code now does and
converts a real regression into a green build — the same trap
`tests/fixtures/indicators/_generate.py` and `tests/fixtures/_gen_alert_baseline.py` are
written under.

---

## How the log stores every fire in ~600 KB and is still an equality

The first recording was **42 MB** of raw rows. Each `(fixture, k, alert)` now records its
**count** and a **sha256 over the exact ordered `(bar_index, sample, repr(value))`
sequence**; `value` is inside the hashed text, so a changed **number** changes the digest
— the property the raw rows existed for is preserved, not weakened. Readability of a diff
is bought back two ways: the digest is **per-alert**, so a failure names which alert
moved, and **`wick_that_unwinds` keeps its rows verbatim** and is replayed row-for-row by
pytest on every run.

⚠️ **THE SIX-FIGURE FIRE COUNT IS NOT A GRID THAT IS TOO WIDE — IT IS A FINDING.** The
evaluator this log was frozen from has **no fire-once**:
`indicator_alert_service.record_trigger` bumps `trigger_count` and leaves `active=1`, so
`list_active` hands the alert straight back on the next cycle. An `above 70` RSI alert
re-delivers bell + email + Discord **every 60 seconds** for as long as RSI stays above 70.
The log records that faithfully rather than deduping it away. (Phase C Task 11 shipped the
fire-once guard — `alert_fired_log.record_fire`, `UNIQUE(alert_id, fire_key)` — so the
count is a record of what the FORMING lane did, not of what a member's inbox gets today.)

---

## The alert grid

Generated from the **live catalog** (`INDICATOR_FUNCS` × `ALERT_CONDITIONS`), never
hand-copied — the enumeration ledger *and* the evaluator's own comment both claim 25
addresses and there are **28**, so a hand-written list would have been wrong before it
was committed. Thresholds are a **per-address ladder derived from the actual value range
of each series** (20th / 50th / 80th percentile). A fixed ladder like the 5,040-row
baseline's (`-100 … 150`) misses every price-scale address outright: VWAP on SPY is ~600
and a threshold of 70 is never crossed, so the log would pin nothing about half the
catalog.

Params stay at their defaults **on purpose**:
`tests/fixtures/indicator_alert_baseline.json` already replays 5,040 combinations *across
params* on one fixed series; this log's job is the orthogonal one — the same params walked
bar by bar down real tape.

---

## 6. What the pixel zero does NOT cover — per deliverable, the REAL gate

Phase C closed with a whole-phase run of the Phase-B pixel gate: **46 pre-existing cases,
5 runs each, `--expect 0`, two full builds** (A = `4374b0c0`, `origin/master` WITHOUT
Phase C, build `6d49eaf36d1c`; B = `b97c75b6`, the same master WITH Phase C, build
`ac24eaedab49`). The result is **0 changed pixels on every case on every run** — the
distinct set of measured values across all 230 comparisons is `{0}`, so there is no
variance to round away — and **zero provenance movement**: not one pool `key` changed, so
no series was created by a different module.

⛔⛔ **AND THAT NUMBER IS ALMOST ENTIRELY BLIND TO PHASE C, WHICH IS WHY IT IS WRITTEN
DOWN HERE INSTEAD OF QUOTED AS A RESULT.** The headless `/r/chart` route renders a chart
from a committed bar fixture. It **mounts no alert popover, arms nothing, presses no key,
opens no toolbar, and runs no evaluator.** A total regression of the entire alert lane —
every alert firing on every poll, or none of them firing at all — renders **0 changed
pixels**. B4's adjudication A4 (*"a total regression of B4 still reports 0 px — the parity
route mounts none of it"*) applies to C word for word.

So the zero is a **NON-REGRESSION statement about the chart**, and nothing else: it says
Phase C — which added two native definitions, one server definition, a per-chart instance
filter and a binder change — did not move a pixel of the fourteen indicators that were
already shipping. That is worth having. It is not a gate on anything below.

| deliverable | what it ships | the gate that can actually fail | does the pixel 0 cover it? |
|---|---|---|---|
| T2 replay harness · repaint oracle | `tools/alert_replay.py` | `--repaint` **exit code**, which aborts on a ZERO as vacuous | **no** |
| T3 operand grammar | `api/services/alert_conditions.py` | `--check` digest equality + 36 parametrised cases against a verbatim inlined copy of the deleted body | **no** |
| T4 events are columns | `EVENT_FUNCS`, the two `sar` columns | `tests/test_indicator_golden.py` · `eventColumns.test.js` (both lanes, 1e-9) | **no** |
| T5 closed-bar evaluator (dark) | `_evaluate_one_closed`, `closed_bar_index` | `tests/test_alert_closed_bar.py` + `--repaint --mode closed`, which refuses a lane that never fires | **no** |
| T6 shadow lane · declared diff | `alert_shadow_log.py`, `fire_diff_declared.json` | `--diff` **exit code**: undeclared in EITHER direction fails | **no** |
| T7 `compute.rev` force-migration | the `_run_one_cycle` guard, `ADDRESS_REVS` | `tests/test_alert_rev_migration.py`, driven through the REAL cycle | **no** |
| T9 the ledger door | `admit_alert_fire` | `tests/test_alert_ledger_admission.py` + the **AST** zero-call-site rail | **no** |
| T10 alerts name the instance · `INDICATOR_FUNCS` retires | derived value table, `PRICE_FUNCS`, `instance_id` | `tests/test_indicator_alert_evaluator.py` · `IndicatorAlertPopover.test.jsx` | **no** — the popover is not mounted by `/r/chart` |
| T11 fire-once · re-arm · fired log · soak matrix | `alert_fired_log.py`, `tools/alert_soak_matrix.py` | `tests/test_alert_fired_log.py` + `--verify` (exits 1 on deliverable / invisible / unarmed / **ZERO armed** / expiring-within-7-days; `--arm` exits 1 when its own verify refuses) | **no** |
| T12 per-chart alert sets · templates | `engine/alertSets.js` | `alertSets.test.js` + the `mergeChartSettings` corpus digest | **partly** — a merge change WOULD move pixels, so the 0 covers that half and only that half |
| T13 Signature on a generic server lane | `engine/serverCompute.js`, `/api/signature/columns` | `tests/test_signature_router.py`, whose route list is DERIVED from `sig.router.routes` | **no** — and see §6.3 |
| T14 AVWAP · ATR bands | `computeAVWAP`, `computeATRBands`, both lanes | `tests/test_indicator_golden.py` (1e-9, both lanes) **and** the two parity cases below | **yes**, and they are now measured |
| T14 / T13 RS line | `computeRSLine`, `rsLine` on the server lane | the golden fixture in both lanes | **NO — REFUSED, §6.3** |
| T15 the enumeration ledger | `enumerationSites.test.js` | that file's own exit code | **no** |

### 6.1 The case file's declared numbers are a B5 measurement, not a general gate

Every one of the 46 live cases carries an `expect` and a `regions` block, and **all of
them are the Flip-C delta** — a bands build against a panes build, written by B5 Task 12.
Run any other pair of builds against them and all 46 "fail" while measuring 0: the run
above recorded **510 region failures and not one pixel failure**. So a Phase-C-shaped
question (*"did this commit move the chart?"*) is asked with `--expect 0`, and the region
numbers are read as **measurements** rather than as gates. Rewriting them would destroy
the Flip-C record; the correct move is to say which comparison you are making.

### 6.2 The one geometry difference, and why it is the instrument

The pane manifest is diffed alongside the pixels, and a manifest that moves while no pixel
does is a failure **by design** — one of the two is lying. It fired on all 230 comparisons,
and the diff is **exactly and only** this, with no other key on any case:

```
axisLabelWidthPx: None -> {'right': 76, 'left': 0}
panes[N].axisLabelWidthPx: None -> {'right': 76, 'left': 0}
```

That field is Task 14's, added so the still-open OBV axis-width finding stops being an
unattributable pixel storm. It **did not exist on side A**, so the cross-check cannot be
satisfied across the commit that introduced it — a one-time cost, paid once, and zero from
the next commit onward. Every other GEOMETRY key — pane count, per-pane pixel height,
series type, `priceScaleId`, pane index and insertion ORDER — is byte-identical on all 46
cases, and PROVENANCE is empty on all 230. There is no escape hatch for this in the
harness and **none was added**: declaring it away would retire a check that catches a real
class of regression.

### 6.3 🔴 `rs_line_spy_only` — REFUSED, with the measurement that refuses it

Task 13 named two preconditions Task 14 could not have known: the RS line's columns are
**FETCHED**, and the route is **`Depends(require_paid)`**. The parity route goes
**hermetic** under `?fixedbars=` — every `/api/` call short-circuits — so the fetch can
never resolve.

**Measured, not assumed.** With `rsLine` enabled on side A and disabled on side B, the
harness did not report a number at all; it raised:

```
PaneLayoutAlertError: the chart reported 1 pane-height alert(s) that survived a re-apply:
{'paneLayout: the chart has 2 panes, expected at least 3': 1}
```

i.e. the instance IS created and a pane IS requested, and the renderer produces no pane
because there is no column to draw. **An `expect` filled in from a run in this state would
be a green number meaning the indicator is absent** — precisely what Task 14 wrote into
this case when it was blocked on a lane that did not exist yet. The case therefore stays
`status: placeholder`, and the requirement for whoever runs it is recorded in the case
itself: **assert a non-empty column was consumed BEFORE trusting any pixel number**, from
a PAID session, because a 402 and a quiet answer are indistinguishable at the pixel level.

⭐ The pane-alert gate refusing to report is the outcome to want here. It is the difference
between a harness that says *"I cannot measure this"* and one that says *"0"*.

---

## 🔴 The 60-minute grid is not uniform, and the replay cannot see it

`bars_fetch.bucket_60_et_unix_seconds` gives the regular-session open its **own**
bucket, so a 60-minute session runs `04:00…09:00`, **`09:30`**, `10:00…19:00` —
and **both the 09:00 and the 09:30 bar span THIRTY minutes, not sixty**. Verified
against the 5-minute tape on 2026-07-15: the 09:30 hourly bar reproduces the
09:30–10:00 five-minute aggregate exactly (`o 754.24 h 755.58 l 753.18 c 754.45
v 4,886,107`).

`indicator_alert_evaluator.bar_close_epoch` answers `t + 3600` for every intraday
60-minute bar, so it declares each of those two closed **half an hour after the
store stopped writing to them**. The consequence is a closed-lane **latency**, not
a wrong number: an alert on the 09:00 or 09:30 hourly bar cannot fire until 30
minutes after that bar became final — in the busiest half hour of the day, on top
of the 60-second poll.

⚠️ **AND `--repaint` / `--diff` STRUCTURALLY CANNOT SEE IT.**
`make_closed_evaluate` derives `now_epoch` from `bar_close_epoch` itself
(`close_at - 1`), so an error in that function **cancels out of every replay
number**. It is pinned instead as a direct equality against the NEXT bar's start
on real tape:
`tests/test_alert_replay.py::test_bar_close_epoch_overstates_the_two_60m_open_buckets`,
with `test_the_other_intraday_grids_are_uniform` as the control that localises it
to the hourly bucketer rather than to the store. That test goes **red, with the
paragraph in hand**, the day somebody teaches `bar_close_epoch` about the open
bucket. That is the intended outcome.

---

## Known-and-not-fixed, found while building this

* **No fire-once / no re-arm** (above). Pre-existing; a delivery-side decision, not a
  compute one. Reported, not fixed.
* **VWAP on a daily timeframe is anchored in 1970.** `_fetch_bars_for_alert` passes the
  store's `YYYYMMDD` int straight through as `t`, and `compute_vwap_raw` treats a numeric
  `t` as a unix second — `20241230` is 1970-08-23, and 400 consecutive trading days land
  one *second* apart, so the whole series accumulates into a single "session". A daily
  `vwap` alert is therefore a running cumulative VWAP over the entire window, not a
  session VWAP. Reported, not fixed — it is a change to the evaluation lane.
* **The create path still validates nothing**, so an address `INDICATOR_FUNCS` has never
  heard of is accepted and silently never fires. Already documented in the evaluator;
  restated because the replay makes it measurable.
