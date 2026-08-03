"""Golden-fixture tests — the Python half of the shared indicator oracle.

The same JSON files in ``tests/fixtures/indicators/`` are read by
``app/src/components/chart/goldenFixtures.test.js``. Contract, alignment rule
and the ban on regenerating fixtures: ``tests/fixtures/indicators/_schema.md``.
"""

import json
import math
import pathlib

import pytest

from api.services import indicator_compute as ic

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIX = pathlib.Path(__file__).parent / "fixtures" / "indicators"

# The 7 indicators that exist in BOTH lanes. (vwap/atr/sar/ichimoku/obv/
# donchian/adx are JS-only today; sma/ema exist here but have no fixture case.)
CASES = [
    "rsi_ramp_14",
    "macd_default",
    "bb_20_2",
    "stoch_14_3",
    "williams_r_14",
    "cci_20",
    "mfi_14",
    # Owns no bars: `barsFrom` points at the CHART PARITY GATE's intraday fixture,
    # so this lane's 1e-9 compare runs on the exact series the chart draws.
    "intraday5m_sessions",
]

VWAP_CASES = ["vwap_extended_hours_utc_midnight", "vwap_dst_transition"]

# Cases whose bars live in another file. The indirection is the point — see
# `_generate.py::_write_referenced` — so it gets its own list rather than being
# inferred, and `test_a_referenced_case_really_is_referenced` guards it.
REFERENCED_CASES = {"intraday5m_sessions": "app/src/pages/parityBars/intraday5m.json"}


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
    """
    case = load_case(name)
    for col, exp in case["expected"].items():
        first = next((i for i, v in enumerate(exp) if v is not None), None)
        assert first is not None, f"{name}.{col} is entirely null"
        assert all(v is None for v in exp[:first]), f"{name}.{col} pad is not contiguous"
        assert all(v is not None for v in exp[first:]), f"{name}.{col} has a hole after {first}"


def test_every_fixture_file_is_covered_by_a_test():
    """A fixture nobody reads is a fixture nobody maintains."""
    on_disk = {p.stem for p in FIX.glob("*.json")}
    assert on_disk == set(CASES) | set(VWAP_CASES), (
        f"fixture files and the CASES lists disagree: {on_disk ^ (set(CASES) | set(VWAP_CASES))}"
    )


@pytest.mark.parametrize("name", VWAP_CASES)
def test_vwap_session_fixtures_carry_a_real_trap(name):
    """Python has no VWAP, so this lane only guards the fixture's shape — that
    UTC-day bucketing really does split these sessions more often than ET-day
    bucketing would. The behavioural assertions live in the vitest lane."""
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
        assert (ROOT / "app" / "src" / "pages" / "parityBars" / "intraday5m.json").exists()


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
    bars = [{"t": i, "o": c, "h": c + 0.9, "l": c - 0.8, "c": c, "v": 1000 + i * 37}
            for i, c in enumerate(closes)]
    series = getter(closes, bars)
    values = [v for v in series if v is not None]
    assert values, "nothing computed"
    assert all(v == round(v, ndigits) for v in values)


def test_compute_case_rejects_an_unknown_kind():
    with pytest.raises(KeyError):
        ic.compute_case("not_an_indicator", [{"c": 1.0, "h": 1.0, "l": 1.0}], {})


def test_compute_case_columns_are_input_length_even_when_uncomputable():
    """Too-short input still returns aligned all-None columns on this lane."""
    bars = [{"t": i, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1} for i in range(3)]
    got = ic.compute_case("rsi", bars, {"period": 14})
    assert got["rsi"] == [None, None, None]
