"""The closed-bar lane — and the repaint oracle reading ZERO on it.

This is the file Phase C exists for. Task 2 measured today's forming lane
disagreeing with itself across intra-bar granularities (636,205 keyed /
17,295 identity across four fixtures); this asserts the closed lane does not,
at all, for any k, on real historical bars — while still firing.

⚠️ THE FIRE COUNT IS PART OF EVERY ZERO. A lane that never fires reads 0/0 too,
and that is the vacuous pass this whole phase is written against. Every
disagreement assertion here is paired with a non-zero fire count.
"""

from __future__ import annotations

import ast
import copy
import datetime
import json
import pathlib
import re
import sys
import time
import zoneinfo

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import alert_replay as ar  # noqa: E402
from api.services import alert_series  # noqa: E402
from api.services import indicator_alert_evaluator as ev  # noqa: E402

_ET = zoneinfo.ZoneInfo("America/New_York")


@pytest.fixture(scope="module")
def wick():
    return ar.load_fixture("wick_that_unwinds")["bars"]


@pytest.fixture(scope="module")
def spy_daily():
    return ar.load_fixture("spy_daily")["bars"]


@pytest.fixture(scope="module")
def intraday5m():
    return ar.load_fixture("intraday5m")["bars"]


@pytest.fixture(scope="module")
def forming():
    return ar.make_forming_evaluate()


@pytest.fixture(scope="module")
def closed():
    return ar.make_closed_evaluate()


def _alert(address, condition="above", threshold=0.0, tf="5", params=None,
           last_value=None):
    return {"id": 1, "user_id": "u", "sym": "T", "tf": tf,
            "indicator": address, "condition": condition, "threshold": threshold,
            "params_json": None if params is None else json.dumps(params),
            "last_value": last_value, "alert_key": "k"}


def test_the_closed_bar_lane_produces_the_SAME_fire_set_at_EVERY_granularity(wick, forming, closed):
    """The headline number of Phase C.

    A fire repaints iff the fire set depends on when you looked. Task 2 measured
    the forming lane disagreeing across k; this asserts the closed lane does not.

    ⛔ SET EQUALITY, NOT A COUNT. A DIFFERENT set of the same SIZE is the exact
    shape a bar-index off-by-one produces.
    """
    alerts, _ = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    sets = {k: {ar.fire_key(f) for f in ar.replay(wick, copy.deepcopy(alerts), k=k,
                                                  evaluate=closed)}
            for k in (1, 2, 4, 8)}
    base = sets[1]
    for k, s in sets.items():
        assert s == base, (
            f"the fire set at k={k} differs from k=1 by "
            f"{len(s ^ base)} fires — the closed-bar lane is still reading the "
            f"forming bar somewhere"
        )
    assert base, "no fire at any granularity — the grid pins nothing"


def test_the_wick_that_unwinds_does_NOT_fire_closed_bar(wick, closed):
    """Task 2 asserted this bar DOES fire today. This is the inversion."""
    fires = ar.replay(wick, [ar.rsi_cross_above_70()], k=4, evaluate=closed)
    assert fires == [], (
        "the wick still fires. Its HIGH takes RSI above 70 and its CLOSE does "
        "not, so a closed-bar crossing cannot see it."
    )


def test_the_closed_lane_fires_A_LOT_on_that_same_fixture(wick, forming, closed):
    """⛔ THE NON-VACUITY HALF OF EVERY ZERO ABOVE.

    `fires == []` for the wick alert is the RIGHT answer and it is also what a
    lane that computes nothing at all returns. So: the same fixture, the whole
    catalog grid, and a fire count that is large — the zero disagreement is a
    property of WHICH bar is judged, not of a lane that never judges one.
    """
    alerts, _ = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    fires = ar.replay(wick, copy.deepcopy(alerts), k=4, evaluate=closed)
    assert len(fires) > 500, f"only {len(fires)} fires — the grid pins nothing"
    # …and it is not one runaway alert firing on every bar: many distinct alerts
    # and many distinct bars are involved.
    assert len({f["alert_key"] for f in fires}) > 20
    assert len({f["bar_index"] for f in fires}) > 20


def test_the_closed_lane_and_the_forming_lane_DISAGREE_on_this_fixture(wick, forming, closed):
    """⭐ THE CONTROL THAT MAKES "0 REPAINTS" MEAN SOMETHING.

    A closed lane that happened to be a copy of the forming lane would also read
    0/0 if the harness were broken. These two fire sets must be genuinely
    different on the fixture built to separate them, and the wick fire — bar 53,
    which fires at k=4 forming and cannot fire closed — must be on the difference.
    """
    alerts, _ = ar.build_alert_grid("wick_that_unwinds", wick, "5", forming)
    f_set = {ar.fire_key(f) for f in ar.replay(wick, copy.deepcopy(alerts), k=4,
                                               evaluate=forming)}
    c_set = {ar.fire_key(f) for f in ar.replay(wick, copy.deepcopy(alerts), k=4,
                                               evaluate=closed)}
    assert f_set != c_set, "the two lanes produced the identical fire set"
    only_forming = {k for k in f_set - c_set if k[1] == ar.WICK_INDEX}
    assert only_forming, (
        "no fire on the wick bar is exclusive to the forming lane — the fixture "
        "that the whole phase is named after is not separating the two lanes")


