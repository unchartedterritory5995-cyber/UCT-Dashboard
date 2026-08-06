"""Golden-fixture tests — the Python half of the shared indicator oracle.

The same JSON files in ``tests/fixtures/indicators/`` are read by
``app/src/components/chart/goldenFixtures.test.js``. Contract, alignment rule
and the ban on regenerating fixtures: ``tests/fixtures/indicators/_schema.md``.
"""

import json
import math
import pathlib
from datetime import datetime

import pytest

from api.services import indicator_compute as ic

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIX = pathlib.Path(__file__).parent / "fixtures" / "indicators"

# Every indicator that exists in BOTH lanes. Until B5 that was SEVEN, and the
# other seven engine definitions (vwap/atr/sar/ichimoku/obv/donchian/adx) were
# JS-only — which is why an alert naming one could be stored and could never
# fire. They are ported now and each carries a case here.
# (sma/ema exist in this lane but have no fixture case.)
CASES = [
    "rsi_ramp_14",
    "macd_default",
    "bb_20_2",
    "stoch_14_3",
    "williams_r_14",
    "cci_20",
    "mfi_14",
    # ── B5: the seven that used to be JS-only ──
    "atr_14",
    "adx_14",
    "obv_basic",
    "donchian_20",
    "ichimoku_9_26_52",
    "sar_default",
    # ── Phase C: SAR's two EVENT columns ──
    # `sar_events_default` OWNS NO BARS — `barsFrom` points at `sar_default.json`,
    # whose `sar` and `trend` columns both lanes have pinned since B5, so these
    # two columns are DERIVED from numbers that already had an oracle and not one
    # fixture byte was reseeded to add them.
    "sar_events_default",
    "sar_events_outside_bar",
    # Own no bars: `barsFrom` points at the CHART PARITY GATE's intraday fixture,
    # so this lane's 1e-9 compare runs on the exact series the chart draws.
    "vwap_session_expected",
    "intraday5m_sessions",
    # ── Phase C Task 14 ──
    # Both own no bars either, and for the same reason each time: the referent
    # already carries a column this case must be DERIVABLE from.
    #   `avwap_session`    → vwap_extended_hours_utc_midnight's `etSessionVwap`
    #   `atr_bands_14_2`   → atr_14's `atr`
    "avwap_session",
    "atr_bands_14_2",
]

VWAP_CASES = ["vwap_extended_hours_utc_midnight", "vwap_dst_transition"]

# ⛔ THE RS LINE IS ITS OWN LIST BECAUSE IT IS NOT DISPATCHABLE THROUGH
# `compute_case`, AND THAT IS A STATEMENT ABOUT THE INDICATOR RATHER THAN ABOUT
# THIS FILE. It needs TWO series — its own and the benchmark's — and both
# `compute_case(kind, bars, params)` and spec §4's
# `compute({bars, inputs, prevState, barstate})` carry exactly ONE. That single
# constraint is what makes the definition `compute.kind: 'server'` (decision A3)
# and what keeps `rs_line` out of `_CASE_COLUMNS`; smuggling the benchmark
# through `params` to get a row in the parametrised sweep would make the dispatch
# lie about its own shape at exactly one row.
RS_LINE_CASES = ["rs_line_spy"]

# Cases whose bars live in another file. The indirection is the point — see
# `_generate.py::_write_referenced` — so it gets its own list rather than being
# inferred, and `test_a_referenced_case_really_is_referenced` guards it.
REFERENCED_CASES = {
    "intraday5m_sessions": "app/src/pages/parityBars/intraday5m.json",
    "vwap_session_expected": "app/src/pages/parityBars/intraday5m.json",
    # Phase C. The referent is another FIXTURE rather than the parity bars, and
    # the reason is the same one: `sar_events_default`'s two columns are derived
    # from `sar_default`'s `sar` and `trend`, so the two cases must be one series.
    # A copy would let `sar_default` be reseeded without this case noticing.
    "sar_events_default": "tests/fixtures/indicators/sar_default.json",
    # Phase C Task 14. Same shape, same reason: each referent already carries the
    # column its dependant must be derivable from, so a copy would let the
    # referent be reseeded without the dependant noticing.
    "avwap_session": "tests/fixtures/indicators/vwap_extended_hours_utc_midnight.json",
    "atr_bands_14_2": "tests/fixtures/indicators/atr_14.json",
}

# ─── the ONE column that pads at BOTH ends ───────────────────────────────────
#
# `ichimoku`'s chikou is plotted `kijun_period` bars BACK: bar i's close is
# written to index i - 26, so the LAST 26 slots are pad. Every other column in
# every other case pads only at the head.
#
# ⛔ DECLARED AS A NUMBER, NOT WAIVED. The obvious way to make the alignment test
# tolerate this is to skip the column, or to relax "no holes after the first
# value" to "holes allowed". Both would stop the test noticing if chikou's shift
# changed, vanished, or grew — which is a PRESERVED QUIRK the chart's picture
# depends on. Naming the exact trailing length instead means the quirk has a
# gate: change the back-shift and this goes red with the two numbers in hand.
TRAILING_PAD = {("ichimoku_9_26_52", "chikou"): 26}


def load_case(name):
    """Read one fixture. Same helper name/shape as the vitest lane's loadCase."""
    return json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))


def case_bars(case):
    """A case's bars, whether it owns them or names the file that does.

    `barsFrom` is repo-root-relative with POSIX separators. Resolving it here
    (rather than copying the bars into the fixture) is what makes the golden
    oracle and the rendered parity picture provably ONE series: regenerating
    `app/src/pages/parityBars/intraday5m.json` turns the `expected` columns red
    in both lanes instead of silently expiring every parity number.
    """
    if "bars" in case:
        return case["bars"]
    ref = case["barsFrom"]
    path = ROOT.joinpath(*ref.split("/"))
    assert path.exists(), f"{case['case']}: barsFrom {ref} does not exist"
    return json.loads(path.read_text(encoding="utf-8"))["bars"]


def _close(a, b, rel):
    """Fixture tolerance rule: relative, with an absolute floor so a column that
    passes through zero (MACD histogram, CCI) is not held to an impossible bar."""
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=rel, abs_tol=rel)


# ─── the fixtures themselves ─────────────────────────────────────────────────

@pytest.mark.parametrize("name", CASES)
def test_python_lane_matches_the_golden_columns(name):
    case = load_case(name)
    bars = case_bars(case)
    got = ic.compute_case(case["kind"], bars, case["params"])
    assert set(got) == set(case["expected"]), f"{name}: column set drifted"
    for col, exp in case["expected"].items():
        assert len(got[col]) == len(bars), f"{name}.{col} not aligned to bars"
        assert len(exp) == len(bars), f"{name}.{col} fixture not aligned to bars"
        for i, (g, e) in enumerate(zip(got[col], exp)):
            assert _close(g, e, case["relTol"]), f"{name}.{col}[{i}]: {g!r} != {e!r}"


@pytest.mark.parametrize("name", CASES)
def test_columns_are_null_padded_then_continuous(name):
    """Alignment rule of record: nulls come first, then values, no holes.

    A hole in the middle would mean an indicator silently skipped a bar, which
    is exactly the kind of thing a value-by-value compare can miss when the
    fixture was generated from the same skip.

    The single exception is DECLARED in ``TRAILING_PAD`` and its length is
    asserted exactly — see that constant before adding to it.
    """
    case = load_case(name)
    for col, exp in case["expected"].items():
        trailing = TRAILING_PAD.get((name, col), 0)
        head = exp if trailing == 0 else exp[:-trailing]
        first = next((i for i, v in enumerate(head) if v is not None), None)
        assert first is not None, f"{name}.{col} is entirely null"
        assert all(v is None for v in head[:first]), f"{name}.{col} pad is not contiguous"
        assert all(v is not None for v in head[first:]), f"{name}.{col} has a hole after {first}"
        if trailing:
            assert all(v is None for v in exp[-trailing:]), (
                f"{name}.{col} declares a {trailing}-slot trailing pad it does not have"
            )


