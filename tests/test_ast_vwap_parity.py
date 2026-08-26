r"""⭐⭐ `vwap()` AND `avwap(anchorEpoch)` — ONE SESSION ACCUMULATOR, TWO NAMES.

The point of this pair is NOT that the closed table gains two callables. It is
that a formula's ``vwap()`` and the VWAP the chart draws are **the same number,
computed by the same loop**. ``indicators.js::computeVWAP`` and
``indicator_compute.compute_vwap_raw`` are that loop, one per lane, and the
bindings added here pass the bars straight through to them. There is no second
session boundary, no second anchor and no second accumulation anywhere in this
task -- ``a second authority over one value`` is the defect this repo has paid
for more often than any other, and a VWAP that disagrees with the VWAP is the
most legible possible instance of it.

⭐ WHY `vwap()` IS DECLARABLE AT ALL, HAVING BEEN REFUSED SINCE THE TABLE OPENED.
``_functions_excluded`` carried it in these words: *"deciding it needs the bar's
TIMESTAMP, and `series` declares five fields and `t` is not one of them. Making
vwap callable means either declaring the anchor as an argument kind this table
does not have, or admitting a window `maxLookback` cannot sum."* Both halves are
now answered and neither by an exception:

  * the ANCHOR is the CLOCK, not an argument -- ``lookback: "session"`` (task 3)
    says exactly that, and ``sessionMaxBars`` is the number that bounds it;
  * the TIMESTAMP reaches the maths because ``vwap()`` takes **no series
    arguments**. ``bindShipped`` fabricates ``t: i`` precisely because its bars
    are packed out of ARGUMENT COLUMNS, which carry no instant. An entry
    declaring ``reads: "bars"`` is handed ``interpret``'s own bar array instead
    -- the same array ``computeClock`` already reads -- so the anchor is the real
    ET calendar day rather than a bar index.

🔴 AND ONE PLACE THE BRIEF WAS WRONG, MEASURED HERE. The brief specifies
``avwap(anchorEpoch)`` as a pass-through of the anchored accumulator. A raw
epoch anchor has an UNBOUNDED reach -- the value at bar ``i`` reads every bar
back to the anchor, however far that is -- so ``lookback: "session"`` (960)
UNDER-STATES it, and ``_functions_warmup`` names under-stating as *"the one thing
a budget cannot use"*. Worse, an anchor that falls BEFORE the first bar of the
series makes the value depend on how many bars the caller happened to fetch,
which is ``lesson_a_derived_value_must_not_depend_on_the_request`` -- the exact
defect ``_functions_recurrence`` says ``accum``'s re-seeded window exists to
prevent. So the binding ENFORCES the declared window, in both lanes:

  1. the anchor's boundary must be VISIBLE -- some bar of the series must fall
     strictly before the anchor -- else the whole column is not computable;
  2. a bar more than ``sessionMaxBars`` past the anchor bar is not computable.

Both are the ordinary warm-up bargain every windowed entry here already makes
(*"sma(close, 20) is NaN for 19 bars and exact afterwards, and so is this"*),
turned the other way round. They make ``lookback: "session"`` a TRUE declaration
rather than one that happens to be right for near anchors -- and task 3 shipped
three fix rounds for exactly one declared property that was false.

⚠️ NOTHING HERE PADS `vwap()`. Its leading partial session is inherited from
``computeVWAP`` and is deliberately NOT trimmed: the chart draws that column, and
trimming it only on the AST lane would fork the number in two. The caveat is
recorded in ``closedTable.json::_functions_bar_readers`` instead.
"""
from __future__ import annotations

import math
import pathlib
import sys

import pytest

from api.services import ast_interpret, ast_table
from api.services.indicator_compute import (compute_avwap_raw, compute_vwap_raw)

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

REL_TOL = 1e-9


def _ac():
    import ast_conformance as ac
    return ac