# ─── THE MODE: LANDED DARK, AND THE BRANCH IS GENUINELY PRESENT ──────────────

def test_the_shipped_mode_is_forming():
    """⛔ THE CUTOVER IS TASK 8's, AND ONLY TASK 8's.

    One constant, its own commit, after three live sessions of shadow soak. Any
    earlier task flipping it has to be caught here — but a constant equality is a
    weak rail on its own, so the behavioural half is the next test.
    """
    src = pathlib.Path(ev.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    assigned = [n for n in tree.body
                if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == "ALERT_EVAL_MODE" for t in n.targets)]
    assert len(assigned) == 1, "ALERT_EVAL_MODE is assigned more than once"
    assert assigned[0].value.value == "forming"
    assert ev.ALERT_EVAL_MODE == "forming"
    assert ev.eval_mode() == "forming"
    # The control: the raw source DOES still name "closed" (in prose and in the
    # branch), so this is measuring the VALUE and not the absence of the word.
    assert '"closed"' in src


def test_an_unqualified_evaluate_one_runs_the_FORMING_lane(wick):
    """🔴 THE MUTATION RAIL FOR THE MODE ITSELF — behavioural, not textual.

    Every other closed-lane test in this file passes `mode="closed"` explicitly,
    and an explicit-mode test rides straight past a mutated `eval_mode()`. So
    this one passes NO mode at all, on the one input in the repo built to make
    the two lanes disagree: the wick bar's forming partial fires `cross_above 70`
    and its closed predecessor cannot.

    Kill list: `eval_mode()` returning "closed"; `ALERT_EVAL_MODE = "closed"`;
    inverting the `resolved_mode == "closed"` comparison; defaulting `mode` to
    "closed".

    ⚠️ THE DISCRIMINATOR IS `prev`'s SOURCE, NOT THE BAR INDEX, AND THE FIRST
    DRAFT OF THIS TEST GOT THAT WRONG. An unqualified call passes no `now_epoch`
    either, so the closed lane asks `time.time()` — and on a frozen 2025 fixture
    EVERY bar is long closed, including the "forming" partial, so both lanes end
    up judging the same bar and a bar-index discriminator agrees with both. What
    can never agree is WHERE `prev` COMES FROM: the row's `last_value` (forming)
    versus `series[i-1]` (closed). Below, `last_value=75.0` says "the last poll
    saw RSI already above 70", so the forming lane refuses the cross while the
    closed lane, reading the actual previous bar at ~67, takes it.
    """
    bar = wick[ar.WICK_INDEX]
    partial = ar.intrabar_path(bar, 4)[1]          # the sample that clears 70
    lo = max(0, ar.WICK_INDEX + 1 - ar.PROD_BAR_WINDOW)
    seen = wick[lo:ar.WICK_INDEX] + [partial]

    # The prior poll already saw RSI above the threshold — so there is nothing
    # left to cross, as far as the forming lane is concerned.
    alert = _alert("rsi", "cross_above", 70.0, tf="5", last_value=75.0)

    value, triggered = ev._evaluate_one(dict(alert), bars=seen)
    assert value > 70.0
    assert triggered is False, (
        "the default lane fired despite `last_value` already being above the "
        "threshold — it is not reading `prev` from the alert row, i.e. "
        "`eval_mode()` is not returning 'forming'")

    closed_answer = ev._evaluate_one(dict(alert), bars=seen, mode="closed")
    assert closed_answer[1] is True, (
        "the closed lane did not fire — then this test separates nothing and the "
        "mode mutation would survive it")
    assert (value, triggered) != closed_answer

    # …and the OTHER direction of the same seam: with a `last_value` below the
    # threshold the forming lane fires on a partial whose CLOSE never crosses,
    # which is the defect this phase is named after.
    wick_alert = _alert("rsi", "cross_above", 70.0, tf="5", last_value=67.0)
    assert ev._evaluate_one(dict(wick_alert), bars=seen)[1] is True
    now = ev.bar_close_epoch(seen[-1]["t"], "5") - 1
    assert ev._evaluate_one_closed(dict(wick_alert), seen, now_epoch=now)[1] is False


def test_a_wall_clock_poll_treats_a_stale_series_as_fully_closed(wick):
    """⚠️ THE DEFAULT `now_epoch` IS `time.time()`, AND THAT IS CORRECT.

    A window whose newest bar is months old has no forming bar in it — the
    ticker stopped printing, or the store fell behind — and the honest answer is
    that its newest bar IS closed. Reason 3 of `closed_bar_index`, arrived at
    from production's side rather than a fixture's. It is written down because
    the first draft of the test above assumed the opposite and passed for the
    wrong reason.
    """
    seen = wick[-ar.PROD_BAR_WINDOW:]
    assert ev.closed_bar_index(seen, "5", ev.time.time()) == len(seen) - 1
    # …and one second before the last bar's close, it is the bar before.
    now = ev.bar_close_epoch(seen[-1]["t"], "5") - 1
    assert ev.closed_bar_index(seen, "5", now) == len(seen) - 2