def test_the_declared_trailing_pad_is_exactly_that_long():
    """The back-shift, as a NUMBER, in both directions.

    ⚠️ THE TEST ABOVE IS HALF THE CLAIM. It proves the declared tail is null; it
    would stay green if the tail were LONGER than declared (chikou shifted 40
    bars back would still have 26 nulls at the end). This pins the boundary: the
    slot just before the declared pad must carry a value, so the pad is exactly
    26 and the back-shift is exactly `kijun_period`.
    """
    for (name, col), trailing in TRAILING_PAD.items():
        case = load_case(name)
        exp = case["expected"][col]
        assert exp[-trailing] is None, f"{name}.{col} pad starts later than declared"
        assert exp[-trailing - 1] is not None, (
            f"{name}.{col} trailing pad is LONGER than the declared {trailing} — the "
            f"back-shift moved and only this end of the assertion can see it"
        )
        # …and it really is the definition's kijun period, not a coincidence.
        assert trailing == case["params"]["kijun_period"]


def test_obv_has_no_pad_at_all_because_bar_zero_is_seeded_with_zero():
    """⚠️ PRESERVED QUIRK, pinned where a lane would 'correct' it.

    Every other column starts with a null pad. OBV does not: B1 pinned bar 0 at
    `0` rather than "not computable yet", so the line starts at zero on the first
    bar. The alignment test above cannot see this — a padded bar 0 satisfies
    "nulls first, then values" perfectly — so the seed needs its own assertion.
    """
    exp = load_case("obv_basic")["expected"]["obv"]
    assert exp[0] == 0, "OBV's zero seed is gone — bar 0 was padded instead"
    assert all(v is not None for v in exp), "OBV grew a pad it must not have"


def test_every_fixture_file_is_covered_by_a_test():
    """A fixture nobody reads is a fixture nobody maintains."""
    on_disk = {p.stem for p in FIX.glob("*.json")}
    listed = set(CASES) | set(VWAP_CASES) | set(RS_LINE_CASES)
    assert on_disk == listed, (
        f"fixture files and the CASES lists disagree: {on_disk ^ listed}"
    )


@pytest.mark.parametrize("name", VWAP_CASES)
def test_vwap_session_fixtures_carry_a_real_trap(name):
    """The fixture's SHAPE: UTC-day bucketing really does split these sessions
    more often than ET-day bucketing would.

    This is a claim about the FIXTURE, not about either lane's code, which is
    why it was written before Python had a VWAP and is unchanged now that it
    does. The behavioural half — that `compute_vwap_raw` produces the ET-anchored
    series — is the test directly below.
    """
    case = load_case(name)
    s = case["session"]
    assert case["expected"] is None
    n = len(case["bars"])
    for key in ("etDate", "etHour", "utcDate", "etSessionVwap"):
        assert len(s[key]) == n, f"{name}.session.{key} not aligned to bars"
    assert len(s["utcResetIndices"]) > len(s["etResetIndices"]), (
        f"{name}: UTC bucketing must split the tape MORE than ET bucketing, "
        f"else the case pins nothing"
    )


def _vwap_by_utc_day(bars):
    """The bucketing that shipped until 2026-08-03, as the control.

    Deliberately a re-implementation rather than an import: the point is to hold
    a series `compute_vwap_raw` no longer produces, so "the port is ET-anchored"
    is measured against something that can disagree with it. Mirrors
    `vwapByUtcDay` in the vitest lane, for the same reason.
    """
    import datetime as _dt
    out, pv, vol, cur = [], 0.0, 0.0, None
    for b in bars:
        key = _dt.datetime.fromtimestamp(b["t"], _dt.timezone.utc).strftime("%Y-%m-%d")
        if key != cur:
            pv, vol, cur = 0.0, 0.0, key
        tp = (b["h"] + b["l"] + b["c"]) / 3.0
        v = float(b["v"])
        pv += tp * v
        vol += v
        out.append(pv / vol if vol > 0 else None)
    return out


@pytest.mark.parametrize("name", VWAP_CASES)
def test_the_python_vwap_port_is_ET_ANCHORED_not_utc(name):
    """⭐ THE PORT PROOF FOR THE ONE INDICATOR THAT HAD A DECISION ATTACHED.

    `VWAP_SESSION_ANCHOR` was accepted 2026-08-03 at a measured 2,590 changed
    pixels: `computeVWAP` buckets by the ET CALENDAR DAY, not the UTC one. B5
    ports the CORRECTED logic, so this lane must reproduce
    `session.etSessionVwap` — a column these fixtures have carried since before
    Python had a VWAP at all, and which was NOT reseeded for this task.

    ⚠️ THE NON-VACUITY HALF IS THE POINT. On regular trading hours the two
    bucketings are identical, so a fixture where they agree would pass whether
    the port took the corrected logic or the retired one. These two cases are
    extended hours precisely so they disagree, and the assertion below measures
    that disagreement in dollars before trusting the agreement above it.
    """
    case = load_case(name)
    bars = case["bars"]
    s = case["session"]
    got = ic.compute_vwap_raw(bars)

    assert len(got) == len(bars)
    for i, exp in enumerate(s["etSessionVwap"]):
        assert _close(got[i], exp, case["relTol"]), f"{name}.vwap[{i}]: {got[i]!r} != {exp!r}"

    # It resets at the ET session opens the fixture names, and at nothing else:
    # the accumulator collapses to one bar's typical price only where a session
    # opens, so those indices are exactly `etResetIndices`.
    collapsed = [
        i for i, b in enumerate(bars)
        if abs(got[i] - (b["h"] + b["l"] + b["c"]) / 3.0) < 1e-9
    ]
    assert collapsed == s["etResetIndices"], (
        f"{name}: the port resets at {collapsed}, the ET session opens are "
        f"{s['etResetIndices']}"
    )

    # NON-VACUOUS, in dollars: the retired bucketing gives a materially different
    # number at every boundary it used to trip and this one does not.
    old = _vwap_by_utc_day(bars)
    mid_session = [i for i in s["utcResetIndices"] if i not in s["etResetIndices"]]
    assert mid_session, f"{name} exercises no UTC-only split — it pins nothing"
    for i in mid_session:
        assert abs(old[i] - got[i]) > 1.0, (
            f"{name}: bar {i} splits mid-session but the two bucketings agree to within $1"
        )


# ─── the intraday case the parity gate renders ───────────────────────────────
# `intraday5m_sessions` is the bridge between the two gates: the shared compute
# oracle and the pixel gate assert against the SAME bar series, by reference
# rather than by copy. Everything below guards that bridge from this lane; the
# behavioural VWAP assertions are vitest's (Python has no VWAP).

def test_a_referenced_case_really_is_referenced():
    """`barsFrom`, not `bars`. A case that quietly grew its own copy of the
    series would still pass every compare above while the oracle and the
    rendered picture drifted apart — which is the one thing the indirection
    exists to make impossible."""
    for name, ref in REFERENCED_CASES.items():
        case = load_case(name)
        assert "bars" not in case, (
            f"{name} grew its own `bars`. It must keep pointing at {ref}, or "
            f"regenerating that fixture stops turning this case red."
        )
        assert case["barsFrom"] == ref
        # ⚠️ THIS LINE USED TO HARDCODE `app/src/pages/parityBars/intraday5m.json`
        # for EVERY row, which was true only while every row referenced that one
        # file. Phase C added a row that references another FIXTURE, so the
        # existence check now reads the row's own `ref` — strictly stronger: it
        # was checking one path twice and is now checking each row's referent.
        assert ROOT.joinpath(*ref.split("/")).exists(), f"{name}: {ref} does not exist"


def test_the_parity_fixture_is_intraday_bars_the_chart_can_actually_draw():
    """`t` must be NUMERIC unix seconds, and the timeframe must be one VWAP is
    gated to. `VWAP_TFS = {1,5,15,30,60}` in StockChart: on a daily fixture a
    VWAP parity case renders an empty chart on BOTH sides and reports 0 changed
    pixels forever, which is the gate-that-cannot-fail this fixture was created
    to retire. And `computeVWAP` does `new Date(bar.t * 1000)` — a
    'YYYY-MM-DD' string makes that NaN and the whole column disappears."""
    doc = json.loads(
        (ROOT / "app" / "src" / "pages" / "parityBars" / "intraday5m.json").read_text(encoding="utf-8"))
    assert doc["tf"] in {"1", "5", "15", "30", "60"}, "not an intraday timeframe VWAP is gated to"
    bars = doc["bars"]
    assert len(bars) > 400
    assert all(isinstance(b["t"], int) and not isinstance(b["t"], bool) for b in bars)
    assert all(b["t"] > bars[i]["t"] for i, b in enumerate(bars[1:]))
    assert all(b["v"] > 0 for b in bars), "a zero-volume bar leaves a VWAP gap"