@pytest.fixture(scope="module")
def bars():
    """The conformance corpus's own 579 five-minute bars.

    ⭐ NOT A SERIES THIS FILE BUILT. They are the bars the cross-lane digest is
    recorded over, resolved through ``alert_replay.load_fixture`` with its
    recorded sha256 re-checked, so this rail and the conformance gate measure ONE
    tape. They span 2025-10-31 04:00 EDT to 2025-11-04 20:00 EST -- a DST
    fallback, a weekend, and (the point of §UTC below) the Friday 20:00 ET bar
    that IS 00:00 UTC the next day.
    """
    return _ac().corpus_bars()


def _finite(col):
    return [v for v in col if isinstance(v, (int, float))
            and not isinstance(v, bool) and math.isfinite(float(v))]


def _close(a, b):
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(float(a), float(b), rel_tol=REL_TOL, abs_tol=0.0)


# --------------------------------------------------------------------------- #
# the corpus is real enough to measure anything at all
# --------------------------------------------------------------------------- #

def test_the_corpus_bars_span_the_extended_hours_UTC_MIDNIGHT_this_task_is_about(bars):
    """⛔ THE NON-VACUITY GATE, AND IT IS SPECIFIC RATHER THAN A LENGTH CHECK.

    Everything below is a claim about a SESSION BOUNDARY. A fixture that held one
    ET day, or that never reached 20:00 ET, would let every assertion in this
    file pass against a lane that had no boundary logic at all.
    """
    from zoneinfo import ZoneInfo
    import datetime as _dt
    et = ZoneInfo("America/New_York")
    assert len(bars) > 400, len(bars)
    days = {_dt.datetime.fromtimestamp(b["t"], et).date() for b in bars}
    assert len(days) >= 3, sorted(days)
    # The retired UTC bucketing broke on the bar whose ET evening is the NEXT
    # UTC day. 20:00 ET on EDT is exactly 00:00 UTC.
    crossings = [b for b in bars
                 if _dt.datetime.fromtimestamp(b["t"], _dt.timezone.utc).hour == 0
                 and _dt.datetime.fromtimestamp(b["t"], et).hour == 20]
    assert crossings, "no extended-hours bar lands on UTC midnight — the case this file exists for"


# --------------------------------------------------------------------------- #
# vwap() IS computeVWAP -- the whole acceptance criterion
# --------------------------------------------------------------------------- #

VWAP = {"type": "call", "name": "vwap", "args": []}


def test_vwap_IS_the_shipped_session_accumulator_bar_for_bar(bars):
    """⭐⭐ THE ACCEPTANCE CRITERION. Not "close to", not "also session-anchored"
    -- the SAME NUMBER at every bar, because it is the same loop."""
    got = ast_interpret.interpret(VWAP, bars)
    want = compute_vwap_raw(bars)
    assert len(got) == len(bars) == len(want)
    bad = [(i, got[i], want[i]) for i in range(len(bars)) if not _close(got[i], want[i])]
    assert not bad, bad[:5]
    assert len(_finite(got)) > 400, len(_finite(got))


def test_vwap_ANCHORS_ON_THE_ET_DAY_and_the_retired_UTC_DAY_is_a_DIFFERENT_column(bars):
    """⛔ THE REGRESSION TRIPWIRE, IN THE AST LANE.

    ``vwapUtcBucketing.test.js`` guards the JS chart function. This is the second
    tripwire, on the table's own callable, and it is a CONTRAST rather than an
    assertion about one number: it recomputes the column the retired UTC-day
    bucketing would have produced and requires the shipped column to DIFFER by a
    real amount at the boundary. A test that only asserted `vwap() == vwap()`
    would stay green through a full revert to UTC bucketing.
    """
    import datetime as _dt
    got = ast_interpret.interpret(VWAP, bars)

    # The retired bucketing, rebuilt here rather than imported -- it must not
    # exist anywhere in the product.
    utc = [None] * len(bars)
    cum_pv = cum_v = 0.0
    day = None
    for i, b in enumerate(bars):
        key = _dt.datetime.fromtimestamp(b["t"], _dt.timezone.utc).date()
        if key != day:
            cum_pv = cum_v = 0.0
            day = key
        cum_pv += (b["h"] + b["l"] + b["c"]) / 3.0 * b["v"]
        cum_v += b["v"]
        if cum_v > 0:
            utc[i] = cum_pv / cum_v

    apart = [abs(float(got[i]) - float(utc[i]))
             for i in range(len(bars))
             if got[i] is not None and utc[i] is not None]
    assert apart, "no bar computable in both readings — the contrast measures nothing"
    assert max(apart) > 1e-6, (
        f"the ET-day and UTC-day readings differ by at most {max(apart):.3e} on this "
        "corpus, so this fixture cannot tell a session-anchored VWAP from the "
        "defect `VWAP_SESSION_ANCHOR` retired")


