"""Rails for the UCT Relative Strength ALERT SERIES (unit 2b-04 of the Phase 2
engineering map, §2.6): `api/services/alert_rs_series.py`, the `reads_benchmark`
branch of `alert_user_series.call_series`, the append to
`alert_series.SERIES_FUNCS`, and the service's probe seam.

Modelled on `test_alert_ma_cross.py`: every expected column comes from
`relative_strength.compute_phase1_columns` / `compute_mansfield_columns`
THEMSELVES, never from a formula typed here; the benchmark is an injected,
counting fetcher; no server, no store. The evaluator partition, catalog rows and
labels are unit 2b-05's and are not asserted here.
"""
from __future__ import annotations

import datetime as _dt
import json
import math

import pytest

from api.services import alert_rs_series as ars
from api.services import alert_series
from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import indicator_compute as ic
from api.services import relative_strength as rsm
from api.services import rs_benchmarks as rb
from api.services.indicator_compute import _round_series
from api.services.signature import registry_defs as rd


# ─── synthetic bars: daily calendar `t` (YYYYMMDD ints), as the store hands them ──

def _weekdays(n, start=_dt.date(2022, 1, 3)):
    out, day = [], start
    while len(out) < n:
        if day.weekday() < 5:
            out.append(int(day.strftime("%Y%m%d")))
        day += _dt.timedelta(days=1)
    return out


def _bars(closes, times):
    return [{"t": t, "o": float(c) - 0.3, "h": float(c) + 1.0, "l": float(c) - 1.2,
             "c": float(c), "v": 1_000_000 + i}
            for i, (t, c) in enumerate(zip(times, closes))]


N = 700
TIMES = _weekdays(N)
STOCK = _bars([100.0 + 12.0 * math.sin(i / 11.0) + i * 0.08 for i in range(N)], TIMES)
OTHER = _bars([50.0 + 4.0 * math.sin(i / 9.0 + 2.0) + i * 0.02 for i in range(N)], TIMES)
# the benchmark swings ~2 % a day at its steepest, so red (≤ −0.5 %) days exist
SPY = _bars([200.0 + 20.0 * math.sin(i / 5.0 + 1.0) + i * 0.03 for i in range(N)], TIMES)
XLK = _bars([80.0 + 5.0 * math.sin(i / 7.0) + i * 0.05 for i in range(N)], TIMES)
QQQ = _bars([300.0 + 30.0 * math.sin(i / 6.0 + 0.5) + i * 0.04 for i in range(N)], TIMES)

CUSTOM = {"benchmark": "QQQ", "maLength": 10, "maType": "SMA", "lookback": 100,
          "priceTolerance": 1.0, "redDayThreshold": -0.25, "mansfieldLength": 50}


class _Store:
    """A counting `(ticker, tf, want) -> bars` fetcher — the injected benchmark reader."""

    def __init__(self, table=None):
        self.table = {k.upper(): v for k, v in (table or {"SPY": SPY, "XLK": XLK, "QQQ": QQQ}).items()}
        self.calls = []

    def __call__(self, ticker, tf, want):
        self.calls.append((str(ticker).upper(), str(tf), int(want)))
        bars = self.table.get(str(ticker).upper(), [])
        return bars[-int(want):] if int(want) < len(bars) else list(bars)


@pytest.fixture(autouse=True, scope="module")
def _rs_registered():
    """⭐ 2026-11-06 (RS 2b-05): THE ENTRIES ARE REGISTERED BY THE EVALUATOR AT ITS
    IMPORT (`indicator_alert_evaluator.RS_ADDRESSES` / `register_rs_series()`,
    before its partitions and `_CANONICAL_ADDRESS` are derived), so this fixture
    ASSERTS that registration rather than making it — and never unregisters: the
    evaluator's tables are a snapshot of the 43-entry table, and removing the
    eleven would leave `RS_FUNCS` pointing at columns `SERIES_FUNCS` no longer
    holds for every test file that runs after this one."""
    assert all(alert_series.SERIES_FUNCS.get(a) is ars.RS_SERIES[a] for a in ars.RS_ADDRESSES), (
        "the evaluator's import did not register the RS entries")
    assert ars.register_rs_series() == (), "idempotent"
    yield