def test_the_intraday_case_can_tell_UTC_DAY_from_ET_SESSION_bucketing():
    """The reason this fixture is extended hours and spans a DST change.

    Regular trading hours (09:30-16:00 ET) always sit inside ONE UTC day, so on
    an RTH fixture the two bucketings are IDENTICAL — B3 Task 8's VWAP gate
    would report the same number whether the UTC-day bug survived the migration
    or was silently corrected. This asserts the two disagree, in BOTH
    directions, on the exact bars the chart renders.
    """
    case = load_case("intraday5m_sessions")
    bars = case_bars(case)
    s = case["session"]
    n = len(bars)
    for key in ("etDate", "etHour", "utcDate", "etSessionVwap"):
        assert len(s[key]) == n, f"session.{key} not aligned to bars"

    utc_only = [i for i in s["utcResetIndices"] if i not in s["etResetIndices"]]
    et_only = [i for i in s["etResetIndices"] if i not in s["utcResetIndices"]]

    # Direction 1: UTC-day bucketing splits sessions ET bucketing leaves whole —
    # and every one of those splits is MID-SESSION (same ET day as the bar before).
    assert utc_only, "no UTC-only split: this case is not exercising the bug"
    for i in utc_only:
        assert s["etDate"][i] == s["etDate"][i - 1], f"bar {i} splits between ET days, not inside one"
    # Both sides of the DST change appear: EDT (UTC-4) trips at 20:00 ET, EST
    # (UTC-5) an hour earlier at 19:00 ET.
    assert {s["etHour"][i] for i in utc_only} == {19, 20}, (
        "the split hour does not MOVE — the DST half of spec §9.1 is missing"
    )

    # Direction 2 — the one the two hourly VWAP cases are too short to contain:
    # an ET session that opens INSIDE a UTC day and therefore never resets. Its
    # entire session accumulates on top of the previous evening's post-market
    # volume.
    assert et_only, (
        "no ET session opens inside a UTC day, so no session is carried over and this "
        "case is a longer copy of vwap_dst_transition"
    )
    for i in et_only:
        assert s["etHour"][i] == 4, "the carried-over session should open at 04:00 ET"

    # Non-vacuous, in dollars. `etSessionVwap` is what a correct session-aware
    # VWAP would draw; recompute today's UTC-day series here so the comparison
    # does not read one number out of the fixture and compare it to itself.
    utc_vwap, pv, vol, cur = [], 0.0, 0.0, None
    for b, k in zip(bars, s["utcDate"]):
        if k != cur:
            pv, vol, cur = 0.0, 0.0, k
        tp = (b["h"] + b["l"] + b["c"]) / 3.0
        pv += tp * b["v"]
        vol += b["v"]
        utc_vwap.append(pv / vol)
    for i in utc_only:
        assert abs(utc_vwap[i] - s["etSessionVwap"][i]) > 1.0, (
            f"bar {i} splits mid-session but the two bucketings agree to within $1"
        )
    carried = et_only[0]
    assert abs(utc_vwap[carried] - s["etSessionVwap"][carried]) > 5.0, (
        "the carried-over session opens at nearly the right VWAP, so the bug is invisible here"
    )
    # …and it stays wrong for a long stretch, not one bar.
    day = s["etDate"][carried]
    wrong = sum(1 for i in range(n)
                if s["etDate"][i] == day and abs(utc_vwap[i] - s["etSessionVwap"][i]) > 0.5)
    assert wrong > 100, f"only {wrong} bars of the carried-over session are materially wrong"


# ─── an oracle that is NOT either lane ───────────────────────────────────────
# The fixtures above were generated FROM this Python code, so on their own they
# only catch future Python drift — they cannot catch a mistake that was already
# in the math when they were generated. These are computed by hand, on paper.

def test_hand_computed_williams_r():
    # highs [10, 12, 11], lows [8, 10, 9], close at index 2 = 10
    # HH = 12, LL = 8, range = 4 → %R = -100 * (12 - 10) / 4 = -50
    bars = [
        {"h": 10, "l": 8, "c": 9},
        {"h": 12, "l": 10, "c": 11},
        {"h": 11, "l": 9, "c": 10},
    ]
    out = ic.compute_williams_r_raw(bars, 3)
    assert out[:2] == [None, None]
    assert out[2] == pytest.approx(-50.0, rel=1e-12)


def test_hand_computed_cci():
    # typical prices 10..14, SMA(5) = 12, MAD = (2+1+0+1+2)/5 = 1.2
    # CCI = (14 - 12) / (0.015 * 1.2) = 2 / 0.018 = 111.111...
    bars = [{"h": p, "l": p, "c": p} for p in (10, 11, 12, 13, 14)]
    out = ic.compute_cci_raw(bars, 5)
    assert out[4] == pytest.approx(2 / 0.018, rel=1e-12)


def test_hand_computed_mfi():
    # tp: 10, 12 (rising → PMF = 12 * 1000), 11 (falling → NMF = 11 * 500)
    # MFI = 100 - 100 / (1 + 12000/5500) = 68.571428...
    bars = [
        {"h": 11, "l": 9, "c": 10, "v": 1000},
        {"h": 13, "l": 11, "c": 12, "v": 1000},
        {"h": 12, "l": 10, "c": 11, "v": 500},
    ]
    out = ic.compute_mfi_raw(bars, 2)
    assert out[2] == pytest.approx(100 - 100 / (1 + 12000 / 5500), rel=1e-12)


def test_hand_computed_atr():
    # TR[1] = max(12-9, |12-9|, |9-9|)  = 3
    # TR[2] = max(13-11, |13-11|, |11-11|) = 2
    # period 2 → seed = (3 + 2) / 2 = 2.5, landing on bars[2].
    bars = [
        {"h": 10, "l": 8, "c": 9},
        {"h": 12, "l": 9, "c": 11},
        {"h": 13, "l": 11, "c": 12},
    ]
    out = ic.compute_atr_raw(bars, 2)
    assert out[:2] == [None, None]
    assert out[2] == pytest.approx(2.5, rel=1e-12)


def test_hand_computed_donchian():
    # highs [10, 12, 11] → upper 12; lows [8, 10, 9] → lower 8; middle = 10.
    bars = [
        {"h": 10, "l": 8, "c": 9},
        {"h": 12, "l": 10, "c": 11},
        {"h": 11, "l": 9, "c": 10},
    ]
    upper, middle, lower = ic.compute_donchian_raw(bars, 3)
    assert upper[:2] == [None, None]
    assert (upper[2], middle[2], lower[2]) == (12, 10, 8)


def test_hand_computed_obv_including_the_unchanged_close_branch():
    # closes 10 → 11 (up, +200) → 11 (unchanged, carry) → 9 (down, -400)
    bars = [
        {"c": 10, "v": 100}, {"c": 11, "v": 200},
        {"c": 11, "v": 300}, {"c": 9, "v": 400},
    ]
    assert ic.compute_obv_raw(bars) == [0.0, 200.0, 200.0, -200.0]


def test_hand_computed_adx_saturates_on_a_monotonic_uptrend():
    """Every bar a higher high AND a higher low ⇒ -DM is 0 on every bar, so -DI
    is exactly 0 and DX is exactly 100 whatever the true ranges are — which
    makes ADX exactly 100. Derivable on paper without smoothing arithmetic."""
    bars = [{"h": 10 + 2 * i, "l": 8 + 2 * i, "c": 9 + 2 * i} for i in range(40)]
    adx, plus_di, minus_di = ic.compute_adx_raw(bars, 14)
    assert minus_di[-1] == 0.0
    assert plus_di[-1] > 0.0
    assert adx[-1] == pytest.approx(100.0, rel=1e-12)
    # …and the first values land where Wilder puts them: DIs at bars[period],
    # ADX a further period-1 bars on, at bars[2*period - 1].
    assert plus_di[13] is None and plus_di[14] is not None
    assert adx[26] is None and adx[27] is not None


