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

Measured on `24341123`: `--check` **exit 0** (8 (fixture, k) pairs, 691,195 fires) ·
`--repaint` **exit 0** · `pytest tests/test_alert_replay.py` **53 passed, 1 skipped** ·
`phase_c_gauntlet.py` **7/7 KILLED, exit 0**.

⛔ **`PYTHONDONTWRITEBYTECODE=1` IS NOT OPTIONAL.** A same-size mutation applied within
one second of the last run imports the previous `.pyc` and the mutation silently never
executes — measured on this branch.

⛔ **`--freeze-bars` and `--record` are ONE-SHOT.** Both refuse to overwrite without
`--force`. Re-running `--record` after a change re-records whatever the code now does and
converts a real regression into a green build — the same trap
`tests/fixtures/indicators/_generate.py` and `tests/fixtures/_gen_alert_baseline.py` are
written under.

---

## How the log stores 691,195 fires in ~600 KB and is still an equality

The first recording was **42 MB** of raw rows. Each `(fixture, k, alert)` now records its
**count** and a **sha256 over the exact ordered `(bar_index, sample, repr(value))`
sequence**; `value` is inside the hashed text, so a changed **number** changes the digest
— the property the raw rows existed for is preserved, not weakened. Readability of a diff
is bought back two ways: the digest is **per-alert**, so a failure names which alert
moved, and **`wick_that_unwinds` keeps its rows verbatim** and is replayed row-for-row by
pytest on every run.

⚠️ **691,195 is not a grid that is too wide — it is a finding.** This evaluator has
**no fire-once**: `indicator_alert_service.record_trigger` bumps `trigger_count` and
leaves `active=1`, so `list_active` hands the alert straight back on the next cycle. An
`above 70` RSI alert re-delivers bell + email + Discord **every 60 seconds** for as long
as RSI stays above 70. The log records that faithfully rather than deduping it away.

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