def test_eval_mode_is_the_ONLY_reader_of_the_constant():
    """⛔ THE ONE-READER RULE, read off every .py file in the repo's own trees.

    A consumer comparing `ALERT_EVAL_MODE` directly is a reader the seam cannot
    reach, which is a branch no test can drive — B5 Task 10 shipped this rule for
    `PANE_MODE` and it is why `flipCGeometry` could exercise a path production
    never took. The one legal read is inside `eval_mode`'s own body.
    """
    ev_path = pathlib.Path(ev.__file__)
    src = ev_path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    reader = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == "eval_mode")
    legal = {id(n) for n in ast.walk(reader)}

    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == "ALERT_EVAL_MODE":
            if id(node) in legal:
                continue
            if isinstance(getattr(node, "ctx", None), ast.Store):
                continue          # the declaration itself
            offenders.append(f"{ev_path}:{node.lineno}")

    roots = [ev_path.parent.parent,                                   # api/
             pathlib.Path(__file__).parent.parent / "tools"]          # tools/
    for root in roots:
        for path in sorted(root.rglob("*.py")):
            if path == ev_path:
                continue
            text = path.read_text(encoding="utf-8")
            if "ALERT_EVAL_MODE" not in text:
                continue
            for node in ast.walk(ast.parse(text)):
                if (isinstance(node, ast.Attribute) and node.attr == "ALERT_EVAL_MODE") or \
                        (isinstance(node, ast.Name) and node.id == "ALERT_EVAL_MODE"):
                    offenders.append(f"{path}:{node.lineno}")
    assert not offenders, (
        "a second reader compares ALERT_EVAL_MODE directly instead of calling "
        "eval_mode():\n" + "\n".join(offenders))
    # The control: `eval_mode` really does read it, so this is not passing on a
    # tree where the constant is unreferenced by anything at all.
    assert any(isinstance(n, ast.Name) and n.id == "ALERT_EVAL_MODE"
               for n in ast.walk(reader))


def test_the_closed_lane_is_reachable_by_import_and_call(wick):
    """⚠️ "LANDED DARK" MUST MEAN "THE BRANCH IS NOT TAKEN", NOT "THE BRANCH IS
    NOT PRESENT".

    B5 Task 10 measured exactly that failure on the JS side: the minifier folded
    `paneMode()` so hard the branch was ABSENT from the shipped bundle, and the
    dark landing had shipped nothing. Python is not minified, so the branch is
    genuinely here — and the evidence the JS lane could not produce is this:
    import the shipped module and call the closed lane directly.
    """
    seen = wick[-ar.PROD_BAR_WINDOW:]
    value, triggered, index = ev._evaluate_one_closed(
        _alert("rsi", "above", 10.0, tf="5"), seen,
        now_epoch=ev.bar_close_epoch(seen[-1]["t"], "5") - 1)
    assert value is not None and index == len(seen) - 2
    assert triggered is True


def test_the_closed_lane_never_reads_last_value(wick):
    """⭐ `last_value` IS DEMOTED TO DELIVERY-DEDUP — spec §8.

    The forming lane's whole defect is that `prev` is the previous POLL's number.
    Feeding the closed lane wildly different `last_value`s must change nothing,
    and a `cross_above` is the condition that reads `prev` hardest.
    """
    seen = wick[-ar.PROD_BAR_WINDOW:]
    now = ev.bar_close_epoch(seen[-1]["t"], "5") - 1
    prevs = (None, -1e9, 0.0, 59.9, 60.0, 60.1, 1e9)
    answers = {
        ev._evaluate_one_closed(
            _alert("rsi", "cross_above", 60.0, tf="5", last_value=p), seen,
            now_epoch=now)
        for p in prevs
    }
    assert len(answers) == 1, f"the closed lane read last_value: {answers}"
    # …and the forming lane on the same input genuinely DOES depend on it, so the
    # invariance above is a property of the new lane, not of the input.
    forming_answers = {
        ev._evaluate_one(_alert("rsi", "cross_above", 60.0, tf="5", last_value=p),
                         bars=seen, mode="forming")
        for p in prevs
    }
    assert len(forming_answers) > 1


# ─── closed_bar_index: THE BOUNDARY, AND WHY IT IS NOT len(bars) - 2 ─────────

def _unix(y, m, d, hh=0, mm=0):
    return datetime.datetime(y, m, d, hh, mm, tzinfo=_ET).timestamp()


def test_an_intraday_bar_closes_exactly_one_timeframe_after_its_start():
    bars = [{"t": _unix(2026, 8, 5, 9, 30) + i * 300} for i in range(4)]
    last_start = bars[-1]["t"]
    assert ev.closed_bar_index(bars, "5", last_start + 299) == 2
    assert ev.closed_bar_index(bars, "5", last_start + 300) == 3
    # …and a fraction of a second is the whole difference.
    assert ev.closed_bar_index(bars, "5", last_start + 299.999) == 2