def _expected(address, bars, bench, params):
    """The chart's own number for this address: straight off `relative_strength`."""
    spec = ars.RS_ADDRESS_SPECS[address]
    if spec.family == "phase1":
        cols = rsm.compute_phase1_columns(bars, bench, rsm.resolve_phase1_inputs(dict(params)))
    else:
        cols = rsm.compute_mansfield_columns(bars, bench, ars.mansfield_length(params))
    col = list(cols[spec.column])
    return _round_series(col, 6) if spec.rounded else col


def _series(address, bars, params, *, store, tf="D", sym="TEST"):
    fn = alert_series.SERIES_FUNCS[address]
    with ars.rs_pass(fetch_bars=store):
        return aus.call_series(fn, bars, params, tf=tf, sym=sym)


# ─── the table ───────────────────────────────────────────────────────────────

def test_registration_is_explicit_idempotent_and_appends_last():
    """On a private table, so the module fixture's registration is not disturbed."""
    table = {"rsi": alert_series.SERIES_FUNCS["rsi"], "ma_cross": alert_series.SERIES_FUNCS["ma_cross"]}
    assert ars.register_rs_series(table) == ars.RS_ADDRESSES
    assert list(table) == ["rsi", "ma_cross", *ars.RS_ADDRESSES], "appended LAST, in catalog order"
    assert all(table[a] is ars.RS_SERIES[a] for a in ars.RS_ADDRESSES)
    assert ars.register_rs_series(table) == (), "a second call adds nothing"
    # an entry already present — somebody's stub — is neither replaced nor removed
    stub = lambda bars, params: [None] * len(bars)  # noqa: E731
    partial = {"rs_line.value": stub}
    assert ars.register_rs_series(partial) == tuple(a for a in ars.RS_ADDRESSES if a != "rs_line.value")
    assert partial["rs_line.value"] is stub
    assert ars.unregister_rs_series(partial) == tuple(a for a in ars.RS_ADDRESSES if a != "rs_line.value")
    assert list(partial) == ["rs_line.value"]
    assert ars.unregister_rs_series(table) == ars.RS_ADDRESSES and list(table) == ["rsi", "ma_cross"]
    assert ars.unregister_rs_series(table) == ()
    # 2026-11-06 (RS 2b-05): the evaluator registers at ITS import and derives its
    # tables after — RS is in the fifth partition, never in the 28-wide grid
    assert not any(a in ev.INDICATOR_FUNCS for a in ars.RS_ADDRESSES)
    assert all(a in ev.all_addresses() for a in ars.RS_ADDRESSES)
    assert list(ev.RS_FUNCS) == list(ars.RS_ADDRESSES)


def test_the_rs_addresses_are_appended_last_and_declare_the_benchmark_shape():
    keys = list(alert_series.SERIES_FUNCS)
    assert keys[31] == "ma_cross", "the 32 pre-RS entries are unmoved"
    assert keys[32:] == list(ars.RS_ADDRESSES) == list(ars.RS_SERIES)
    assert len(ars.RS_ADDRESSES) == 11 and all(a.startswith("rs_line.") for a in ars.RS_ADDRESSES)
    assert "rs_line.rating" not in ars.RS_ADDRESSES, "2b-06, not this unit"
    for address, spec in ars.RS_ADDRESS_SPECS.items():
        fn = alert_series.SERIES_FUNCS[address]
        assert alert_series.series_function(address) is fn
        assert fn.reads_benchmark is True
        assert fn.instance_defs == ["rsLine"]
        assert fn.timeframes == ("D", "W")
        assert fn.rs_column == spec.column
        assert tuple(fn.inputs) == spec.inputs
        assert alert_series.address_inputs(address) == fn.inputs
        assert "benchmark" in fn.inputs and fn.inputs["benchmark"] == rb.DEFAULT_BENCHMARK == "SPY"
        # the chart's menu minus INDUSTRY, derived from the chart's one list
        assert fn.input_options["benchmark"] == [b for b in rd.RS_LINE_BENCHMARKS if b != "INDUSTRY"]
        assert "INDUSTRY" not in fn.input_options["benchmark"]
        if "maType" in spec.inputs:
            assert fn.input_options["maType"] == ["EMA", "SMA"]
        else:
            assert "maType" not in fn.input_options
        for k, v in fn.inputs.items():
            if k != "benchmark":
                assert v == {**ars.PHASE1_DEFAULTS, **ars.MANSFIELD_DEFAULTS}[k]
        assert spec.column in (rsm.PHASE1_COLUMNS + rsm.PHASE2A_COLUMNS)
    # the defaults ARE the compute module's constants, not a second copy
    assert ars.PHASE1_DEFAULTS["lookback"] == rsm.DEFAULT_LOOKBACK == 252
    assert ars.PHASE1_DEFAULTS["maLength"] == rsm.DEFAULT_MA_LENGTH == 21
    assert ars.PHASE1_DEFAULTS["maType"] == rsm.DEFAULT_MA_TYPE == "EMA"
    assert ars.MANSFIELD_DEFAULTS["mansfieldLength"] == rsm.DEFAULT_MANSFIELD_LENGTH == 200
    # …and no pre-existing entry grew the flag
    for address in keys[:32]:
        assert not getattr(alert_series.SERIES_FUNCS[address], "reads_benchmark", False), address


