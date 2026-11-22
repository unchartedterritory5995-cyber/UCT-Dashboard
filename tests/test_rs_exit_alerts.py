"""UCT RS Exit Warnings (2026-11-12): the three alert addresses
`rs_exit.quickBreak`, `rs_exit.quicksand` and `rs_exit.deadBreak`.

The maths is `tests/test_rs_exit_math.py` (hand-derived); the lane tests here prove the
alert column IS the chart's event column (same function, same lengths), and that the
three addresses follow the same doors, flags and timeframes as their siblings
(`tests/test_rs_split_alerts.py`). The benchmark is an injected fetcher: no server,
no store.
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

EXIT = ("rs_exit.quickBreak", "rs_exit.quicksand", "rs_exit.deadBreak")
COLUMN = {"rs_exit.quickBreak": "quickBreak", "rs_exit.quicksand": "quicksand", "rs_exit.deadBreak": "deadBreak"}


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


#: The hand-derived path of `test_rs_exit_math.py`, over a flat benchmark: with fast 2 and slow 3
#: the Quick Breaks fall on bars 3, 5, 7 and the Grateful Dead Breaks on 3 and 5.
CLOSES = [100.0, 100.0, 100.0, 80.0, 92.0, 60.0, 72.0, 40.0]
PARAMS = {"fastLength": 2, "slowLength": 3}


# --- the alert column IS the chart's event column -------------------------------

def test_the_three_columns_are_the_charts_events_on_the_hand_derived_path():
    stock, bench = _bars(CLOSES), _bars([100.0] * len(CLOSES))
    pure = rsm.compute_rs_exit_columns(stock, bench, 2, 3)
    for address, col in COLUMN.items():
        got = _run(address, stock, bench, PARAMS)
        assert got == pure[col], address
    assert _ones(_run("rs_exit.quickBreak", stock, bench, PARAMS)) == [3, 5, 7]
    assert _ones(_run("rs_exit.deadBreak", stock, bench, PARAMS)) == [3, 5]
    assert _ones(_run("rs_exit.quicksand", stock, bench, PARAMS)) == []


def test_quicksand_fires_on_the_bar_that_falls_lower_than_the_break():
    stock, bench = _bars([90.0, 90.0, 90.0, 50.0, 40.0]), _bars([100.0] * 5)
    assert _ones(_run("rs_exit.quickBreak", stock, bench, PARAMS)) == [3]
    assert _ones(_run("rs_exit.quicksand", stock, bench, PARAMS)) == [4]


def test_the_closed_lane_decodes_an_event_bar_through_the_zero_point_five_threshold():
    stock, bench = _bars(CLOSES), _bars([100.0] * len(CLOSES))
    for a in EXIT:
        assert ev.THRESHOLD_OPERAND[(a, "above")] == {"kind": "const", "value": 0.5}
    with ars.rs_pass(fetch_bars=_Store(bench)):
        value, triggered, i = ev._evaluate_one_closed(
            {"id": 1, "user_id": "u", "sym": "TEST", "tf": "D", "indicator": "rs_exit.quickBreak",
             "condition": "above", "threshold": None, "params_json": '{"fastLength": 2, "slowLength": 3}',
             "last_value": None},
            stock, now_epoch=_dt.datetime(2030, 1, 1, tzinfo=_dt.timezone.utc).timestamp())
    assert i == len(CLOSES) - 1 and value == 1.0 and triggered, "the newest bar is a Quick Break"


# --- the timeframe and the lengths -----------------------------------------------

def test_the_forming_lane_gets_nothing_intraday_is_refused_and_weekly_is_offered():
    stock = _bars([100.0] * 40)
    for a in EXIT:
        fn = alert_series.SERIES_FUNCS[a]
        assert fn(list(stock), {}) == [None] * 40, "no tf / sym: the closed lane only"
        assert fn.reads_benchmark is True and fn.timeframes == ("D", "W")
        assert fn.instance_defs == ["rsExit"]
        with pytest.raises(ars.RsTimeframeRefused):
            fn(stock, {}, tf="5", sym="TEST")
        assert len(_run(a, stock, _bars([200.0] * 40), tf="W")) == 40


def test_zero_lengths_are_auto_per_timeframe_exactly_as_the_chart_resolves_them():
    assert ars.exit_lengths({}, "D") == ars.exit_lengths(None) == (21, 50)
    assert ars.exit_lengths({}, "W") == (8, 21)
    assert ars.exit_lengths({"fastLength": 10, "slowLength": 30}, "W") == (10, 30)
    assert ars.exit_lengths({"fastLength": 30, "slowLength": 10}, "D") == (30, 31)
    assert ars.exit_lengths({"fastLength": 0, "slowLength": 0}, "D") == rsm.resolve_exit_lengths("D", 0, 0)


def test_a_weekly_alert_reads_the_weekly_pair_not_the_daily_one():
    # A 30-bar dip then recovery: only the 8-bar weekly fast average can both exist and cross inside
    # 40 bars. (The daily 21/50 pair has no slow average at all before bar 49.)
    closes = [100.0] * 20 + [60.0] * 10 + [100.0] * 10
    stock, bench = _bars(closes), _bars([100.0] * 40)
    weekly = _run("rs_exit.quickBreak", stock, bench, tf="W")
    daily = _run("rs_exit.deadBreak", stock, bench, tf="D")
    assert _ones(weekly) == _ones(rsm.compute_rs_exit_columns(stock, bench, 8, 21)["quickBreak"]) != []
    assert all(v is None for v in daily), "no 50-bar slow average yet: warm-up, never a guess"


# --- inputs, lookback, labels ------------------------------------------------------

def test_inputs_are_validated_like_the_charts_row():
    q = "rs_exit.quickBreak"
    assert ars.rs_refusal(q, {}) is None
    assert ars.rs_refusal(q, {"fastLength": 0, "slowLength": 0, "benchmark": "QQQ"}) is None
    assert ars.rs_refusal(q, {"fastLength": 8, "slowLength": 400}) is None
    assert "fastLength" in ars.rs_refusal(q, {"fastLength": -1})
    assert "slowLength" in ars.rs_refusal(q, {"slowLength": 401})
    assert "whole number" in ars.rs_refusal(q, {"fastLength": 7.5})
    assert "fastLength" in ars.rs_refusal(q, {"fastLength": True})
    assert "INDUSTRY" in ars.rs_refusal(q, {"benchmark": "INDUSTRY"})
    assert ars.normalize_rs_params(q, {"fastLength": "10.0", "benchmark": "qqq"}) == {"fastLength": 10, "benchmark": "QQQ"}
    assert alert_series.address_inputs(q) == {"benchmark": "SPY", "fastLength": 0, "slowLength": 0}
    assert ars.EXIT_DEFAULTS == {"benchmark": "SPY", "fastLength": 0, "slowLength": 0}


def test_lookback_reads_the_slow_average_plus_the_cycle_history():
    # the SLOW simple average is exact (no EMA convergence prefix) and a Quicksand needs the
    # Quick Break it is measured from, so the cycle history is read beyond it.
    assert ars.rs_lookback("rs_exit.quicksand", {}) == 50 + rsm.EXIT_CYCLE_HISTORY
    assert ars.rs_lookback("rs_exit.deadBreak", {"slowLength": 100}) == 100 + rsm.EXIT_CYCLE_HISTORY


def test_instance_labels():
    assert ars.describe_rs("rs_exit.quickBreak", {}) == "vs SPY · 21/50 SMA (weekly 8/21)"
    assert ars.describe_rs("rs_exit.deadBreak", {"benchmark": "qqq", "fastLength": 10, "slowLength": 40}) == "vs QQQ · 10/40 SMA"
    assert ev.instance_label("rs_exit.quicksand") == "RS Quicksand (vs SPY · 21/50 SMA (weekly 8/21))"


# --- the catalogue, the door and the flag ----------------------------------------

def test_catalogue_rows_are_one_event_rule_each_in_plain_words():
    served = {e["indicator"]: e for e in ev.alert_catalog()}
    assert served["rs_exit"]["label"] == "UCT RS Exit Warnings"
    got = {p["value"]: p["label"] for p in served["rs_exit"]["plots"]}
    assert got == {"rs_exit.quickBreak": "RS Quick Break", "rs_exit.quicksand": "RS Quicksand",
                   "rs_exit.deadBreak": "RS Grateful Dead Break"}
    rules = {p["value"]: p["conditions"] for p in served["rs_exit"]["plots"]}
    assert all(len(c) == 1 and c[0]["value"] == "above" and c[0]["needs_threshold"] is False for c in rules.values())
    assert "Quick Break" in rules["rs_exit.quickBreak"][0]["label"]
    assert "Quicksand" in rules["rs_exit.quicksand"][0]["label"]
    assert "Grateful Dead Break" in rules["rs_exit.deadBreak"][0]["label"]
    for a in EXIT:                      # no trade words in any member-facing alert sentence
        text = (ev.ALERT_LABELS[a] + " " + ev.ALERT_CONDITIONS[a][0]["label"]).lower()
        assert "buy" not in text and "sell" not in text


def test_the_door_accepts_daily_weekly_and_refuses_intraday_with_the_lanes_sentence():
    for a in EXIT:
        assert ias.refusal_for(a, "above", "D", None) is None
        assert ias.refusal_for(a, "above", "W", None) is None
        why = ias.refusal_for(a, "above", "5", None)
        assert why == ars.timeframe_refusal("5", a) and ias.REFUSAL_RS_TIMEFRAME in why
        assert ias.refusal_for(a, "above", "M", None) is not None


def test_the_exit_addresses_follow_the_split_flag(monkeypatch):
    monkeypatch.setattr(rd, "RS_SPLIT_ENABLED", False)
    assert "rs_exit" not in {e["indicator"] for e in ev.alert_catalog()}
    for a in EXIT:
        assert ev.rs_address_offered(a) is False
        why = ias.refusal_for(a, "above", "D", None)
        assert ias.REFUSAL_RS_NOT_OFFERED in why and "RS Exit Warnings" in why
        assert ev.value_function(a) is not None, "registered and evaluable even while dark"


def test_the_addresses_are_the_last_three_of_the_rs_partition_and_closed_only():
    assert ars.RS_SPLIT_ADDRESSES[-3:] == EXIT
    assert tuple(ev.RS_ADDRESSES[-3:]) == EXIT
    assert set(EXIT) <= set(ev.CLOSED_ONLY_ADDRESSES)
    assert not set(EXIT) & set(ev.INDICATOR_FUNCS)


def test_alert_rev_vocabulary():
    for a in EXIT:
        assert rev.compute_rev(a) == 1
    assert rev.ADDRESS_BASE_DEFINITION["rs_exit"] == "rsExit"
    assert rev.ADDRESS_REVS["rsExit"] == 1
    # the chart row's rev is the one the alert rev follows: moving one without the other is the bug
    assert rev.ADDRESS_REVS["rsExit"] == next(d for d in rd.RS_SPLIT_DEFS if d["id"] == "rsExit")["compute"]["rev"]
