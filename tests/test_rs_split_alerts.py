"""RS split, lane S2 (2026-11-10): the four split alert addresses
(`rs_phases.flipBlue` / `.flipRed`, `rs_vs_ema.crossUp` / `.crossDown`) and the
WITHHELD Mansfield three.

Every expected column is hand-derived on a constructed series or taken from
`relative_strength` itself; nothing here re-types a formula. The benchmark is an
injected fetcher, no server, no store (the `test_rs_alert_series.py` idiom).
"""
from __future__ import annotations

import datetime as _dt

import pytest

from api.services import alert_rev_migration as rev
from api.services import alert_rs_series as ars
from api.services import alert_series
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import relative_strength as rsm
from api.services.signature import registry_defs as rd

PHASES = ("rs_phases.flipBlue", "rs_phases.flipRed")
VS_EMA = ("rs_vs_ema.crossUp", "rs_vs_ema.crossDown")
SPLIT = PHASES + VS_EMA
MANSFIELD = ("rs_line.mansfield", "rs_line.mansfieldCrossUp", "rs_line.mansfieldCrossDown")


@pytest.fixture(autouse=True)
def _flags_lit(monkeypatch):
    import api.main  # noqa: F401 -- before RS_SPLIT_ENABLED is lit: api.main registers the split providers
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    monkeypatch.setattr(rd, "RS_SPLIT_ENABLED", True)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")


def _weekdays(n, start=_dt.date(2022, 1, 3)):
    out, day = [], start
    while len(out) < n:
        if day.weekday() < 5:
            out.append(int(day.strftime("%Y%m%d")))
        day += _dt.timedelta(days=1)
    return out


def _bars(closes):
    times = _weekdays(len(closes))
    return [{"t": t, "o": c, "h": c + 1.0, "l": c - 1.0, "c": float(c), "v": 1000}
            for t, c in zip(times, closes)]


class _Store:
    def __init__(self, bench):
        self.bench = bench
        self.calls = []

    def __call__(self, ticker, tf, want):
        self.calls.append((ticker, tf, want))
        return list(self.bench[-int(want):]) if int(want) < len(self.bench) else list(self.bench)


def _run(address, stock, bench, params=None, tf="D"):
    fn = alert_series.SERIES_FUNCS[address]
    with ars.rs_pass(fetch_bars=_Store(bench)):
        return fn(stock, params or {}, tf=tf, sym="TEST")


def _ones(col):
    return [i for i, v in enumerate(col) if v == 1.0]


# --- the flip maths, hand-derived on explicit columns ------------------------

