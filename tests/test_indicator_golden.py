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
    # Own no bars: `barsFrom` points at the CHART PARITY GATE's intraday fixture,
    # so this lane's 1e-9 compare runs on the exact series the chart draws.
    "vwap_session_expected",
    "intraday5m_sessions",
]

VWAP_CASES = ["vwap_extended_hours_utc_midnight", "vwap_dst_transition"]

# Cases whose bars live in another file. The indirection is the point — see
# `_generate.py::_write_referenced` — so it gets its own list rather than being
# inferred, and `test_a_referenced_case_really_is_referenced` guards it.
REFERENCED_CASES = {
    "intraday5m_sessions": "app/src/pages/parityBars/intraday5m.json",
    "vwap_session_expected": "app/src/pages/parityBars/intraday5m.json",
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
    assert on_disk == set(CASES) | set(VWAP_CASES), (
        f"fixture files and the CASES lists disagree: {on_disk ^ (set(CASES) | set(VWAP_CASES))}"
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