def test_a_daily_bar_is_a_YYYYMMDD_key_and_is_NOT_read_as_unix_seconds():
    """⛔ REASON 2, MEASURED. 20260805 read as unix seconds is 1970-08-23 — the
    live `compute_vwap` anchor defect Task 2 pinned. If this lane made the same
    mistake, every daily bar would look closed since 1970 and the newest FORMING
    bar would be judged, which is this phase's defect wearing a disguise.
    """
    bars = [{"t": 20260803}, {"t": 20260804}, {"t": 20260805}]
    # 1970 + a bit: nothing has closed.
    assert ev.closed_bar_index(bars, "D", 20260805.0) == -1
    # Mid-session on the 5th: the 4th has closed, the 5th has not.
    assert ev.closed_bar_index(bars, "D", _unix(2026, 8, 5, 12, 0)) == 1
    # 18:30 ET — regular session over, extended hours still printing into the row.
    assert ev.closed_bar_index(bars, "D", _unix(2026, 8, 5, 18, 30)) == 1
    # Past ET midnight: the 5th can no longer change.
    assert ev.closed_bar_index(bars, "D", _unix(2026, 8, 6, 0, 0)) == 2


def test_outside_RTH_the_newest_bar_is_already_closed_and_is_NOT_dropped():
    """⛔ REASON 1. A blanket `len(bars) - 2` drops a whole real bar and every
    alert fires one bar late, forever, in exactly the hours a swing trader looks.
    """
    bars = [{"t": 20260803}, {"t": 20260804}, {"t": 20260805}]
    blanket = len(bars) - 2
    saturday = _unix(2026, 8, 8, 10, 0)
    assert ev.closed_bar_index(bars, "D", saturday) == 2 != blanket


def test_a_gap_means_the_newest_bar_can_be_days_old_and_unambiguously_closed():
    """⛔ REASON 3 — a holiday, a halt, or a thin ticker."""
    bars = [{"t": 20260626}, {"t": 20260630}, {"t": 20260702}]   # July-4th week
    assert ev.closed_bar_index(bars, "D", _unix(2026, 7, 6, 11, 0)) == 2
    # …and the same series mid-session on the day of its newest bar does not.
    assert ev.closed_bar_index(bars, "D", _unix(2026, 7, 2, 11, 0)) == 1


def test_the_daily_boundary_survives_a_DST_transition():
    """⛔ NEVER MODULE-LOAD CONSTANT OFFSET ARITHMETIC. A captured offset is an
    hour wrong for half the year depending on when the process started
    (`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md` §7). US DST ended
    2026-11-01, so an EDT bar's ET midnight and an EST bar's are 4h and 5h from
    UTC respectively — and both have to be right.
    """
    edt = ev.bar_close_epoch(20261030, "D")
    est = ev.bar_close_epoch(20261103, "D")
    assert edt == _unix(2026, 10, 31)
    assert est == _unix(2026, 11, 4)
    assert datetime.datetime.fromtimestamp(edt, datetime.timezone.utc).hour == 4
    assert datetime.datetime.fromtimestamp(est, datetime.timezone.utc).hour == 5
    # The transition day itself is 25 hours long, so a fixed +86400 is wrong here.
    assert ev.bar_close_epoch(20261101, "D") - _unix(2026, 11, 1) == 25 * 3600


def test_a_monthly_bar_closes_on_the_CALENDAR_month_not_thirty_days():
    """`+30 days` is wrong for eleven months of twelve, and for February by two."""
    assert ev.bar_close_epoch(20260201, "M") == _unix(2026, 3, 1)
    assert ev.bar_close_epoch(20261201, "M") == _unix(2027, 1, 1)
    assert ev.bar_close_epoch(20260701, "M") == _unix(2026, 8, 1)
    assert ev.bar_close_epoch(20260401, "W") == _unix(2026, 4, 8)


def test_an_unresolvable_encoding_is_never_assumed_closed():
    """The safe direction is refusing to judge, because the alternative is firing
    on a bar that is still moving."""
    assert ev.bar_close_epoch(20260805, "H") is None            # unknown tf
    assert ev.bar_close_epoch("not-a-date", "D") is None
    assert ev.bar_close_epoch(None, "5") is None
    assert ev.closed_bar_index([{"t": 20260805}], "", 2e9) == -1
    assert ev.closed_bar_index([], "D", 2e9) == -1
    # …and an ISO daily key still resolves, because the store has produced both.
    assert ev.bar_close_epoch("2026-08-05", "D") == _unix(2026, 8, 6)


def test_the_closed_lane_refuses_when_there_is_no_previous_bar(wick):
    """`i < 1` is the `prev` requirement, not an off-by-one."""
    one = wick[:1]
    assert ev._evaluate_one_closed(_alert("rsi", tf="5"), one,
                                   now_epoch=one[0]["t"] + 10_000) == (None, False, None)
    two = wick[:2]
    assert ev.closed_bar_index(two, "5", two[1]["t"] + 10_000) == 1
    assert ev._evaluate_one_closed(_alert("rsi", tf="5"), two,
                                   now_epoch=two[0]["t"] + 100)[2] is None


# ─── THE SERIES TABLE, AND THE TWIN IT IS OF ────────────────────────────────

_SERIES_PARAM_SETS = [
    {},
    {"period": 5},
    {"period": 30, "stddev": 1.5, "type": "ema"},
    {"fast": 5, "slow": 13, "signal": 4, "k_period": 5, "d_period": 2},
    {"tenkan_period": 5, "kijun_period": 10, "senkou_b_period": 20,
     "step": 0.03, "max_step": 0.3},
]