# ─── bar-for-bar equality with the chart's compute ──────────────────────────

@pytest.mark.parametrize("address", ars.RS_ADDRESSES)
@pytest.mark.parametrize("params", [{}, {"benchmark": "SPY"}, CUSTOM], ids=["defaults", "spy", "custom"])
def test_every_rs_series_equals_the_chart_compute_column_bar_for_bar(address, params):
    store = _Store()
    got = _series(address, STOCK, params, store=store)
    bench = store.table[ars.rs_benchmark_of(params)]
    want = _expected(address, STOCK, bench, params)
    assert len(got) == len(STOCK) == len(want)
    assert got == want, address
    # non-vacuous: real values, a real warm-up, the compute's own value vocabulary
    assert any(v is not None for v in got) and got[0] is None or address == "rs_line.value"
    kind = ars.RS_ADDRESS_SPECS[address].kind
    if kind in ("event", "state"):
        assert set(got) <= {0.0, 1.0, None} and 1.0 in got, address
    else:
        assert any(isinstance(v, float) for v in got)
    # the same column through the pure builder, with the benchmark in hand
    assert ars.build_rs_series(address, STOCK, bench, params) == want


def test_line_columns_are_rounded_like_the_provider_and_events_are_not():
    store = _Store()
    value = _series("rs_line.value", STOCK, {}, store=store)
    raw = rsm.compute_phase1_columns(STOCK, SPY, rsm.resolve_phase1_inputs({}))["rsLine"]
    assert value == _round_series(raw, 6) and value != raw
    assert all(v is None or round(v, 6) == v for v in value)
    ma = _series("rs_line.ma", STOCK, {}, store=store)
    assert all(v is None or round(v, 6) == v for v in ma)
    cross = _series("rs_line.crossUp", STOCK, {}, store=store)
    assert set(cross) <= {0.0, 1.0, None}


def test_an_unknown_address_is_a_caller_bug_in_the_builder():
    with pytest.raises(KeyError):
        ars.build_rs_series("rs_line.nope", STOCK, SPY, {})


# ─── one benchmark read, one compute, per pass ──────────────────────────────

def test_the_benchmark_is_read_once_for_three_alerts_in_one_pass(monkeypatch):
    three = ("rs_line.newHigh", "rs_line.crossUp", "rs_line.value")
    want = {a: _expected(a, STOCK, SPY, {}) for a in three}   # the oracle, BEFORE the counter
    computes = []
    real = rsm.compute_phase1_columns
    monkeypatch.setattr(rsm, "compute_phase1_columns",
                        lambda *a, **k: computes.append(1) or real(*a, **k))
    store = _Store()
    with ars.rs_pass(fetch_bars=store) as p:
        for address in three:
            got = aus.call_series(alert_series.SERIES_FUNCS[address], STOCK, {}, tf="D", sym="TEST")
            assert got == want[address]
        assert store.calls == [("SPY", "D", N)], "one store read for three alerts on one symbol"
        assert p.fetch_calls == 1
        assert len(computes) == 1, "one Phase 1 compute for three addresses of one window"
        # three MORE symbols on the same benchmark: still one benchmark read
        for sym, bars in (("ABC", OTHER), ("XYZ", OTHER[-500:]), ("TEST", STOCK)):
            aus.call_series(alert_series.SERIES_FUNCS["rs_line.newHigh"], bars, {}, tf="D", sym=sym)
        assert store.calls == [("SPY", "D", N)]
        assert p.fetch_calls == 1
        assert len(computes) == 3, "ABC and XYZ are their own windows; TEST's hit the memo"
        # a Mansfield address is its own family: its own compute, no new read, no Phase 1 rerun
        mans = aus.call_series(alert_series.SERIES_FUNCS["rs_line.mansfield"], STOCK, {}, tf="D", sym="TEST")
        assert store.calls == [("SPY", "D", N)]
        assert len(computes) == 3 and p.compute_calls == 4
    assert mans == _expected("rs_line.mansfield", STOCK, SPY, {})
    # a NEW pass reads again (no stale bar outlives the pass it was read in)
    with ars.rs_pass(fetch_bars=store):
        aus.call_series(alert_series.SERIES_FUNCS["rs_line.value"], STOCK, {}, tf="D", sym="TEST")
    assert store.calls == [("SPY", "D", N), ("SPY", "D", N)]