# --------------------------------------------------------------------------- #
# avwap(anchorEpoch)
# --------------------------------------------------------------------------- #

def _avwap(epoch):
    return {"type": "call", "name": "avwap",
            "args": [{"type": "num", "value": int(epoch)}]}


def test_avwap_from_a_mid_series_epoch_is_a_HAND_ROLLED_accumulate_from_that_bar(bars):
    """The anchored form, measured against an accumulation written out longhand
    here — not against ``compute_avwap_raw`` — so the binding and the shipped
    accumulator have to agree with a third, independent reading."""
    anchor = bars[len(bars) // 2]["t"]
    got = ast_interpret.interpret(_avwap(anchor), bars)

    want = [None] * len(bars)
    cum_pv = cum_v = 0.0
    for i, b in enumerate(bars):
        if b["t"] < anchor:
            continue
        cum_pv += (b["h"] + b["l"] + b["c"]) / 3.0 * b["v"]
        cum_v += b["v"]
        if cum_v > 0:
            want[i] = cum_pv / cum_v

    bad = [(i, got[i], want[i]) for i in range(len(bars)) if not _close(got[i], want[i])]
    assert not bad, bad[:5]
    finite = _finite(got)
    assert len(finite) > 200, len(finite)
    # ⛔ AND IT IS BLANK BEFORE THE ANCHOR, never a partial accumulation of the
    # bars that came first — which would be a confident wrong number wearing a
    # warm-up's clothes.
    assert all(got[i] is None for i, b in enumerate(bars) if b["t"] < anchor)


def test_avwap_REUSES_the_shipped_anchored_accumulator(bars):
    """⭐ ONE ACCUMULATOR. The binding is a pass-through of
    ``compute_avwap_raw``; this is the assertion that says so, so a future
    hand-rolled loop in ``ast_interpret`` fails rather than merely being
    untidy."""
    anchor = bars[len(bars) // 2]["t"]
    got = ast_interpret.interpret(_avwap(anchor), bars)
    want = compute_avwap_raw(bars, anchor)
    bad = [(i, got[i], want[i]) for i in range(len(bars)) if not _close(got[i], want[i])]
    assert not bad, bad[:5]


def test_an_anchor_BEFORE_the_first_bar_is_NOT_COMPUTABLE_rather_than_request_dependent(bars):
    """🔴 THE RULE THE BRIEF DID NOT HAVE, AND THE REASON IT IS NEEDED.

    With the anchor before the series, ``the first bar at or after the anchor``
    is whatever bar the caller happened to fetch first — so the value moves when
    the window moves, and a member panning a chart or a sweep widening its
    fetch would read a DIFFERENT anchored VWAP for the same anchor. The control
    below is what makes this a measurement rather than a preference: the same
    anchor over a SHORTER slice of the same tape produces a different column
    under a pass-through, and both are refused here.
    """
    before = bars[0]["t"] - 1
    assert all(v is None for v in ast_interpret.interpret(_avwap(before), bars))

    # THE CONTROL — the pass-through this refusal replaces really is
    # request-dependent, so the refusal is not defending against nothing.
    raw_full = compute_avwap_raw(bars, before)
    raw_short = compute_avwap_raw(bars[100:], before)
    assert not _close(raw_full[-1], raw_short[-1]), (
        "the shipped accumulator answers the same number on both slices, so this "
        "corpus cannot show the request-dependence the refusal exists for")

    # …and an anchor exactly ON the first bar is still refused: `t >= anchor` is
    # satisfied by bar 0 whether or not earlier bars existed, so the boundary is
    # not VISIBLE and the same ambiguity applies.
    assert all(v is None for v in ast_interpret.interpret(_avwap(bars[0]["t"]), bars))


def test_avwap_STOPS_at_the_window_it_DECLARES(bars):
    """⛔ THE DECLARED PROPERTY IS MADE TRUE, NOT ASSERTED.

    ``lookback: "session"`` resolves to ``sessionMaxBars``. A bar further than
    that past the anchor would be computed from bars outside the declared window
    — under-stating, which ``_functions_warmup`` forbids. The bound is DERIVED
    from the manifest here, never typed: this test reads the same number the
    interpreter does.
    """
    session = ast_table.TABLE["sessionMaxBars"]
    assert isinstance(session, int) and session >= 1

    # A window shorter than the corpus, so the bound is REACHABLE on this
    # fixture. ⭐ The manifest's own number is far longer than 579 bars, which is
    # exactly why this case reloads the constant instead of trusting the shipped
    # one to bite — a cap that cannot be reached is not a cap.
    short = 50
    anchor_index = 100
    anchor = bars[anchor_index]["t"]
    original = ast_interpret.SESSION_MAX_BARS
    try:
        ast_interpret.SESSION_MAX_BARS = short
        got = ast_interpret.interpret(_avwap(anchor), bars)
    finally:
        ast_interpret.SESSION_MAX_BARS = original
    assert ast_interpret.SESSION_MAX_BARS == original

    last = anchor_index + short
    assert got[anchor_index] is not None
    assert got[last] is not None, "the last bar INSIDE the declared window must answer"
    assert got[last + 1] is None, "a bar past the declared window must not answer"
    assert all(v is None for v in got[last + 1:])

    # THE CONTROL — at the shipped window the bound does not bite on this
    # fixture, so the two runs differ and the trim above is really the trim.
    full = ast_interpret.interpret(_avwap(anchor), bars)
    assert full[-1] is not None


# --------------------------------------------------------------------------- #
# the declarations themselves
# --------------------------------------------------------------------------- #

def test_both_entries_declare_the_session_window_and_READ_THE_BARS(bars):
    """The two manifest properties the bindings depend on, asserted where a
    reader will look for them rather than left implicit in behaviour."""
    fns = ast_table.TABLE["functions"]
    for name, arity in (("vwap", 0), ("avwap", 1)):
        spec = fns[name]
        assert spec["lookback"] == "session", (name, spec.get("lookback"))
        assert spec["reads"] == "bars", (name, spec.get("reads"))
        assert len(spec["args"]) == arity, (name, spec["args"])
        assert spec["yields"] == "num", (name, spec.get("yields"))
        assert spec["cadence"] == "live", (name, spec.get("cadence"))
    assert set(ast_table.bar_readers()) == {"vwap", "avwap"}, ast_table.bar_readers()


def test_the_bar_reader_set_is_DERIVED_from_the_manifest_not_listed(bars):
    """⛔ THE `recurrence` IDIOM, APPLIED. ``ast_table.bar_readers`` asks the
    manifest *"does this entry declare that it reads the bars"*, never *"is this
    call vwap"* — so a third such entry needs no edit in either walker. The
    control is a planted manifest: a name neither lane has heard of shows up in
    the derived set."""
    planted = {"functions": {"zzz": {"args": [], "reads": "bars"},
                             "sma": {"args": ["series", "int"]}}}
    assert set(ast_table.bar_readers(planted)) == {"zzz"}
    assert set(ast_table.bar_readers({"functions": {"sma": {"args": []}}})) == set()


def test_vwap_is_no_longer_listed_as_REFUSED(bars):
    """⛔ DECLARING ONE MEANS DELETING ITS KEY. ``_functions_excluded``'s own
    note says so, and ``conceptVocabulary.test.js`` derives its undeclared-name
    probe from the non-underscore keys — a name left in both places points that
    probe at a name that is now legal."""
    excluded = ast_table.TABLE["_functions_excluded"]
    assert "vwap" not in excluded
    assert "avwap" not in excluded
    # …and the withdrawal is KEPT as a record, in the file's own ⚰️ idiom.
    assert "_vwap_was_here" in excluded
# --------------------------------------------------------------------------- #
# the two guards a value-based rail cannot see
# --------------------------------------------------------------------------- #

def test_a_FUNCTIONS_declared_cadence_is_a_CLAIM_the_reader_CHECKS(bars):
    """⭐⭐ WHY THIS EXISTS AT ALL. The cross-lane contract fixes ``cadence`` on
    functions, and ``vwap``/``avwap`` declare ``cadence: "live"``. A declared
    field nothing reads is an INERT KNOB -- this lane has already shipped two of
    those this wave -- so ``ast_freshness`` reads it. Today every declared value
    is ``live``, so the arm changes no shipped answer, which is exactly the shape
    a mutation sweep found SURVIVING one task earlier (``ast_budget``'s floor
    arm, C5). It is therefore railed through the PLANTED-MANIFEST seam the module
    already takes, never by a value that happens to differ.
    """
    from api.services import ast_freshness

    tree = {"type": "call", "name": "vwap", "args": []}

    def with_cadence(cadence):
        fns = dict(ast_table.TABLE["functions"])
        fns["vwap"] = dict(fns["vwap"], cadence=cadence)
        return dict(ast_table.TABLE, functions=fns)

    shipped = ast_freshness.freshness_for(tree, {})
    assert shipped["mode"] == "live"
    assert shipped["cadences"] == [] and shipped["scalars"] == []

    nightly = ast_freshness.freshness_for(tree, {"table": with_cadence("nightly")})
    assert nightly["mode"] == "as-of-snapshot"
    assert nightly["cadences"] == ["nightly"]
    assert nightly["scalars"] == ["vwap"]
    assert "rebuilt nightly" in " ".join(nightly["reasons"])

    # ⛔ FAIL-CLOSED on a cadence this reader cannot use -- never a quiet `live`.
    for bad in (None, 7, ""):
        assert ast_freshness.freshness_for(
            tree, {"table": with_cadence(bad)})["mode"] == "unknown", bad

    # THE NON-VACUITY CONTROL: without it, a reader that answered
    # `as-of-snapshot` for the mere PRESENCE of a `cadence` key would pass above.
    assert ast_freshness.freshness_for(
        tree, {"table": with_cadence("live")})["mode"] == "live"


def test_the_ANCHOR_carries_the_same_UNIT_GUARD_the_bars_do(bars):
    """⛔ A `YYYYMMDD` INTEGER HANDED IN AS AN INSTANT RESOLVES TO 1970.

    ``AVWAP_MIN_INSTANT`` exists because that defect was LIVE and MEASURED on the
    BAR side (`_fetch_bars_for_alert` handed the store's `20250101`). The anchor
    is the same kind of value from the same kind of caller, so it takes the same
    guard -- and a mutation sweep proved the guard was unrailed: deleting it
    survived every suite until this case existed.

    ⚠️ It is measured on ``compute_avwap_raw`` DIRECTLY rather than through the
    table, because the AST binding's own visible-boundary rule already refuses a
    sub-1990 anchor for a different reason -- so a rail that only went through
    ``interpret`` would be green with the guard deleted.
    """
    assert all(v is None for v in compute_avwap_raw(bars, 20250101))
    assert all(v is None for v in compute_avwap_raw(bars, 5))
    # NON-VACUITY: a real instant inside the series still answers.
    ok = compute_avwap_raw(bars, bars[len(bars) // 2]["t"])
    assert any(v is not None for v in ok)