@pytest.mark.parametrize("params", _SERIES_PARAM_SETS)
def test_every_address_series_ends_where_the_value_function_says_it_does(
        params, wick, spy_daily):
    """⛔ THE ANTI-FORK RAIL. `SERIES_FUNCS` is a TWIN of `INDICATOR_FUNCS`.

    Every value function is `_last_non_none(<column>)`, so the column this module
    returns must satisfy `_last_non_none(series) == value_function(address)(...)`
    EXACTLY. That catches a wrong column index, a wrong `on_closes`, a wrong
    compute name and a dropped delivery wrapper — every one of which returns a
    perfectly plausible number that no output-shape test would notice.
    """
    checked = 0
    for bars in (wick, spy_daily[-200:]):
        for address in list(ev.INDICATOR_FUNCS) + list(ev.EVENT_FUNCS):
            series = alert_series.series_for(address, bars, params)
            assert len(series) == len(bars), address
            want = ev.value_function(address)(bars, params)
            got = ev._last_non_none(series)
            assert got == want, (address, params, got, want)
            checked += 1
    assert checked == 2 * (len(ev.INDICATOR_FUNCS) + len(ev.EVENT_FUNCS)) == 60


def test_the_anti_fork_rail_is_not_vacuous(wick):
    """A rail comparing None to None on every address would agree with a table of
    stubs. Every address must produce a real number on this fixture."""
    valued = [a for a in list(ev.INDICATOR_FUNCS) + list(ev.EVENT_FUNCS)
              if ev._last_non_none(alert_series.series_for(a, wick, {})) is not None]
    assert len(valued) == len(ev.INDICATOR_FUNCS) + len(ev.EVENT_FUNCS)


def test_the_series_table_covers_every_address_and_nothing_else():
    """⛔ TOTALITY, DERIVED — not a hand-kept list.

    The pre-C repair measured exactly this: `test_all_constants_match_owner_spec`
    covered 12 of 16 constants because it was a LIST somebody maintained, and the
    four `dpc` ones rode unpinned for the rule's entire life. A new address in
    `INDICATOR_FUNCS` with no series function is an alert that silently never
    fires on the closed lane — the `vwap` defect, reached from a new direction.

    ⭐ AND SINCE PHASE C TASK 10 IT RUNS THE OTHER WAY TOO, WHICH IS STRONGER.
    `INDICATOR_FUNCS` is DERIVED from `SERIES_FUNCS` now, so "every address has
    a series function" is true by construction; what this pins is that the
    partitioning does not LOSE one — an address dropped from every partition
    would be a column nothing can address, and the equality catches it from the
    side that is still hand-written.
    """
    assert set(alert_series.SERIES_FUNCS) == set(ev.all_addresses())
    assert len(alert_series.SERIES_FUNCS) == 31  # 28 levels + 2 events + close


def test_series_for_asserts_its_length_rather_than_trusting_it(wick):
    """⛔ THE ONE SAFETY PROPERTY WITH NO DOWNSTREAM DETECTOR.

    A column one element short does not raise anywhere: it shifts every bar index
    by one, so every alert reads the previous bar's number forever while every
    number it reports is real. There is no output test that catches that
    reliably. There is only this assertion, so deleting it has to be lethal.
    """
    original = alert_series.SERIES_FUNCS["rsi"]
    for trim in (lambda s: s[:-1], lambda s: s[1:]):
        alert_series.SERIES_FUNCS["rsi"] = (
            lambda bars, params, _t=trim: _t(original(bars, params)))
        try:
            with pytest.raises(AssertionError, match="series is"):
                alert_series.series_for("rsi", wick, {})
        finally:
            alert_series.SERIES_FUNCS["rsi"] = original
        assert alert_series.SERIES_FUNCS["rsi"] is original
    # ⚠️ BOTH DIRECTIONS ON PURPOSE. A LEADING trim leaves `_last_non_none`
    # intact, so the anti-fork rail above sails straight past it and only the
    # length assertion can see it.


def test_an_unknown_address_raises_here_and_stays_a_silent_no_op_upstream(wick):
    with pytest.raises(KeyError, match="no series function"):
        alert_series.series_for("not_an_address", wick, {})
    # …but the stored-typo path — which the create path still does not validate —
    # is unchanged: a quiet no-fire, exactly as the forming lane answers it.
    assert ev._evaluate_one_closed(_alert("not_an_address", tf="5"), wick,
                                   now_epoch=2e9) == (None, False, None)
    assert ev._evaluate_one(_alert("not_an_address", tf="5"), bars=wick,
                            mode="forming") == (None, False)