def test_the_pass_serves_a_smaller_want_from_the_read_it_made_and_rereads_a_larger_one():
    store = _Store()
    p = ars.RsPass(store)
    assert p.fetch("SPY", "D", 500) == SPY[-500:] and store.calls == [("SPY", "D", 500)]
    assert p.fetch("SPY", "D", 100) == SPY[-100:] and len(store.calls) == 1, "served from the read"
    assert p.fetch("spy", "D", 500) == SPY[-500:] and len(store.calls) == 1, "ticker case-insensitive"
    assert p.fetch("SPY", "D", 5000) == SPY and len(store.calls) == 2, "a larger want re-reads"
    assert p.fetch("SPY", "D", 6000) == SPY and len(store.calls) == 2, "the store had no more"
    assert p.fetch("SPY", "W", 10) == SPY[-10:] and len(store.calls) == 3, "another timeframe is another read"


def test_the_pass_memoises_the_resolution_per_symbol_only_for_auto_benchmarks(monkeypatch):
    groups = []
    monkeypatch.setattr(rb, "_groups_for",
                        lambda sym: groups.append(sym) or {"sector": "Technology", "industry": "Software"})
    store = _Store()
    p = ars.RsPass(store)
    a = p.resolve("TEST", "SECTOR", "D", N)
    b = p.resolve("TEST", "SECTOR", "D", N)
    assert a is b and groups == ["TEST"], "one industry-map read per (symbol, requested, tf, want)"
    c = p.resolve("OTHER", "SECTOR", "D", N)
    assert c is not a and groups == ["TEST", "OTHER"]
    assert store.calls == [("XLK", "D", N)], "both symbols' sector ETF was read once"
    lit = p.resolve("TEST", "SPY", "D", N)
    assert lit is p.resolve("ANYONE", "SPY", "D", N), "a literal benchmark is symbol-free"
    assert groups == ["TEST", "OTHER"]


def test_outside_a_pass_each_call_reads_through_the_default_loader(monkeypatch):
    store = _Store()
    monkeypatch.setattr(ars, "default_fetch_bars", store)
    assert ars.current_pass() is None
    fn = alert_series.SERIES_FUNCS["rs_line.crossDown"]
    got = aus.call_series(fn, STOCK, {}, tf="D", sym="TEST")
    assert got == _expected("rs_line.crossDown", STOCK, SPY, {})
    aus.call_series(fn, STOCK, {}, tf="D", sym="TEST")
    assert len(store.calls) == 2, "no pass ⇒ no memo; the loader's own TTL cache is the dedup"


def test_the_default_loader_is_the_scans_local_symbol_reader(monkeypatch):
    seen = []
    monkeypatch.setattr(aus, "_symbol_bars", lambda t, tf, want: seen.append((t, tf, want)) or SPY)
    assert ars.default_fetch_bars("SPY", "D", 7) == SPY and seen == [("SPY", "D", 7)]


def test_nested_passes_share_the_outer_memo_unless_a_fetcher_names_a_new_one():
    store = _Store()
    with ars.rs_pass(fetch_bars=store) as outer:
        with ars.rs_pass() as inner:
            assert inner is outer and ars.current_pass() is outer
        other = _Store()
        with ars.rs_pass(fetch_bars=other) as fresh:
            assert fresh is not outer and ars.current_pass() is fresh
        assert ars.current_pass() is outer
    assert ars.current_pass() is None


# ─── SECTOR through `resolve_benchmark`, fallback carried ───────────────────