def test_hand_computed_ichimoku_including_the_back_shift():
    # tenkan 1 / kijun 2 / senkouB 3 over four bars, all mid-points by hand.
    bars = [
        {"h": 10, "l": 8, "c": 9},
        {"h": 12, "l": 9, "c": 11},
        {"h": 11, "l": 7, "c": 10},
        {"h": 13, "l": 11, "c": 12},
    ]
    tenkan, kijun, span_a, span_b, chikou = ic.compute_ichimoku_raw(bars, 1, 2, 3)
    # i = 2: tenkan (11+7)/2 = 9 · kijun over bars 1-2 → (12+7)/2 = 9.5
    #        spanA (9 + 9.5)/2 = 9.25 · spanB over bars 0-2 → (12+7)/2 = 9.5
    assert (tenkan[2], kijun[2], span_a[2], span_b[2]) == (9, 9.5, 9.25, 9.5)
    # i = 3: tenkan (13+11)/2 = 12 · kijun over bars 2-3 → (13+7)/2 = 10
    #        spanA (12 + 10)/2 = 11 · spanB over bars 1-3 → (13+7)/2 = 10
    assert (tenkan[3], kijun[3], span_a[3], span_b[3]) == (12, 10, 11, 10)
    # ⚠️ THE BACK-SHIFT: bar i's CLOSE lands at index i - kijun_period (2 here),
    # so the last two slots are pad — the trailing pad no other column has.
    assert chikou == [10, 12, None, None]


def test_hand_computed_sar_is_clamped_to_the_prior_lows():
    # c1 > c0 ⇒ uptrend. sar seeds at bars[0].l = 8, ep = bars[0].h = 10, af=.02.
    # i=1: 8 + .02*(10-8) = 8.04, clamped to min(8.04, prior low 8) = 8.
    # i=2: ep is now 12, af .04 → 8 + .04*(12-8) = 8.16, clamped to
    #      min(8.16, 9, 8) = 8. The clamp is what keeps SAR under the trend.
    bars = [
        {"h": 10, "l": 8, "c": 9},
        {"h": 12, "l": 9, "c": 11},
        {"h": 13, "l": 11, "c": 12},
    ]
    sar, trend = ic.compute_sar_raw(bars, 0.02, 0.2)
    assert sar == [None, 8.0, 8.0]
    assert trend == [None, 1.0, 1.0]


# ─── SAR's two EVENT columns (Phase C) ───────────────────────────────────────
# Events are columns valued {0, 1, None} (spec §3.1). SAR is the first indicator
# in the platform to declare any, and the reason is that it is the one indicator
# that CANNOT be addressed by a fixed threshold: its value jumps to the other
# side of price at every flip, so the same number means "trailing below an
# uptrend" one bar and "above a downtrend" the next.
#
# ⭐ THE COLUMNS COST NO RESEED. `compute_sar_raw` already returned a ±1 `trend`
# column and `sar_default.json` has pinned it in BOTH lanes since B5 — so these
# two are derived from numbers that already had an oracle, and the tests below
# recompute them from THAT fixture rather than from the new code.

SAR_EVENT_CASES = ["sar_events_default", "sar_events_outside_bar"]


@pytest.mark.parametrize("name", SAR_EVENT_CASES)
def test_event_columns_are_a_domain_of_zero_one_and_none(name):
    """{0.0, 1.0, None}, None ONLY at bar 0, and never constant.

    ⚠️ THE 1e-9 COMPARE ABOVE CANNOT MAKE THIS CLAIM. `_close` would be just as
    happy with 0.9999999999 as with 1.0, and just as happy with an all-zero
    column as with one that fires — a legal column that pins nothing. The domain
    and the non-constancy are separate assertions for that reason.

    ⚠️ None IS NOT "no event". It is the warmup pad: bar 0 has no SAR at all (the
    trend seed consumes it), so there is nothing to have crossed. `0.0` is
    "computed, did not happen" — including bar 1, which is computable and has no
    prior side or trend to have moved away from.
    """
    case = load_case(name)
    bars = case_bars(case)
    got = ic.compute_case("sar_events", bars, case["params"])
    assert set(got) == {"priceCrossedSar", "trendFlipped"}
    for col, series in got.items():
        assert len(series) == len(bars), f"{name}.{col} not aligned to bars"
        assert series[0] is None, f"{name}.{col}[0] must be the pad — bar 0 has no SAR"
        assert all(v is not None for v in series[1:]), f"{name}.{col} has a hole after bar 0"
        assert set(series[1:]) <= {0.0, 1.0}, (
            f"{name}.{col} left the {{0, 1, None}} domain: {sorted(set(series[1:]))}"
        )
        assert set(series[1:]) == {0.0, 1.0}, (
            f"{name}.{col} is constant — a column that never fires pins nothing"
        )
        assert case["expected"][col] == series, f"{name}.{col} fixture disagrees exactly"
        assert series[1] == 0.0, f"{name}.{col}[1] must be 0 — computable, with no prior"


def test_sar_events_are_DERIVED_from_sar_defaults_already_pinned_columns():
    """⭐ THE ORACLE THAT IS NEITHER LANE'S NEW CODE.

    `sar_events_default` owns no bars: it points at `sar_default.json`, whose
    `sar` and `trend` columns two lanes have asserted at rel-tol 1e-9 since B5.
    Both event columns are recomputed HERE from those pinned numbers —
    `trendFlipped` is `trend[i] != trend[i-1]`, `priceCrossedSar` is
    `(close > sar)` changing — and the fixture must equal them.

    Without this, the fixture would be a snapshot of `compute_sar_events`
    asserted by `compute_sar_events`. With it, it is a derivation from something
    older than either, and reseeding `sar_default` turns it red.
    """
    src = load_case("sar_default")
    case = load_case("sar_events_default")
    assert case["barsFrom"] == "tests/fixtures/indicators/sar_default.json"
    assert case["params"] == src["params"]
    bars = case_bars(case)
    pin_sar, pin_trend = src["expected"]["sar"], src["expected"]["trend"]

    def above(i):
        return None if pin_sar[i] is None else bars[i]["c"] > pin_sar[i]

    n = len(bars)
    d_crossed, d_flipped = [None] * n, [None] * n
    for i in range(1, n):
        if pin_trend[i] is not None:
            d_flipped[i] = 1.0 if (pin_trend[i - 1] is not None
                                   and pin_trend[i - 1] != pin_trend[i]) else 0.0
        if above(i) is not None:
            d_crossed[i] = 1.0 if (above(i - 1) is not None
                                   and above(i - 1) != above(i)) else 0.0

    assert case["expected"]["trendFlipped"] == d_flipped
    assert case["expected"]["priceCrossedSar"] == d_crossed
    # …and the derivation is non-trivial: the trend really does flip on these
    # bars, so the columns are not "all zeros" agreeing with "all zeros".
    assert d_flipped.count(1.0) > 1, "the trend never flips — the derivation pins nothing"


def test_the_two_event_columns_are_TWO_columns():
    """⚠️ MEASURED: on `sar_default`'s 140 real bars they are element-for-element
    EQUAL, and `sar_events_outside_bar` exists because of it.

    A side change without a trend change is only reachable around an OUTSIDE
    reversal bar: on reversal the new SAR is the prior leg's extreme point, which
    a bar making a new high can close beyond. `sar_default` contains no such bar,
    so on that case alone a lane that returned the SAME column twice — or
    returned the two the wrong way round — would be completely invisible.
    """
    default = load_case("sar_events_default")["expected"]
    assert default["priceCrossedSar"] == default["trendFlipped"], (
        "the two columns now differ on sar_default's bars — good news, but the note "
        "in both fixtures and this test's premise are stale; re-measure"
    )
    ob = load_case("sar_events_outside_bar")["expected"]
    assert ob["priceCrossedSar"] != ob["trendFlipped"], (
        "the outside-bar case no longer separates the two columns — the ONLY case "
        "that can tell priceCrossedSar from trendFlipped has gone vacuous"
    )
    # The two divergent bars, by index, so a series edit cannot quietly move them.
    assert (ob["trendFlipped"][5], ob["priceCrossedSar"][5]) == (1.0, 0.0)
    assert (ob["trendFlipped"][6], ob["priceCrossedSar"][6]) == (0.0, 1.0)