def test_chikou_has_no_value_at_the_newest_bar_and_that_is_the_honest_answer(spy_daily):
    """⚠️ THE ONE COLUMN WITH A TRAILING PAD, AND A DELIBERATE LANE DIFFERENCE.

    `compute_ichimoku_raw` back-shifts bar `i`'s close to index `i - 26`, so the
    newest 26 slots are None. The forming lane's `_last_non_none` walks backwards
    and happily returns a number from 26 bars ago; the closed lane reads
    `series[i]` and reports "no value here", which is correct — chikou at the
    newest closed bar is a fact about a bar that has not happened yet.
    """
    bars = spy_daily[-200:]
    series = alert_series.series_for("ichimoku.chikou", bars, {})
    assert series[-26:] == [None] * 26
    assert series[-27] is not None
    # The forming lane answers with a number for that same window…
    assert ev.value_function("ichimoku.chikou")(bars, {}) is not None
    # …and the closed lane declines, without pretending it never saw the bar.
    now = ev.bar_close_epoch(bars[-1]["t"], "D") - 1
    value, triggered, index = ev._evaluate_one_closed(
        _alert("ichimoku.chikou", "above", 0.0, tf="D"), bars, now_epoch=now)
    assert (value, triggered) == (None, False)
    assert index == len(bars) - 2, "it declined for the wrong reason"


# ─── the harness adapter has not forked from the shipped lane ────────────────

def test_the_closed_adapter_agrees_with_the_evaluators_own_evaluate_one_closed(wick, closed):
    """The memo in `make_closed_evaluate` is a FORK, exactly as the forming
    adapter's is, and this is what keeps it honest.

    ⛔ IT ALSO KILLS THE MEMO-MANUFACTURES-THE-ZERO TRAP. If the adapter's cache
    key dropped the forming partial, every k would return k=1's answer and the
    repaint oracle would read zero regardless of the code. Driving the same grid
    through the UNMEMOIZED shipped function and demanding equality makes that
    shortcut visible.
    """
    seen = wick[-ar.PROD_BAR_WINDOW:]
    now = ev.bar_close_epoch(seen[-1]["t"], "5") - 1
    compared = 0
    for address in list(ev.INDICATOR_FUNCS):
        for cond in ev.ALERT_CONDITIONS[address]:
            for thr in (None, -1.0, 0.0, 50.0, 70.0, 100.0):
                for prev in (None, 0.0, 70.0):
                    alert = _alert(address, cond["value"], thr, tf="5",
                                   last_value=prev)
                    want = ev._evaluate_one_closed(dict(alert), seen, now_epoch=now)
                    got = closed(dict(alert), seen)
                    assert got == want[:2], (address, cond["value"], thr, got, want)
                    compared += 1
    assert compared > 1000, f"only {compared} combinations compared — too thin"


def test_the_closed_adapters_memo_keys_on_the_forming_partial():
    """⛔ THE MEMO KEY, ASSERTED AS TEXT, BECAUSE THE BEHAVIOUR IT PROTECTS IS THE
    ZERO ITSELF. `_window_key` in the closed adapter must be byte-identical to
    the forming adapter's — same tuple, same tail fields, partial included."""
    src = pathlib.Path(ar.__file__).read_text(encoding="utf-8")
    keys = re.findall(
        r"def _window_key\(seen: list\[dict\]\) -> tuple:\n((?:        .*\n)+)", src)
    assert len(keys) == 2, "one of the two adapters lost its window key"
    assert keys[0] == keys[1], (
        "the closed adapter's memo key differs from the forming adapter's — if it "
        "dropped the forming partial the repaint oracle would read zero no matter "
        "what the code did")
    assert 'tail["c"]' in keys[0] and 'tail["v"]' in keys[0]


# ─── the repaint zero, on REAL tape and not only the hand-built fixture ──────

def test_the_closed_lane_reads_zero_on_real_daily_bars_WITH_a_fire_count(
        spy_daily, forming, closed):
    """⭐ THE HAND-BUILT WICK IS NOT ENOUGH. Real bars, real gaps, real holidays,
    a YYYYMMDD timestamp encoding, and the ET-midnight boundary all at once.

    A slice is used so pytest stays fast; `python tools/alert_replay.py --repaint
    --k 1 2 4 8 --mode closed` is the same measurement over all four fixtures and
    all 1,845 bars, and it is the gate.
    """
    bars = spy_daily[-160:]
    alerts, _ = ar.build_alert_grid("spy_daily", bars, "D", forming)
    per_k = {k: ar.replay(bars, copy.deepcopy(alerts), k=k, evaluate=closed)
             for k in (1, 2, 4, 8)}
    sets = {k: {ar.fire_key(f) for f in fs} for k, fs in per_k.items()}
    for k, s in sets.items():
        assert s == sets[1], f"k={k} differs from k=1 by {len(s ^ sets[1])} fires"
    assert len(sets[1]) > 100, f"only {len(sets[1])} distinct fires — too thin"
    assert sum(len(fs) for fs in per_k.values()) > 1000

    # …and the forming lane on the identical bars and grid DOES disagree, which
    # is what makes the zero above a measurement rather than a tautology.
    f_sets = {k: {ar.fire_key(f) for f in
                  ar.replay(bars, copy.deepcopy(alerts), k=k, evaluate=forming)}
              for k in (1, 4)}
    assert f_sets[4] != f_sets[1]


# ─── TASK 8: THE CUTOVER ITSELF ─────────────────────────────────────────────
#
# ⭐ EVERY RAIL BELOW IS MODE-AGNOSTIC ON PURPOSE. They are written on a tree
# whose constant still says "forming" and they have to stay honest on the tree
# whose constant says "closed" — so each one DRIVES the lane it is about
# (through the environment lever, which is the seam production itself uses)
# rather than assuming which one is committed. The tests that pin the SHIPPED
# value are separate and named as such.