def test_sector_resolves_through_resolve_benchmark_and_carries_the_fallback(monkeypatch):
    fn = alert_series.SERIES_FUNCS["rs_line.newHigh"]
    params = {"benchmark": "SECTOR"}

    monkeypatch.setattr(rb, "_groups_for", lambda sym: {"sector": "Technology", "industry": "Software"})
    store = _Store()
    with ars.rs_pass(fetch_bars=store) as p:
        got = aus.call_series(fn, STOCK, params, tf="D", sym="TEST")
        res = p.resolve("TEST", "SECTOR", "D", N)
    assert store.calls == [("XLK", "D", N)]
    assert got == _expected("rs_line.newHigh", STOCK, XLK, params)
    assert (res["requested"], res["resolved"], res["label"], res["fallback"]) == \
        ("SECTOR", "XLK", "Technology (XLK)", None)

    # an unmapped sector falls to SPY and SAYS so — the chart's own rule, reused
    monkeypatch.setattr(rb, "_groups_for", lambda sym: {"sector": "Gold", "industry": "Mining"})
    store = _Store()
    with ars.rs_pass(fetch_bars=store) as p:
        got = aus.call_series(fn, STOCK, params, tf="D", sym="TEST")
        res = p.resolve("TEST", "SECTOR", "D", N)
    assert store.calls == [("SPY", "D", N)]
    assert got == _expected("rs_line.newHigh", STOCK, SPY, params)
    assert res["resolved"] == "SPY" and res["fallback"] == "sector not mapped: Gold"

    # an ETF has no sector of its own
    monkeypatch.setattr(rb, "_groups_for", lambda sym: {"sector": "Financial", "industry": rb.ETF_INDUSTRY})
    store = _Store()
    with ars.rs_pass(fetch_bars=store) as p:
        aus.call_series(fn, STOCK, params, tf="D", sym="XLF")
        res = p.resolve("XLF", "SECTOR", "D", N)
    assert store.calls == [("SPY", "D", N)]
    assert res["resolved"] == "SPY" and res["fallback"] == "symbol is an ETF"


def test_an_unknown_benchmark_raises_the_resolvers_own_error_not_spy():
    with ars.rs_pass(fetch_bars=_Store()):
        with pytest.raises(ValueError, match="unknown benchmark"):
            aus.call_series(alert_series.SERIES_FUNCS["rs_line.value"], STOCK,
                            {"benchmark": "NOPE"}, tf="D", sym="TEST")


# ─── the typed timeframe refusal ────────────────────────────────────────────

@pytest.mark.parametrize("tf", ["1", "5", "15", "30", "60", "M", "1M", "H", ""])
def test_a_timeframe_the_lane_is_not_offered_on_raises_the_typed_refusal(tf):
    store = _Store()
    fn = alert_series.SERIES_FUNCS["rs_line.newHigh"]
    with ars.rs_pass(fetch_bars=store):
        with pytest.raises(ars.RsTimeframeRefused) as ei:
            aus.call_series(fn, STOCK, {}, tf=tf, sym="TEST")
    assert isinstance(ei.value, ValueError)
    assert ei.value.tf == tf and ei.value.address == "rs_line.newHigh"
    assert "closed daily or weekly bars only" in str(ei.value)
    assert str(ei.value) == ars.timeframe_refusal(tf, "rs_line.newHigh")
    assert store.calls == [], "refused BEFORE any benchmark is read"


def test_daily_and_weekly_are_the_offered_timeframes_in_either_spelling():
    for tf in ("D", "W", "1D", "1W", "d", "w"):
        assert ars.timeframe_refusal(tf) is None, tf
        assert ars.normalize_tf(tf) in ars.RS_ALERT_TFS
    assert ars.RS_ALERT_TFS == ("D", "W")
    store = _Store()
    weekly = _series("rs_line.crossUp", STOCK, {}, store=store, tf="W")
    assert store.calls == [("SPY", "W", N)], "read at the alert's OWN timeframe"
    assert weekly == _expected("rs_line.crossUp", STOCK, SPY, {})
    assert "5-minute" in ars.timeframe_refusal("5")
    assert "monthly" in ars.timeframe_refusal("M")


# ─── closed lane only: no tf / no sym ⇒ no value ────────────────────────────

@pytest.mark.parametrize("address", ars.RS_ADDRESSES)
def test_without_a_timeframe_and_symbol_the_column_has_no_value(address, monkeypatch):
    store = _Store()
    monkeypatch.setattr(ars, "default_fetch_bars", store)
    fn = alert_series.SERIES_FUNCS[address]
    blank = [None] * len(STOCK)
    assert fn(STOCK, {}) == blank                                   # the forming lane's call shape
    assert aus.call_series(fn, STOCK, {}) == blank                  # `call_series` without tf/sym
    assert aus.call_series(fn, STOCK, {}, tf="D") == blank          # a timeframe alone is not enough
    assert alert_series.series_for(address, STOCK, {}) == blank     # a right-hand operand's read
    assert ev._value_of(address)(STOCK, {}) is None                 # the forming-lane value function
    assert store.calls == [], "nothing was fetched"
    assert fn([], {}, tf="D", sym="TEST") == []