def test_phase_flips_are_edges_of_the_phase_column_and_none_where_unjudged():
    # index:     0     1     2    3    4     5     6    7
    phase = [None, None, 1.0, 1.0, None, 0.0, 1.0, 0.0]
    rs_t = [None, 0.1, 0.1, 0.1, 0.0, -0.1, 0.1, -0.1]
    b_t = [None, -0.1, -0.1, -0.1, 0.0, 0.1, -0.1, 0.1]
    out = rsm.rs_phase_flip_columns({"phase": phase, "rsTrend": rs_t, "benchTrend": b_t})
    # bar 0: no previous bar. Bar 1: previous bar unjudged (warm-up) -> None, never a flip out of nothing.
    assert out["flipBlue"] == [None, None, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    # red: bar 5 neutral -> red is a flip; bar 6 red -> blue is not; bar 7 blue -> red flips
    assert out["flipRed"] == [None, None, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0]


def test_flips_never_double_count_a_held_phase():
    n = 6
    out = rsm.rs_phase_flip_columns({"phase": [1.0] * n, "rsTrend": [0.1] * n, "benchTrend": [-0.1] * n})
    assert out["flipBlue"] == [None, 0.0, 0.0, 0.0, 0.0, 0.0]
    assert out["flipRed"] == [None, 0.0, 0.0, 0.0, 0.0, 0.0]


# --- through the lane: constructed price paths --------------------------------

def test_flip_blue_fires_once_when_the_market_turns_down_while_rs_keeps_rising():
    n = 120
    stock = _bars([100.0 * (1.005 ** i) for i in range(n)])               # rises every bar
    bench_closes, c = [], 200.0
    for i in range(n):
        c *= 1.001 if (i < 40 or i >= 80) else 0.99                      # the market falls on bars 40..79 only
        bench_closes.append(c)
    bench = _bars(bench_closes)
    blue = _run("rs_phases.flipBlue", stock, bench)
    red = _run("rs_phases.flipRed", stock, bench)
    cols = rsm.compute_rs_phases_columns(stock, bench)
    assert blue == rsm.rs_phase_flip_columns(cols)["flipBlue"], "the alert column IS the chart's phase edge"
    assert len(blue) == n and blue[0] is None
    assert len(_ones(blue)) == 1 and 40 <= _ones(blue)[0] < 80, "one turn-blue edge, inside the falling window"
    assert _ones(red) == [], "RS never falls, so the phase is never red"


def test_flip_red_fires_when_rs_starts_falling_while_the_market_rises():
    n = 140
    closes, c = [], 100.0
    for i in range(n):
        c *= 0.99 if 50 <= i < 90 else 1.01                              # the stock falls on bars 50..89 only
        closes.append(c)
    stock = _bars(closes)
    bench = _bars([100.0 * (1.003 ** i) for i in range(n)])               # the market rises every bar
    red = _run("rs_phases.flipRed", stock, bench)
    blue = _run("rs_phases.flipBlue", stock, bench)
    assert red == rsm.rs_phase_flip_columns(rsm.compute_rs_phases_columns(stock, bench))["flipRed"]
    assert len(_ones(red)) == 1 and 50 <= _ones(red)[0] < 90, "one turn-red edge, inside the falling window"
    assert _ones(blue) == [], "the market never falls, so the phase is never blue"


def test_vs_ema_cross_up_and_down_on_a_step_path():
    # Flat stock over a flat benchmark: dist is 0 (counts as "above", the Mansfield zero-cross
    # convention). Drop to 90 on bar 30 -> R falls under its 21 EMA -> crossDown on bar 30.
    # Stay at 90: the EMA (still ~90.6 on bar 59) stays above R. Back to 100 on bar 60 -> R
    # jumps over the EMA -> crossUp on bar 60. Nothing else crosses.
    closes = [100.0] * 30 + [90.0] * 30 + [100.0] * 20
    stock = _bars(closes)
    bench = _bars([200.0] * len(closes))
    up = _run("rs_vs_ema.crossUp", stock, bench)
    down = _run("rs_vs_ema.crossDown", stock, bench)
    assert _ones(down) == [30]
    assert _ones(up) == [60]
    cols = rsm.compute_rs_vs_ema_columns(stock, bench)
    assert cols["dist"][29] == 0.0 and cols["dist"][30] < 0 < cols["dist"][60]
    assert up[0] is None and down[0] is None


def test_the_forming_lane_and_a_probe_get_nothing_and_intraday_is_refused():
    stock = _bars([100.0] * 40)
    for a in SPLIT:
        fn = alert_series.SERIES_FUNCS[a]
        assert fn(list(stock), {}) == [None] * 40, "no tf / sym: the closed lane only"
        assert fn.reads_benchmark is True and fn.timeframes == ("D", "W")
        with pytest.raises(ars.RsTimeframeRefused):
            fn(stock, {}, tf="5", sym="TEST")
        assert len(_run(a, stock, _bars([200.0] * 40), tf="W")) == 40      # weekly is offered


# --- inputs, lookback, labels --------------------------------------------------

def test_inputs_are_validated_and_clamped_like_the_chart():
    p = "rs_phases.flipBlue"
    assert ars.rs_refusal(p, {}) is None
    assert ars.rs_refusal(p, {"shortEma": 5, "longEma": 20, "benchmark": "QQQ"}) is None
    assert "shortEma" in ars.rs_refusal(p, {"shortEma": 99})
    assert "longEma" in ars.rs_refusal(p, {"longEma": 2})
    assert "whole number" in ars.rs_refusal(p, {"shortEma": 2.5})
    assert "INDUSTRY" in ars.rs_refusal(p, {"benchmark": "INDUSTRY"})
    assert ars.normalize_rs_params(p, {"shortEma": "4.0", "benchmark": "qqq"}) == {"shortEma": 4, "benchmark": "QQQ"}
    # a row written around the door computes the chart's clamped answer
    assert ars.phases_inputs({"shortEma": 99, "longEma": 1}) == {"shortEma": 20, "longEma": 3}
    # the vs-EMA alert has no length knob
    assert ars.rs_refusal("rs_vs_ema.crossUp", {"benchmark": "SPY"}) is None
    assert alert_series.address_inputs("rs_vs_ema.crossUp") == {"benchmark": "SPY"}
    assert alert_series.address_inputs(p) == {"benchmark": "SPY", "shortEma": 3, "longEma": 10}


def test_lookback_and_instance_labels():
    assert ars.rs_lookback("rs_phases.flipBlue", {}) == ars.EMA_PREFIX_MULT * 10
    assert ars.rs_lookback("rs_phases.flipBlue", {"longEma": 30}) == ars.EMA_PREFIX_MULT * 30
    assert ars.rs_lookback("rs_vs_ema.crossUp", {}) == ars.EMA_PREFIX_MULT * 21
    assert ars.describe_rs("rs_phases.flipBlue", {}) == "vs SPY · 3/10 EMA"
    assert ars.describe_rs("rs_vs_ema.crossDown", {"benchmark": "qqq"}) == "vs QQQ · EMA(21)"
    assert ev.instance_label("rs_phases.flipRed") == "RS Phase turned red (vs SPY · 3/10 EMA)"


# --- the catalogue and the door ------------------------------------------------

def test_catalogue_rows_for_the_split_families():
    served = {e["indicator"]: e for e in ev.alert_catalog()}
    got = {p["value"]: p["label"] for b in ("rs_phases", "rs_vs_ema") for p in served[b]["plots"]}
    assert got == {
        "rs_phases.flipBlue": "RS Phase turned blue",
        "rs_phases.flipRed": "RS Phase turned red",
        "rs_vs_ema.crossUp": "RS line crossed above its 21 EMA",
        "rs_vs_ema.crossDown": "RS line crossed below its 21 EMA",
    }
    rules = {p["value"]: p["conditions"][0]["label"]
             for b in ("rs_phases", "rs_vs_ema") for p in served[b]["plots"]}
    assert rules["rs_phases.flipBlue"] == "RS Phase turned blue this bar: RS rising while the market falls"
    assert rules["rs_phases.flipRed"] == "RS Phase turned red this bar: RS falling while the market rises"
    assert rules["rs_vs_ema.crossUp"] == "RS line crossed above its 21 EMA this bar"
    assert rules["rs_vs_ema.crossDown"] == "RS line crossed below its 21 EMA this bar"
    assert served["rs_phases"]["label"] == "UCT RS Phases"
    assert served["rs_vs_ema"]["label"] == "UCT RS vs 21 EMA"


def test_door_accepts_daily_weekly_and_refuses_intraday_with_the_lanes_sentence():
    for a in SPLIT:
        assert ias.refusal_for(a, "above", "D", None) is None
        assert ias.refusal_for(a, "above", "W", None) is None
        why = ias.refusal_for(a, "above", "5", None)
        assert why == ars.timeframe_refusal("5", a) and ias.REFUSAL_RS_TIMEFRAME in why
        assert ias.refusal_for(a, "above", "M", None) is not None


def test_split_addresses_follow_their_own_flag(monkeypatch):
    monkeypatch.setattr(rd, "RS_SPLIT_ENABLED", False)
    served = {e["indicator"] for e in ev.alert_catalog()}
    assert "rs_phases" not in served and "rs_vs_ema" not in served and "rs_line" in served
    for a in SPLIT:
        assert ev.rs_address_offered(a) is False
        assert ias.REFUSAL_RS_NOT_OFFERED in ias.refusal_for(a, "above", "D", None)
        assert ev.value_function(a) is not None, "registered and evaluable even while dark"


def test_alert_rev_vocabulary():
    for a in SPLIT:
        assert rev.compute_rev(a) == 1
    assert rev.ADDRESS_BASE_DEFINITION["rs_phases"] == "rsPhases"
    assert rev.ADDRESS_BASE_DEFINITION["rs_vs_ema"] == "rsVsEma"
    assert rev.ADDRESS_REVS["rsPhases"] == rev.ADDRESS_REVS["rsVsEma"] == 1


# --- the withheld Mansfield three: both halves --------------------------------

def test_mansfield_is_not_offered_to_a_new_alert():
    plots = {p["value"] for e in ev.alert_catalog() for p in e["plots"]}
    assert not (plots & set(MANSFIELD))
    assert {"rs_line.newHigh", "rs_line.rating"} <= plots, "the rest of the family is still offered"
    for a in MANSFIELD:
        assert ev.rs_address_offered(a) is False
        cond = ev.ALERT_CONDITIONS[a][0]["value"]
        why = ias.refusal_for(a, cond, "D", 0.0)
        assert why is not None and ias.REFUSAL_RS_WITHHELD in why and "keeps running" in why
        assert ias.REFUSAL_RS_NOT_OFFERED not in why, "the two offer gates stay disjoint"


def test_mansfield_stays_registered_and_still_evaluates():
    n = 260
    stock = _bars([100.0 + 0.2 * i + (3.0 if i % 7 == 0 else 0.0) for i in range(n)])
    bench = _bars([200.0 + 0.1 * i for i in range(n)])
    assert set(MANSFIELD) <= set(ev.RS_ADDRESSES) <= set(ev.all_addresses())
    for a in MANSFIELD:
        assert alert_series.SERIES_FUNCS[a] is ars.RS_SERIES[a]
        assert ev.value_function(a) is not None and a in ev.CLOSED_ONLY_ADDRESSES
        assert ev.ALERT_CONDITIONS[a] and ev.ALERT_LABELS[a]
    mansfield = _run("rs_line.mansfield", stock, bench)
    assert mansfield[-1] is not None
    assert mansfield == list(rsm.compute_mansfield_columns(stock, bench, 200)["mansfield"])
    with ars.rs_pass(fetch_bars=_Store(bench)):
        value, _trig, i = ev._evaluate_one_closed(
            {"id": 1, "user_id": "u", "sym": "TEST", "tf": "D", "indicator": "rs_line.mansfield",
             "condition": "above", "threshold": None, "params_json": None, "last_value": None},
            stock, now_epoch=_dt.datetime(2030, 1, 1, tzinfo=_dt.timezone.utc).timestamp())
    assert value is not None and i == n - 1