RECORD = _ROOT / "docs" / "decisions" / "2026-08-06-closed-bar-alert-cutover.md"


def _status_lines(path) -> list:
    """Every `**Status:**` line in the record — ISOLATED **and counted**."""
    return [line for line in path.read_text(encoding="utf-8").splitlines()
            if line.lstrip().startswith("**Status:**")]


def _status_header_line(path) -> str:
    lines = _status_lines(path)
    assert lines, "the record carries no `**Status:**` line at all"
    return lines[0]


def test_the_record_and_the_code_agree_about_which_bar_is_judged():
    """A BICONDITIONAL, anchored on the record's own `**Status:**` HEADER LINE.

    ⛔ NOT A WHOLE-FILE REGEX. B4's review measured that one: flip the header to
    RESOLVED, append any second `**Status:** … OPEN` line anywhere in the file,
    and a whole-file `in` test goes GREEN. The header line is isolated AND
    COUNTED, so a second one is itself a failure.

    ⛔ AND IT FIRES BOTH WAYS. Flipping the mode without resolving the record is
    a cutover with no decision behind it; resolving the record without flipping
    the mode is a decision nothing implements. A `stillOpen: true` probe catches
    only the first — B5 Task 1's M7.
    """
    status = _status_header_line(RECORD)
    assert len(_status_lines(RECORD)) == 1, (
        "the record carries {} `**Status:**` lines; the anchor is only an anchor "
        "while there is exactly one".format(len(_status_lines(RECORD))))
    resolved = "ACCEPTED" in status
    assert resolved == (ev.eval_mode() == "closed"), (
        "the record and the evaluator disagree about which bar is judged: the "
        "header says {!r} and eval_mode() says {!r}".format(status,
                                                            ev.eval_mode()))