def test_a_symbol_against_itself_or_a_benchmark_without_bars_blanks_the_column():
    fn = alert_series.SERIES_FUNCS["rs_line.newHigh"]
    blank = [None] * len(STOCK)
    with ars.rs_pass(fetch_bars=_Store()):
        assert aus.call_series(fn, SPY, {"benchmark": "SPY"}, tf="D", sym="SPY") == blank
    empty = _Store({"SPY": []})
    with ars.rs_pass(fetch_bars=empty):
        assert aus.call_series(fn, STOCK, {}, tf="D", sym="TEST") == blank
    assert empty.calls == [("SPY", "D", N)]


def test_a_benchmark_missing_a_bar_leaves_that_bar_none_never_filled():
    gap = [b for b in SPY if b["t"] != TIMES[400]]
    store = _Store({"SPY": gap})
    got = _series("rs_line.value", STOCK, {}, store=store)
    assert got[400] is None and got[399] is not None and got[401] is not None
    assert got == _expected("rs_line.value", STOCK, gap, {})


# ─── params: the chart's clamp, the door's refusal, the stored spelling ─────

def test_params_go_through_the_charts_clamp_so_the_alert_and_the_chart_agree(monkeypatch):
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True))
    for raw in ({"lookback": 99999}, {"lookback": 20.6}, {"lookback": 1}, {"maLength": 0},
                {"priceTolerance": "abc"}, {"redDayThreshold": 5}, {"maType": "SMA"}):
        chart = rd.resolve_inputs("rsLine", raw)
        ours = ars.phase1_inputs(raw)
        for key in ("lookback", "maLength", "maType", "priceTolerance", "redDayThreshold"):
            assert ours[key] == chart[key], (raw, key)
    # the chart's enum is strict about case; the alert door accepts the lowercase
    # spelling and `normalize` stores the chart's — so the two never disagree on disk
    with pytest.raises(rd.InputRejected):
        rd.resolve_inputs("rsLine", {"maType": "ema"})
    assert ars.phase1_inputs({"maType": "ema"})["maType"] == "EMA"
    assert alert_series.SERIES_FUNCS["rs_line.ma"].normalize({"maType": "ema"}) == {"maType": "EMA"}
    assert ars.phase1_inputs({"lookback": 99999})["lookback"] == 500
    assert ars.phase1_inputs({"lookback": 20.6})["lookback"] == 21
    store = _Store()
    clamped = _series("rs_line.newHigh", STOCK, {"lookback": 99999}, store=store)
    assert clamped == _expected("rs_line.newHigh", STOCK, SPY, {"lookback": 500})
    assert clamped != _expected("rs_line.newHigh", STOCK, SPY, {"lookback": 252})
    rounded = _series("rs_line.newHigh", STOCK, {"lookback": 20.6}, store=store)
    assert rounded == _expected("rs_line.newHigh", STOCK, SPY, {"lookback": 21})
    assert ars.mansfield_length({"mansfieldLength": 9999}) == 500
    assert ars.mansfield_length({}) == 200


def test_the_door_refuses_what_the_series_would_clamp():
    v = alert_series.SERIES_FUNCS["rs_line.ma"].validate
    assert v({}) is None and v({"benchmark": "spy", "maLength": 21, "maType": "sma"}) is None
    assert "INDUSTRY" in v({"benchmark": "INDUSTRY"}) and "not offered" in v({"benchmark": "INDUSTRY"})
    assert "must be one of" in v({"benchmark": "NOPE"})
    assert "maType" in v({"maType": "wma"})
    assert "2 to 200" in v({"maLength": 0}) and "2 to 200" in v({"maLength": 201})
    assert "whole number" in v({"maLength": 2.5})
    for bad in ("abc", True, float("inf"), float("nan"), None):
        if bad is None:
            assert v({"maLength": None}) is None, "absent is the default"
        else:
            assert v({"maLength": bad}) is not None, bad
    nh = alert_series.SERIES_FUNCS["rs_line.newHighBeforePrice"].validate
    assert "20 to 500" in nh({"lookback": 10})
    assert "0 to 10" in nh({"priceTolerance": 50})
    assert nh({"maType": "wma"}) is None, "a knob this address does not read is not its business"
    red = alert_series.SERIES_FUNCS["rs_line.newHighRed"].validate
    assert "-3 to 0" in red({"redDayThreshold": 1})
    mans = alert_series.SERIES_FUNCS["rs_line.mansfield"].validate
    assert "2 to 500" in mans({"mansfieldLength": 1}) and mans({"mansfieldLength": 200}) is None
    # the evaluator reads `fn.validate` through `params_refusal`'s own shape (params, condition)
    assert v({"maType": "wma"}, "cross_above") == v({"maType": "wma"})