def test_hand_computed_sar_events_on_the_outside_bar():
    """The seven bars of `sar_events_outside_bar`, on paper.

    Uptrend seeds at bars[0].l = 98 with ep = bars[0].h = 100, af = 0.02, so the
    SAR climbs 98 / 98 / 98.36 / 98.9712 while the close stays above it.

    Bar 5 projects 98.9712 + 0.10*(108 - 98.9712) = 99.87408. Its LOW (95) is
    below that, so the trend flips DOWN and the SAR jumps to ep = 108 — but its
    CLOSE (112) is ABOVE 108, so the price did not change sides.
    Bar 6 is a downtrend bar, so the SAR is clamped UP to the prior high (113),
    and the close (107) is now below it: the side changes with no trend change.
    """
    bars = load_case("sar_events_outside_bar")["bars"]
    sar, trend = ic.compute_sar_raw(bars, 0.02, 0.2)
    assert sar == [None, 98.0, 98.0, 98.36, 98.9712, 108.0, 113.0]
    assert trend == [None, 1.0, 1.0, 1.0, 1.0, -1.0, -1.0]
    crossed, flipped = ic.compute_sar_events(bars, 0.02, 0.2)
    assert flipped == [None, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    assert crossed == [None, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]


def test_compute_sar_events_pads_a_series_too_short_to_have_a_sar():
    """A too-short series is all-None, never all-zero.

    `0.0` would be a lie: it says "computed, did not happen" about a bar where
    nothing was computed at all.
    """
    for n in (0, 1):
        bars = [{"t": i, "h": 1.0, "l": 1.0, "c": 1.0} for i in range(n)]
        crossed, flipped = ic.compute_sar_events(bars)
        assert crossed == [None] * n and flipped == [None] * n


def test_compute_sar_events_DERIVES_from_compute_sar_raw_and_does_not_re_implement_it():
    """⛔ A SOURCE PROBE, AND IT IS THE ONLY THING THAT CAN KILL THIS MUTATION.

    An exact re-implementation of the SAR loop inside `compute_sar_events` is an
    EQUIVALENT MUTANT against every value comparison in this file and in the
    vitest lane: the numbers would be identical. What would NOT be identical is
    the future — a second copy drifts the first time somebody edits one of them,
    and a twin is precisely what this programme exists to retire.

    So the claim is structural, and it is made through `ast` rather than a text
    search: a mention in a comment or in the docstring (which says
    ``compute_sar_raw`` in prose, twice) is a `Constant`, not a `Call`, so it
    cannot satisfy this. That is the "source probe defeated by a comment" trap,
    closed by construction instead of by a stripper.
    """
    import ast
    import inspect
    import textwrap

    tree = ast.parse(textwrap.dedent(inspect.getsource(ic.compute_sar_events)))
    called = {
        n.func.id for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
    }
    assert "compute_sar_raw" in called, (
        "compute_sar_events no longer CALLS compute_sar_raw — it is a second SAR "
        "implementation, and the two will disagree the day one of them is edited"
    )
    # The control for the probe: prose alone must not satisfy it. `compute_sar`
    # (the delivery wrapper) also calls `compute_sar_raw`; `compute_rsi_raw`
    # calls nothing of the sort, so the set really is a call set.
    rsi = ast.parse(textwrap.dedent(inspect.getsource(ic.compute_rsi_raw)))
    rsi_calls = {
        n.func.id for n in ast.walk(rsi)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
    }
    assert "compute_sar_raw" not in rsi_calls


def test_case_columns_names_the_two_events_in_the_order_compute_case_returns():
    """`_CASE_COLUMNS` is the ledgered (kind → columns) map, and it is READ.

    ⚠️ THE ORDER IS LOAD-BEARING HERE IN A WAY IT IS NOT ELSEWHERE. Both event
    columns are `{0, 1, None}`, so swapping them in the tuple — or swapping the
    two values `compute_sar_events` returns — moves no VALUE that a "did the
    number change?" test can see. `_generate.py` writes fixtures in
    `case_columns` order and this asserts the tuple against the names
    `compute_case` actually returns, so a swap in either place is a red test.
    """
    assert ic.case_columns("sar_events") == ("priceCrossedSar", "trendFlipped")
    case = load_case("sar_events_outside_bar")
    got = ic.compute_case("sar_events", case["bars"], case["params"])
    assert tuple(got) == ic.case_columns("sar_events")
    # And the two really are distinguishable on this case, so "the tuple is
    # right" is a claim with consequences.
    assert got["priceCrossedSar"] != got["trendFlipped"]


def test_hand_computed_vwap_is_volume_weighted_and_cumulative():
    # One ET session (14:00 and 15:00 ET on 2026-06-10, both inside one UTC day
    # so this case is about the ARITHMETIC, not the bucketing).
    # tp0 = (11+9+10)/3 = 10 · tp1 = (22+18+20)/3 = 20
    # bar 0: 10 · bar 1: (10*100 + 20*300) / 400 = 7000/400 = 17.5
    bars = [
        {"t": 1781028000, "h": 11, "l": 9, "c": 10, "v": 100},
        {"t": 1781031600, "h": 22, "l": 18, "c": 20, "v": 300},
    ]
    out = ic.compute_vwap_raw(bars)
    assert out[0] == pytest.approx(10.0, rel=1e-12)
    assert out[1] == pytest.approx(17.5, rel=1e-12)


def test_hand_computed_bb_middle_is_the_sma():
    # closes 100..119 → SMA = (100 + 119) / 2 = 109.5, and the population
    # std-dev of 0..19 is sqrt(mean((i - 9.5)^2)) = sqrt(33.25).
    closes = [100.0 + i for i in range(20)]
    upper, middle, lower = ic.compute_bb_raw(closes, 20, 2.0)
    assert middle[19] == pytest.approx(109.5, rel=1e-12)
    std = math.sqrt(33.25)
    assert upper[19] == pytest.approx(109.5 + 2 * std, rel=1e-12)
    assert lower[19] == pytest.approx(109.5 - 2 * std, rel=1e-12)


# ─── the precise-core / delivery-layer split ─────────────────────────────────

def test_raw_core_is_not_rounded():
    """If the raw core ever starts rounding, the 1e-9 fixtures become
    unachievable again — which is the whole reason the split exists."""
    closes = [100 + (i * 7 % 13) * 0.37 + i * 0.11 for i in range(80)]
    raw = ic.compute_rsi_raw(closes, 14)
    values = [v for v in raw if v is not None]
    assert values, "no RSI computed"
    assert any(abs(v - round(v, 2)) > 1e-9 for v in values), (
        "compute_rsi_raw looks rounded to 2dp — the precise core regressed"
    )


@pytest.mark.parametrize(
    "getter, ndigits",
    [
        (lambda c, b: ic.compute_rsi(c, 14), 2),
        (lambda c, b: ic.compute_macd(c)[0], 5),
        (lambda c, b: ic.compute_bb(c, 20, 2.0)[0], 4),
        (lambda c, b: ic.compute_williams_r(b, 14), 2),
        (lambda c, b: ic.compute_cci(b, 20), 2),
        (lambda c, b: ic.compute_mfi(b, 14), 2),
        (lambda c, b: ic.compute_stoch(b, 14, 3)[0], 2),
        # ── B5: the new wrappers are held to the same rule ──
        # ⚠️ NOT DECORATION. `indicator_alert_evaluator` reads these — a NEW
        # address that skipped the delivery layer would compare a user's
        # threshold against a different number from every other alert on the
        # same chart, and nothing else in the suite would notice.
        (lambda c, b: ic.compute_atr(b, 14), 4),
        (lambda c, b: ic.compute_adx(b, 14)[0], 2),
        (lambda c, b: ic.compute_adx(b, 14)[1], 2),
        (lambda c, b: ic.compute_adx(b, 14)[2], 2),
        # `compute_obv` is NOT in this grid: these bars carry whole-share
        # volumes, so OBV's values are whole numbers and `v == round(v, 2)`
        # holds whether or not the wrapper rounds at all. A row that passes
        # under its own mutation is worse than no row — it gets its own test
        # below, on a volume that can actually show the rounding.
        (lambda c, b: ic.compute_donchian(b, 20)[0], 4),
        (lambda c, b: ic.compute_donchian(b, 20)[1], 4),
        (lambda c, b: ic.compute_donchian(b, 20)[2], 4),
        (lambda c, b: ic.compute_ichimoku(b, 9, 26, 52)[0], 4),
        (lambda c, b: ic.compute_ichimoku(b, 9, 26, 52)[1], 4),
        (lambda c, b: ic.compute_ichimoku(b, 9, 26, 52)[2], 4),
        (lambda c, b: ic.compute_ichimoku(b, 9, 26, 52)[3], 4),
        (lambda c, b: ic.compute_ichimoku(b, 9, 26, 52)[4], 4),
        (lambda c, b: ic.compute_sar(b, 0.02, 0.2)[0], 4),
        (lambda c, b: ic.compute_vwap(b), 4),
    ],
)
def test_delivery_wrappers_still_round(getter, ndigits):
    """The public compute_* names round, and must keep rounding.

    Two LIVE consumers compare these numbers against user-set thresholds —
    ``indicator_alert_evaluator`` (armed alerts) and ``strategy_templates``
    (the backtester). Dropping the rounding shifts every value by up to half a
    unit in the last place, which flips a comparison at a boundary: an armed
    alert would start firing differently the day it shipped. Phase B1's ruling
    is round at DELIVERY, not in compute; this test is that ruling's gate.
    """
    closes = [100 + (i * 7 % 13) * 0.37 + i * 0.11 for i in range(80)]
    # ⚠️ `t` IS A REAL INSTANT AND THAT IS NOT COSMETIC. This grid used to build
    # bars with `t: 0, 1, 2 …`, a counter — which is the 1970 unit error, and the
    # `compute_vwap` row was therefore measuring the rounding of a column
    # anchored on 1970-01-01. `compute_vwap` now refuses a `t` that is not an
    # instant (`VWAP_MIN_INSTANT`), so the row reddened with "nothing computed"
    # and named its own fixture. 5-minute bars from 2026-08-02 09:00 UTC; every
    # other row here ignores `t` entirely.
    bars = [{"t": 1785410100 + i * 300, "o": c, "h": c + 0.9, "l": c - 0.8,
             "c": c, "v": 1000 + i * 37}
            for i, c in enumerate(closes)]
    series = getter(closes, bars)
    values = [v for v in series if v is not None]
    assert values, "nothing computed"
    assert all(v == round(v, ndigits) for v in values)


def test_obv_delivery_wrapper_rounds_on_a_volume_that_can_show_it():
    """OBV's rounding, made observable.

    Whole-share volumes make `round(v, 2)` an identity, so the parametrized grid
    above deliberately excludes OBV. A fractional volume is the only input where
    "does the delivery wrapper round?" has a visible answer — and the raw core
    must NOT round, or the 1e-9 fixtures become unreachable for it.
    """
    bars = [
        {"c": 10, "v": 100.0},
        {"c": 11, "v": 200.123456},
        {"c": 9, "v": 50.987654},
    ]
    raw = ic.compute_obv_raw(bars)
    delivered = ic.compute_obv(bars)
    assert raw[1] == pytest.approx(200.123456, rel=1e-12)
    assert delivered[1] == 200.12
    # The raw core is genuinely unrounded — otherwise this pair proves nothing.
    assert raw[1] != delivered[1]


def test_compute_case_rejects_an_unknown_kind():
    with pytest.raises(KeyError):
        ic.compute_case("not_an_indicator", [{"c": 1.0, "h": 1.0, "l": 1.0}], {})


def test_compute_case_columns_are_input_length_even_when_uncomputable():
    """Too-short input still returns aligned all-None columns on this lane."""
    bars = [{"t": i, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1} for i in range(3)]
    got = ic.compute_case("rsi", bars, {"period": 14})
    assert got["rsi"] == [None, None, None]


# ═════════════════════════════════════════════════════════════════════════════
# PHASE C TASK 14 — Anchored VWAP · ATR bands · the RS line
# ═════════════════════════════════════════════════════════════════════════════
#
# The two new fixture cases ride the parametrised sweep like every other case.
# What follows is what that sweep CANNOT say: that the anchor is the ET calendar
# and not a 1970 artefact of the wrong unit, that the bands are derived from a
# column older than their own code, and that the RS line's second series is real.


def test_avwap_session_anchor_IS_the_ET_session_the_referent_already_pinned():
    """⭐ THE ORACLE THAT IS NOT THIS CODE.

    `avwap_session` owns no bars: it points at
    `vwap_extended_hours_utc_midnight.json`, whose `session.etSessionVwap` was
    written BEFORE this lane had a VWAP at all and has never been reseeded. So
    AVWAP's `session` anchor is required to equal that series exactly — a fixture
    generated from `compute_avwap_raw` and asserted only by `compute_avwap_raw`
    would be a snapshot of one afternoon's work.
    """
    case = load_case("avwap_session")
    src = load_case("vwap_extended_hours_utc_midnight")
    assert case["barsFrom"] == "tests/fixtures/indicators/vwap_extended_hours_utc_midnight.json"
    exp = case["expected"]["avwap"]
    ref = src["session"]["etSessionVwap"]
    assert len(exp) == len(ref)
    for i, (a, b) in enumerate(zip(exp, ref)):
        assert _close(a, b, case["relTol"]), f"avwap_session[{i}]: {a!r} != etSessionVwap {b!r}"


def test_avwap_session_anchor_is_NOT_the_utc_day():
    """Non-vacuity for the case above, in the referent's own vocabulary.

    These 17 bars are ONE ET session that the retired UTC-day bucketing splits in
    two at the 20:00 ET bar. A lane that anchored on the UTC day would collapse
    the accumulator to that bar's typical price; the fixture's column does not.
    """
    case = load_case("avwap_session")
    src = load_case("vwap_extended_hours_utc_midnight")
    s = src["session"]
    got = case["expected"]["avwap"]
    assert s["etResetIndices"] == [0], "the referent stopped being one ET session"
    assert len(s["utcResetIndices"]) == 2
    split = s["utcResetIndices"][1]
    assert s["etHour"][split] == 20
    b = src["bars"][split]
    tp = (b["h"] + b["l"] + b["c"]) / 3
    assert abs(got[split] - tp) > 1.0, (
        "the 20:00 ET bar collapsed to its own typical price — this column is UTC-anchored"
    )


def test_avwap_REFUSES_a_date_shaped_t_instead_of_anchoring_in_1970():
    """🔴 THE UNIT CONTROL, AND IT FAILS IF THE UNIT IS WRONG.

    `_fetch_bars_for_alert` hands `compute_vwap` the store's `YYYYMMDD` integer
    where real unix seconds are expected. That is not a hypothetical: 20250101
    read as unix seconds is **1970-08-23**, and two years of daily bars span
    11,130 seconds — one bucket, one reset at index 0, no exception, a plausible
    line. AVWAP must not reproduce it.

    ⛔ THE REFUSAL IS AN ALL-None COLUMN, NOT A ONE-BUCKET ANSWER, and this test
    is why: a one-bucket fallback and the 1970 defect are the SAME OUTPUT, so a
    control could not tell them apart.
    """
    from datetime import timezone

    # The defect itself, measured rather than asserted from memory.
    assert datetime.fromtimestamp(20250101, timezone.utc).strftime("%Y-%m-%d") == "1970-08-23"
    assert datetime.fromtimestamp(20251231, timezone.utc).strftime("%Y-%m-%d") == "1970-08-23"

    zone = ic._et_zone()

    def bar(t, c):
        return {"t": t, "o": c, "h": c + 1.0, "l": c - 1.0, "c": c, "v": 1000.0}

    # CONTROL A — REAL unix seconds, one bar a day from 2025-01-02, 400 of them.
    t0 = int(datetime(2025, 1, 2, 12, 0, tzinfo=zone).timestamp())
    real = [bar(t0 + i * 86400, 100.0 + i * 0.25) for i in range(400)]
    dates = [datetime.fromtimestamp(b["t"], zone) for b in real]
    a = ic.compute_avwap_raw(real, "year")
    assert all(v is not None for v in a), "the control produced no AVWAP at all"
    years = sorted({d.year for d in dates})
    assert len(years) >= 2, "the control never crosses a year boundary"
    resets = [i for i in range(1, len(real))
              if abs(a[i] - (real[i]["h"] + real[i]["l"] + real[i]["c"]) / 3) < 1e-9]
    assert len(resets) == len(years) - 1, (resets, years)

    # CONTROL B — the SAME calendar days, encoded YYYYMMDD. The unit is wrong, so
    # there is no answer: not one bucket, not 1970, nothing.
    wrong = [bar(int(d.strftime("%Y%m%d")), b["c"]) for d, b in zip(dates, real)]
    assert wrong[0]["t"] == 20250102
    for anchor in ("session", "week", "month", "quarter", "year"):
        assert ic.compute_avwap_raw(wrong, anchor) == [None] * len(wrong), anchor

    # …and the two swing anchors are PURE PRICE, so they are untouched by the
    # guard. A guard that fired on them would refuse a column it cannot doubt.
    for anchor in ("swingHigh", "swingLow"):
        assert all(v is not None for v in ic.compute_avwap_raw(wrong, anchor)), anchor


def test_avwap_calendar_anchors_are_FIVE_different_ET_boundaries():
    """Each named calendar anchor re-anchors at its own ET boundary — no two of
    the distinct ones are the same column on a series that crosses all of them.

    Hourly bars from Fri 2025-12-26 12:00 ET across eleven ET calendar days, so
    the window crosses a session, TWO Mondays (2025-12-29 and 2026-01-05), a
    month, a quarter and a year. The second Monday is what stops `week` passing
    by coinciding with `year`.
    """
    zone = ic._et_zone()
    t0 = int(datetime(2025, 12, 26, 12, 0, tzinfo=zone).timestamp())
    bars = [
        {"t": t0 + i * 3600, "o": 100.0, "h": 100.0 + (i % 7), "l": 99.0,
         "c": 100.0 + (i % 5) * 0.5, "v": 1000.0 + i}
        for i in range(24 * 11)
    ]

    def tp(b):
        return (b["h"] + b["l"] + b["c"]) / 3

    def reset_indices(anchor):
        col = ic.compute_avwap_raw(bars, anchor)
        assert all(v is not None for v in col), anchor
        return [i for i, b in enumerate(bars) if abs(col[i] - tp(b)) < 1e-9]

    # ⭐ THE EXPECTATION IS DERIVED FROM `datetime` DIRECTLY, not hand-counted and
    # not read back out of `_et_anchor_key`. `isocalendar()` is an INDEPENDENT
    # Monday-anchored week — the code under test does its own civil arithmetic —
    # so agreeing with it is a real second opinion rather than a tautology.
    ets = [datetime.fromtimestamp(b["t"], zone) for b in bars]
    keyers = {
        "session": lambda d: (d.year, d.month, d.day),
        "week": lambda d: d.isocalendar()[:2],
        "month": lambda d: (d.year, d.month),
        "quarter": lambda d: (d.year, (d.month - 1) // 3),
        "year": lambda d: (d.year,),
    }
    for anchor, key in keyers.items():
        want = [0] + [i for i in range(1, len(ets)) if key(ets[i]) != key(ets[i - 1])]
        assert reset_indices(anchor) == want, anchor

    # The window really does cross every boundary — otherwise the five loops
    # above all measured the same thing.
    counts = {a: len(reset_indices(a)) for a in keyers}
    assert counts["session"] > counts["week"] > counts["year"] >= 2, counts
    assert counts["week"] >= 3, "only one Monday — `week` could pass by coinciding with `year`"
    assert reset_indices("month") == reset_indices("quarter") == reset_indices("year")
    cols = {a: ic.compute_avwap_raw(bars, a) for a in ("session", "week", "year")}
    for x, y in (("session", "week"), ("week", "year"), ("session", "year")):
        assert cols[x] != cols[y], f"{x} and {y} are the same column"


def test_avwap_session_anchor_SURVIVES_THE_DST_CHANGE():
    """⚠️ THE ZONE IS RESOLVED PER INSTANT, NOT FROM A MODULE-LOAD OFFSET.

    A fixed `_ET_OFFSET` captured at import is correct for half the year and
    silently an hour wrong for the other half depending on when the process
    started — the defect class `VWAP_SESSION_ANCHOR` retired, and the reason
    `StockChart.jsx:517`'s constant must never become the anchor's source.

    `vwap_dst_transition` is the fixture written for exactly this: two ET
    sessions of identical wall-clock shape either side of the change, whose
    `session.etSessionVwap` predates every line of AVWAP. The session anchor has
    to reproduce it on BOTH sides.
    """
    src = load_case("vwap_dst_transition")
    bars = src["bars"]
    s = src["session"]
    got = ic.compute_avwap_raw(bars, "session")
    assert len(set(s["etDate"])) == 2, "the fixture stopped spanning two sessions"
    for i, (g, e) in enumerate(zip(got, s["etSessionVwap"])):
        assert _close(g, e, src["relTol"]), f"vwap_dst_transition[{i}]: {g!r} != {e!r}"
    # Non-vacuous: the retired UTC-day bucketing split each session at a
    # DIFFERENT ET hour (20:00 on EDT, 19:00 on EST) — the boundary tracked the
    # offset rather than the trading day. Those two mid-session wipes do not
    # happen here.
    mid = [i for i in s["utcResetIndices"] if i not in s["etResetIndices"]]
    assert len(mid) == 2, mid
    for i in mid:
        tp_i = (bars[i]["h"] + bars[i]["l"] + bars[i]["c"]) / 3
        assert abs(got[i] - tp_i) > 1.0, f"bar {i} collapsed — the anchor moved with the offset"


def test_avwap_fails_closed_on_an_anchor_the_maths_does_not_know():
    """`params_json` on a stored alert row is user-supplied and unvalidated, so
    an anchor outside the vocabulary is a live input, not a hypothetical. It
    draws NOTHING rather than silently falling back to `session`."""
    bars = [{"t": 1780272000 + i * 3600, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10.0}
            for i in range(5)]
    assert ic.compute_avwap_raw(bars, "anchor:1780272000") == [None] * 5
    assert ic.compute_avwap_raw(bars, "") == [None] * 5
    assert ic.AVWAP_ANCHORS == (
        "session", "week", "month", "quarter", "year", "swingHigh", "swingLow",
    )


def test_the_avwap_anchor_vocabulary_is_ONE_list_across_BOTH_LANES():
    """A second copy of an enum is how an option a user can pick becomes an
    anchor the maths does not know. `indicators.js` exports `AVWAP_ANCHORS` and
    the definition's `enum` options are built FROM it; this asserts the Python
    lane names the same seven, in the same order."""
    src = (ROOT / "app" / "src" / "components" / "chart" / "indicators.js").read_text(encoding="utf-8")
    marker = "export const AVWAP_ANCHORS = Object.freeze(["
    start = src.index(marker) + len(marker)
    body = src[start:src.index("])", start)]
    js = [chunk.strip().strip("'\"") for chunk in body.split(",") if chunk.strip()]
    assert js == list(ic.AVWAP_ANCHORS), (js, ic.AVWAP_ANCHORS)


def test_atr_bands_are_DERIVED_from_atr_14s_already_pinned_column():
    """⭐ THE ORACLE IS OLDER THAN EITHER IMPLEMENTATION, exactly as it is for
    SAR's two event columns. `atr_bands_14_2` owns no bars — it points at
    `atr_14.json`, whose `atr` column both lanes have asserted at 1e-9 since B5 —
    so every number in it is `close ± 2 × <that pinned column>` and a reseed of
    `atr_14` turns this case red."""
    case = load_case("atr_bands_14_2")
    src = load_case("atr_14")
    assert case["barsFrom"] == "tests/fixtures/indicators/atr_14.json"
    assert src["params"]["period"] == case["params"]["period"] == 14
    mult = case["params"]["multiplier"]
    bars = case_bars(case)
    pinned = src["expected"]["atr"]

    for i, a in enumerate(pinned):
        if a is None:
            for col in ("upper", "middle", "lower"):
                assert case["expected"][col][i] is None, f"{col}[{i}] outlived the ATR pad"
            continue
        c = bars[i]["c"]
        assert _close(case["expected"]["middle"][i], c, case["relTol"]), i
        assert _close(case["expected"]["upper"][i], c + mult * a, case["relTol"]), i
        assert _close(case["expected"]["lower"][i], c - mult * a, case["relTol"]), i

    # The three columns share ONE pad, and it is the head only. A middle that
    # existed where the edges did not would be a band with nothing to draw
    # between — the unrenderable shape `validateBandEdges` refuses one level up.
    first = next(i for i, v in enumerate(case["expected"]["middle"]) if v is not None)
    assert first == 14, first
    for col in ("upper", "middle", "lower"):
        vals = case["expected"][col]
        assert all(v is None for v in vals[:first]) and all(v is not None for v in vals[first:])


def test_atr_bands_READ_the_multiplier_input():
    """🔴 THE MUTATION THIS EXISTS FOR: `multiplier` written as a literal.

    `$<inputKey>` substitution is legal in `color`, `width`, `levels` and
    `lineStyle` only, and a band's WIDTH IN PRICE is none of those — so the
    multiplier has to be an input the COMPUTE reads. A hardcoded 2.0 would keep
    `atr_bands_14_2` (multiplier 2) perfectly green while every user who moved
    the control got the same band, which is why the fixture alone cannot make
    this claim.
    """
    case = load_case("atr_bands_14_2")
    bars = case_bars(case)
    base = case["expected"]
    for mult in (1.0, 2.5, 3.0):
        upper, middle, lower = ic.compute_atr_bands_raw(bars, 14, mult)
        assert middle == base["middle"], "the middle moved with the multiplier"
        moved = [i for i in range(14, len(bars)) if abs(upper[i] - base["upper"][i]) > 1e-9]
        assert len(moved) == len(bars) - 14, (mult, len(moved))
        for i in range(14, len(bars)):
            assert abs((upper[i] - middle[i]) - (middle[i] - lower[i])) < 1e-9


def test_rs_line_matches_the_golden_column_and_JOINS_BY_TIME():
    """The RS line's fixture, read by the same rules as every other case — plus
    the one claim only a two-series indicator can make.

    Bar 6's `t` is ABSENT from `benchmarkBars`. Under an index join every ratio
    from bar 6 on would shift by one and the line would be plausible and wrong
    for the whole history; under a time join bar 6 is the only null and bars
    7-11 are unmoved.
    """
    case = load_case("rs_line_spy")
    bars, bench = case["bars"], case["benchmarkBars"]
    got = ic.compute_rs_line_raw(bars, bench)
    exp = case["expected"]["rsLine"]
    assert len(got) == len(bars) == len(exp)
    for i, (g, e) in enumerate(zip(got, exp)):
        assert _close(g, e, case["relTol"]), f"rs_line_spy.rsLine[{i}]: {g!r} != {e!r}"

    holes = [i for i, v in enumerate(exp) if v is None]
    assert len(holes) == 1 and holes[0] > 0, holes
    gap = holes[0]
    assert {b["t"] for b in bench}.isdisjoint({bars[gap]["t"]})
    by_t = {b["t"]: b["c"] for b in bench}
    for i in range(gap + 1, len(bars)):
        assert _close(got[i], bars[i]["c"] / by_t[bars[i]["t"]], case["relTol"]), i


def test_a_single_symbol_rs_line_is_ONE_POINT_ZERO_and_that_is_the_failure_mode():
    """🔴 THE MUTATION THIS EXISTS FOR: RS line implemented as a native reading
    only `bars`.

    A native's compute contract (spec §4) carries ONE series, so a native RS line
    could only divide the chart's closes by themselves — a flat line at 1.0 that
    looks exactly like an indicator that is working. This names the number.
    """
    case = load_case("rs_line_spy")
    bars = case["bars"]
    assert ic.compute_rs_line_raw(bars, bars) == [1.0] * len(bars)
    real = [v for v in case["expected"]["rsLine"] if v is not None]
    assert len({round(v, 12) for v in real}) > 1, "the fixture's RS line is constant"
    assert all(abs(v - 1.0) > 1e-6 for v in real)


def test_compute_case_has_NO_rs_line_row_because_it_carries_ONE_bars():
    """⛔ THE STRUCTURAL HALF OF THE SAME CLAIM.

    `compute_case(kind, bars, params)` carries one series and spec §4's
    `compute({bars, inputs, prevState, barstate})` carries one too. The RS line
    needs two, which is exactly why decision A3 makes its definition
    `compute.kind: 'server'`. A row here would have to smuggle the benchmark
    through `params`, and the dispatch would be lying about its own shape at one
    row — so there is no row, and this is the assertion that keeps it that way.
    """
    assert ic.case_columns("rs_line") == ()
    with pytest.raises(KeyError):
        ic.compute_case("rs_line", load_case("rs_line_spy")["bars"], {"benchmark": "SPY"})
    assert ic.case_columns("avwap") == ("avwap",)
    assert ic.case_columns("atr_bands") == ("upper", "middle", "lower")


@pytest.mark.parametrize(
    "getter, ndigits",
    [
        (lambda b: ic.compute_avwap(b, "session"), 4),
        (lambda b: ic.compute_atr_bands(b, 14, 2.0)[0], 4),
        (lambda b: ic.compute_atr_bands(b, 14, 2.0)[1], 4),
        (lambda b: ic.compute_atr_bands(b, 14, 2.0)[2], 4),
    ],
)
def test_task_14_delivery_wrappers_still_round(getter, ndigits):
    """Decision A4: the wrappers are NOT retired, so every new address rounds at
    the same delivery boundary every existing one does. A new address that
    skipped it would compare a user's threshold against a different number from
    every other alert on the same chart."""
    # ⚠️ SIX-DECIMAL INPUTS, DELIBERATELY. `compute_atr_bands`' middle column IS
    # the close, so on a 3dp price the wrapper's 4dp rounding is a no-op and the
    # non-vacuity check below would pass whether the wrapper rounded or not —
    # exactly the shape `compute_obv` was pulled out of the older grid for.
    bars = [
        {"t": 1780272000 + i * 3600,
         "o": 100.0 + i * 0.1371234, "h": 100.9174231 + i * 0.1371234,
         "l": 99.1132917 + i * 0.1371234, "c": 100.3716528 + i * 0.1371234,
         "v": 1000.0 + i}
        for i in range(60)
    ]
    delivered = [v for v in getter(bars) if v is not None]
    assert delivered, "nothing delivered — this row proves nothing"
    assert all(v == round(v, ndigits) for v in delivered)
    assert any(abs(v - round(v, ndigits - 1)) > 1e-12 for v in delivered)


def test_the_rs_line_wrapper_rounds_at_SIX_because_it_delivers_a_RATIO():
    """⚠️ SIX, NOT FOUR, AND THE DIFFERENCE IS LOAD-BEARING.

    Every other price-scale wrapper rounds to 4 because it delivers a PRICE. The
    RS line delivers a ratio — about 0.10 for the fixture's pair — so 4dp
    quantises a real RS move into nothing. The wrappers are the boundary user
    thresholds are compared at (decision A4), which is precisely why the
    precision has to suit the scale of the number rather than the habit of the
    module.
    """
    case = load_case("rs_line_spy")
    bars, bench = case["bars"], case["benchmarkBars"]
    raw = ic.compute_rs_line_raw(bars, bench)
    delivered = ic.compute_rs_line(bars, bench)
    assert [v is None for v in raw] == [v is None for v in delivered]
    vals = [v for v in delivered if v is not None]
    assert all(v == round(v, 6) for v in vals)
    assert any(r != d for r, d in zip(raw, delivered) if r is not None)

    # …and 4dp really would have cost something, MEASURED rather than asserted:
    # a 1e-4 quantum on a ratio near 0.10 is ~1e-3 of the value, while the same
    # 1e-4 on a price near 100 — which is what every other wrapper delivers — is
    # ~1e-6 of it. Three orders of magnitude, which is the whole argument.
    assert any(round(v, 4) != v for v in vals), "4dp is lossless here — the row proves nothing"
    worst_ratio_quantum = 1e-4 / min(abs(v) for v in vals)
    price_quantum = 1e-4 / 100.0
    assert worst_ratio_quantum > 100 * price_quantum, worst_ratio_quantum