def test_the_cycle_NAMES_THE_BAR_IT_JUDGED_in_whichever_lane_is_running(
        monkeypatch):
    """🔴 THE RECEIPT RAIL, DRIVEN THROUGH BOTH LANES ON ONE OPEN BAR.

    `_run_one_cycle` computed the judged bar as `len(bars) - 1`, which is the
    forming lane's answer and is WRONG for the closed lane by exactly one bar
    whenever the newest bar is still being built. A receipt naming the forming
    bar while the value came from the closed one is a wrong receipt in the lane
    whose entire purpose is receipts that can be trusted.

    ⚠️ THE FIXTURE'S NEWEST BAR IS STILL OPEN, WHICH IS THE ONLY STATE THAT CAN
    TELL THE TWO APART. On a frozen historical window every bar is closed,
    `closed_bar_index` IS `len(bars) - 1`, and this test would agree with the
    defect — the same structural zero `cutover_watch` refused three times on
    live tape.
    """
    now = time.time()
    t0 = (int(now) // 300) * 300 - 59 * 300
    bars = [{"t": t0 + i * 300, "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.0,
             "v": 1000} for i in range(60)]
    alert = _alert("close", "above", 1.0, tf="5")

    assert ev.closed_bar_index(bars, "5", time.time()) == len(bars) - 2, (
        "the newest bar is not open on this box's clock — the fixture cannot "
        "separate the two lanes and every assertion below would be vacuous")

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert ev._evaluate_for_cycle(dict(alert), bars)[2] == len(bars) - 1

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    value, triggered, index = ev._evaluate_for_cycle(dict(alert), bars)
    assert triggered is True, "the fixture stopped firing; it proves nothing"
    assert index == len(bars) - 2, (
        "the closed lane judged bar {} and the cycle named bar {}".format(
            ev.closed_bar_index(bars, "5", time.time()), index))
    assert ev._fire_bar_time(bars, index) == bars[-2]["t"]
    assert ev._fire_bar_time(bars, index) != bars[-1]["t"]


def test_the_cycle_asks_eval_mode_and_does_not_recompute_the_closed_index():
    """⛔ THE INDEX IS AN OUTPUT OF THE EVALUATION, read off the AST.

    Two independent `closed_bar_index` calls resolve against two clocks. They
    agree almost always, and the almost is a fire naming the wrong bar with no
    way to notice. `_evaluate_for_cycle` therefore RETURNS the index the closed
    lane used, and `_run_one_cycle` must not compute one of its own.
    """
    src = pathlib.Path(ev.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    fns = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}

    cycle = ast.unparse(fns["_run_one_cycle"])
    assert "_evaluate_for_cycle" in cycle
    assert "closed_bar_index" not in cycle, (
        "the cycle recomputes the closed index instead of reading the one the "
        "evaluation used")
    assert "len(bars) - 1" not in cycle, (
        "the cycle still hard-codes the forming lane's judged bar")

    seam = ast.unparse(fns["_evaluate_for_cycle"])
    assert "eval_mode()" in seam, "the seam does not ask which lane is running"
    assert "_evaluate_one_closed" in seam and "_evaluate_one(" in seam


# ─── the needs-attention instrument, at the boundary it exists to guard ──────

def _diag_alert(address, tf="D"):
    return {"id": 1, "user_id": "u", "sym": "SPY", "tf": tf,
            "indicator": address, "condition": "above", "threshold": 0.0,
            "params_json": None, "last_value": None, "alert_key": "k"}


def test_diagnose_READS_THE_MODE_and_calls_the_MATCHING_resolver(spy_daily,
                                                                  monkeypatch):
    """🔴 THE ONE THAT WOULD HAVE LIED. Measured on the shipped tree.

    `diagnose` called `ev.address_value` — the FORMING resolver — in every mode.
    So on a `"closed"` tree it read `ichimoku.chikou` as 769.79 and answered
    `(False, None)` = HEALTHY, for the ONE address in the catalog that is
    permanently silent there. That is a monitor reading a proxy instead of the
    artifact, on the artifact this phase exists to make trustworthy — and a
    permanently-GREEN monitor is as broken as a red one.

    ⛔ ASSERTED AT THE BOUNDARY, WITH THE MODE FLIPPED. Checking only the healthy
    state is what let this survive: every address answers `(False, None)` under
    `"forming"`, including the one that is about to go silent forever.
    """
    from api.services import indicator_alert_service as ias
    bars = spy_daily

    # the control: the two resolvers really do disagree on this address here.
    index = ev.closed_bar_index(bars, "D", time.time())
    assert ev.address_value("ichimoku.chikou", bars, {}) is not None
    assert ev._closed_address_value("ichimoku.chikou", bars[:index + 1], {}) is None

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert ias.diagnose(_diag_alert("ichimoku.chikou"), bars) == (False, None), (
        "chikou fires on the forming lane and must NOT be reported as a fault "
        "there — the diagnosis follows the lane, it does not pick a side")

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    is_fault, detail = ias.diagnose(_diag_alert("ichimoku.chikou"), bars)
    assert is_fault is True, (
        "the closed lane cannot produce a value for this address and diagnose "
        "called it healthy")
    assert ias.CLOSED_LANE_TRAILING_PAD in detail
    assert "26" in detail, "the detail does not name the displacement"
    assert "ichimoku.kijun" in detail, "the detail offers no alternative"

    # …and it does not now call EVERYTHING broken.
    assert ias.diagnose(_diag_alert("rsi"), bars) == (False, None)
    assert ias.diagnose(_diag_alert("ichimoku.kijun"), bars) == (False, None)


def test_a_WARMING_alert_is_still_not_a_fault_in_the_closed_lane(spy_daily,
                                                                 monkeypatch):
    """⛔ THE OVER-FLAGGING RAIL. Same symptom, opposite prognosis.

    A column that has not warmed up is all-`None` up to the judged bar and fills
    in on its own; a displaced column has values BEFORE the judged bar and never
    one AT it. Both produce `value is None`. Reporting the first as a fault puts
    every fresh alert into `needs_attention` on its first sweep.
    """
    from api.services import indicator_alert_service as ias
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    is_fault, detail = ias.diagnose(_diag_alert("rsi"), spy_daily[:6])
    assert is_fault is False, detail
    assert detail is not None and "not enough history" in detail
    assert ias.CLOSED_LANE_TRAILING_PAD not in detail


def test_the_create_gate_refuses_chikou_ONLY_in_the_lane_that_cannot_answer_it(
        monkeypatch):
    """⛔ MODE-DERIVED, BECAUSE THE ROLLBACK LEVER MOVES THE LANE WITH NO DEPLOY.

    A gate wired to a lane by commit ordering starts refusing a working address
    the moment an operator rolls back mid-session — the create path deleting a
    live feature during an incident. Reading `eval_mode()` makes that
    disagreement impossible rather than merely unlikely.
    """
    from api.services import indicator_alert_service as ias

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert ias.refusal_for("ichimoku.chikou", "above", "5", 0.0) is None

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    refusal = ias.refusal_for("ichimoku.chikou", "above", "5", 0.0)
    assert refusal is not None and ias.CLOSED_LANE_TRAILING_PAD in refusal
    # …and nothing else in the catalog is caught by it.
    assert ias.refusal_for("ichimoku.kijun", "above", "5", 0.0) is None
    assert ias.refusal_for("rsi", "above", "5", 70.0) is None


def test_the_measured_closed_lane_dead_set_is_exactly_chikou_today():
    """The set is DERIVED from the columns; this pins what it measures to.

    ⛔ AND THE PAD IS MEASURED, NOT TYPED. `tests/test_indicator_golden.py`
    already declares `TRAILING_PAD = {("ichimoku_9_26_52","chikou"): 26}`; this
    reaches the same 26 from the column itself, so the two can never need to be
    kept in step by hand.
    """
    from api.services import indicator_alert_service as ias
    assert ias.closed_lane_dead_addresses() == frozenset({"ichimoku.chikou"})
    instant, calendar = ias._probe_series()
    assert ias.closed_lane_pad("ichimoku.chikou", instant, {}) == 26
    assert ias.closed_lane_pad("ichimoku.chikou", calendar, {}) == 26
    # the non-vacuity floor: the measurement EXCLUDED things, it did not pass
    # everything through.
    assert ias.closed_lane_pad("rsi", instant, {}) == 0
    assert len(ev.all_addresses()) == 31