def test_normalize_stores_one_spelling():
    n = alert_series.SERIES_FUNCS["rs_line.ma"].normalize
    assert n({"benchmark": " spy ", "maLength": "21", "maType": "sma"}) == \
        {"benchmark": "SPY", "maLength": 21, "maType": "SMA"}
    n2 = alert_series.SERIES_FUNCS["rs_line.newHighBeforePrice"].normalize
    assert n2({"lookback": 100.0, "priceTolerance": "2"}) == {"lookback": 100, "priceTolerance": 2.0}
    assert n2({"maLength": "7"}) == {"maLength": "7"}, "a knob this address does not read passes through"
    assert n(None) == {}


# ─── the declared lookback and the evaluator's window ───────────────────────

def test_declared_lookback_is_the_convergence_prefix_and_the_evaluator_reads_it(monkeypatch):
    lb = alert_series.address_lookback
    assert lb("rs_line.value", {}) == 0
    assert lb("rs_line.ma", {}) == 21 * ars.EMA_PREFIX_MULT == 126
    assert lb("rs_line.crossUp", {"maType": "SMA", "maLength": 30}) == 30
    assert lb("rs_line.above", {"maLength": 50}) == 300
    assert lb("rs_line.newHigh", {}) == 252
    assert lb("rs_line.newHighRed", {"lookback": 99999}) == 500, "clamped like the chart"
    assert lb("rs_line.mansfield", {}) == 200
    assert lb("rs_line.mansfieldCrossUp", {"mansfieldLength": 50}) == 50
    assert ars.EMA_PREFIX_MULT == alert_series.MA_CROSS_EMA_PREFIX_MULT

    def alert(address, params):
        return {"indicator": address, "sym": "TEST", "tf": "D", "params_json": json.dumps(params)}
    # ⭐ 2026-11-06 (RS 2b-05): the evaluator registers the entries BEFORE its
    # import-time `_CANONICAL_ADDRESS` is built, so the camelCase spelling
    # resolves on its own and the declared lookback sizes the window — the
    # pre-2b-05 pin (a lowercased miss and a floor-sized window) is retired.
    assert ev.resolve_address("rs_line.crossUp") == "rs_line.crossUp"
    assert ev.resolve_address("RS_LINE.CROSSUP") == "rs_line.crossUp"
    assert "rs_line.crossup" in ev._CANONICAL_ADDRESS
    assert ev.bars_needed_for_alert(alert("rs_line.crossUp", {})) == ev.bars_wanted(126) == 526
    assert ev.bars_needed_for_alert(alert("rs_line.newHigh", {})) == ev.bars_wanted(252) == 652
    assert ev.bars_needed_for_alert(alert("rs_line.value", {})) == ev.BARS_MIN == 400
    assert ev.bars_needed_for_alert(alert("rs_line.mansfield", {})) == 600


def test_describe_reads_like_the_chip():
    d = lambda a, p: alert_series.SERIES_FUNCS[a].describe(p)  # noqa: E731
    assert d("rs_line.value", {}) == "vs SPY"
    assert d("rs_line.ma", {}) == "vs SPY · EMA(21)"
    assert d("rs_line.crossUp", {"benchmark": "rsp", "maType": "sma", "maLength": 10}) == "vs RSP · SMA(10)"
    assert d("rs_line.newHigh", {"benchmark": "QQQ", "lookback": 100}) == "vs QQQ · 100-bar"
    assert d("rs_line.newHighBeforePrice", {}) == "vs SPY · 252-bar · price within 2%"
    assert d("rs_line.newHighRed", {}) == "vs SPY · 252-bar · red day ≤ -0.5%"
    assert d("rs_line.mansfield", {}) == "vs SPY · SMA(200)"
    assert d("rs_line.mansfieldCrossDown", {"mansfieldLength": 50}) == "vs SPY · SMA(50)"


# ─── the non-RS paths are byte-identical ────────────────────────────────────

def test_existing_series_are_unchanged_through_call_series():
    closes = [b["c"] for b in STOCK]
    cases = {
        "rsi": ({"period": 14}, list(ic.compute_rsi(closes, period=14))),
        "price_vs_ma": ({"period": 50, "type": "sma"},
                        [None if m is None else c - m for c, m in zip(closes, ic.compute_sma(closes, 50))]),
        "ma_cross": ({"ma_type": "ema", "fast": 5, "slow": 13}, None),
        "close": ({}, [float(c) for c in closes]),
    }
    for address, (params, oracle) in cases.items():
        fn = alert_series.SERIES_FUNCS[address]
        direct = fn(STOCK, params)
        assert aus.call_series(fn, STOCK, params) == direct
        assert aus.call_series(fn, STOCK, params, tf="D", sym="TEST") == direct, \
            "tf and sym are NOT handed to a column that did not ask for them"
        assert alert_series.series_for(address, STOCK, params) == direct
        if oracle is not None:
            assert direct == oracle, address
    # the ma_cross oracle, straight off indicator_compute (its own window rule)
    window = alert_series.ma_cross_window({"ma_type": "ema", "fast": 5, "slow": 13})
    tail = closes[-window:]
    f, s = ic.compute_ema(tail, 5), ic.compute_ema(tail, 13)
    want = [None] * (len(closes) - len(tail)) + [None if (a is None or b is None) else float(a) - float(b)
                                                for a, b in zip(f, s)]
    assert alert_series.SERIES_FUNCS["ma_cross"](STOCK, {"ma_type": "ema", "fast": 5, "slow": 13}) == want


# ─── the service's probe seam ───────────────────────────────────────────────

def test_the_probe_seam_measures_rs_on_the_calendar_encoding_only(monkeypatch):
    instant, calendar = ias._probe_series()
    for address in ars.RS_ADDRESSES:
        fn = alert_series.SERIES_FUNCS[address]
        col = ias._probe_column(fn, calendar, {})
        assert len(col) == len(calendar) and any(v is not None for v in col), address
        assert col[-1] is not None and ias.closed_lane_pad(address, calendar, {}) == 0, address
        with pytest.raises(ars.RsTimeframeRefused):
            ias._probe_column(fn, instant, {})
        assert ias.closed_lane_pad(address, instant, {}) == 0, "a refusal is 'could not tell'"
    # an ordinary column goes through untouched
    rsi = alert_series.SERIES_FUNCS["rsi"]
    assert ias._probe_column(rsi, calendar, {}) == rsi(calendar, {})
    assert ias._probe_column(rsi, instant, {}) == rsi(instant, {})
    # the two measured sets did not move
    monkeypatch.setattr(ias, "_INSTANT_ONLY_CACHE", None)
    monkeypatch.setattr(ias, "_CLOSED_LANE_DEAD_CACHE", None)
    assert ias.instant_only_addresses() == frozenset({"vwap"})
    assert ias.closed_lane_dead_addresses() == frozenset({"ichimoku.chikou"})
    assert ias._is_calendar_encoded(calendar) and not ias._is_calendar_encoded(instant)


def test_the_probe_seam_is_injectable_and_leaves_no_pass_behind(monkeypatch):
    instant, calendar = ias._probe_series()
    bench = [{"t": b["t"], "c": b["c"] * (1.0 + 0.002 * i)} for i, b in enumerate(calendar)]
    store = _Store({"SPY": bench})
    monkeypatch.setattr(ias, "_PROBE_BENCHMARK_FETCH", store)
    fn = alert_series.SERIES_FUNCS["rs_line.ma"]
    col = ias._probe_column(fn, calendar, {})
    assert store.calls == [("SPY", "D", len(calendar))]
    assert col == _expected("rs_line.ma", calendar, bench, {})
    assert ars.current_pass() is None
    # the default seam derives its benchmark from the probe bars: same `t`s, a moving ratio
    monkeypatch.setattr(ias, "_PROBE_BENCHMARK_FETCH", None)
    fetch = ias._probe_benchmark_fetcher(calendar)
    served = fetch("SPY", "D", len(calendar))
    assert [b["t"] for b in served] == [b["t"] for b in calendar]
    assert len({round(s["c"] / b["c"], 9) for s, b in zip(served, calendar)}) > 1
    assert fetch("SPY", "D", 10) == served[-10:]
