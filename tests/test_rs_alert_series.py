"""Rails for the UCT Relative Strength ALERT SERIES (unit 2b-04 of the Phase 2
engineering map, §2.6): `api/services/alert_rs_series.py`, the `reads_benchmark`
branch of `alert_user_series.call_series`, the append to
`alert_series.SERIES_FUNCS`, and the service's probe seam.

Modelled on `test_alert_ma_cross.py`: every expected column comes from
`relative_strength.compute_phase1_columns` / `compute_mansfield_columns`
THEMSELVES, never from a formula typed here; the benchmark is an injected,
counting fetcher; no server, no store. The evaluator partition, catalog rows and
labels are unit 2b-05's and are not asserted here.

2026-11-07 (RS 2b-06): the last section rails `rs_line.rating` — the twelfth
address, read from the `rs_rating_history` side table (a real `screener.db` in
`tmp_path`, the 2a-03 fixture idiom) and aligned to daily bars by session date;
daily only; one history read per ticker per pass; the probe seam's injected /
derived history.
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

# 2026-11-07 (RS fix U1, review #2) -- PIN MOVED. The RS alert catalog and the
# create door now follow `registry_defs.RS_V2_ENABLED` (and, for `rs_line.rating`,
# `api.main.rs_history_enabled()`), dark by default; registration is unchanged.
# The pins in this file describe the LIT shape, so both flags are lit here,
# deterministically. The dark shape is railed in tests/test_rs_fix_u1_alert_lane.py.
@pytest.fixture(autouse=True)
def _rs_alert_flags_lit(monkeypatch):
    from api.services.signature import registry_defs as _rs_flag_defs
    monkeypatch.setattr(_rs_flag_defs, "RS_V2_ENABLED", True)
    import api.main  # noqa: F401 -- import BEFORE lighting RS_SPLIT_ENABLED: api.main registers providers for the split rows, which registry_defs only built if the flag was on at ITS import
    monkeypatch.setattr(_rs_flag_defs, "RS_SPLIT_ENABLED", True)  # 2026-11-10 (RS split, S2): the lit shape includes the split alerts
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")


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


# ─── 2026-11-07 (RS 2b-06): the rating's side-table shapes ──────────────────

RATING = "rs_line.rating"
FAR = _dt.datetime(2030, 1, 1, tzinfo=_dt.timezone.utc).timestamp()


def _iso(t):
    """``20240102`` → ``"2024-01-02"``, the side table's session key."""
    return f"{t // 10000:04d}-{(t // 100) % 100:02d}-{t % 100:02d}"


class _Ratings:
    """A counting `(ticker, limit) -> rows` reader — the injected rating history."""

    def __init__(self, rows):
        self.rows = list(rows)
        self.calls = []

    def __call__(self, ticker, limit):
        self.calls.append((str(ticker).upper(), int(limit)))
        return self.rows[:int(limit)]


def _rating_rows(bars, rating):
    """`rs_history.ticker_history`'s shape (newest session first): one row per bar,
    ``ibd = rating(i)`` (``None`` is a stored-but-unrated row)."""
    return [{"session": _iso(int(b["t"])), "ibd": rating(i)} for i, b in enumerate(bars)][::-1]


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
    # 2026-11-10 (RS split, S2): 16 = the 12 `rs_line.*` + the 4 split addresses, appended after the rating
    # 2026-11-12 (RS Exit Warnings): 19 = those + the 3 `rs_exit.*` warnings, appended after the split four
    assert len(ars.RS_ADDRESSES) == 19 and all(a.startswith("rs_line.") for a in ars.RS_ADDRESSES[:12])
    assert ars.RS_ADDRESSES[11] == "rs_line.rating" == ars.RS_RATING_ADDRESS, "2b-06: the rating closes the rs_line block"
    assert ars.RS_ADDRESSES[12:] == ars.RS_SPLIT_ADDRESSES
    assert len(ars.RS_ADDRESS_SPECS) == 11 and "rs_line.rating" not in ars.RS_ADDRESS_SPECS, \
        "the eleven COMPUTE-backed specs; the rating is read, not computed"
    assert set(ars.RS_ADDRESSES) == set(ars.RS_ADDRESS_SPECS) | {"rs_line.rating"} | set(ars.RS_SPLIT_SPECS)
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

# 2026-11-07 (RS 2b-06): the eleven COMPUTE-backed addresses — the rating has no
# chart compute to equal (its own section, at the end of this file).
@pytest.mark.parametrize("address", tuple(ars.RS_ADDRESS_SPECS))
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
    ratings = _Ratings([])                                          # 2026-11-07 (RS 2b-06): nor the history
    monkeypatch.setattr(ars, "default_read_ratings", ratings)
    fn = alert_series.SERIES_FUNCS[address]
    blank = [None] * len(STOCK)
    assert fn(STOCK, {}) == blank                                   # the forming lane's call shape
    assert aus.call_series(fn, STOCK, {}) == blank                  # `call_series` without tf/sym
    assert aus.call_series(fn, STOCK, {}, tf="D") == blank          # a timeframe alone is not enough
    assert alert_series.series_for(address, STOCK, {}) == blank     # a right-hand operand's read
    assert ev._value_of(address)(STOCK, {}) is None                 # the forming-lane value function
    assert store.calls == [] and ratings.calls == [], "nothing was fetched, nothing was read"
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


# ─── 2026-11-07 (RS 2b-06): the rating — read from the side table, daily only ──

import sqlite3  # noqa: E402

from api.services.screener import rs_history as rh  # noqa: E402
from api.services.screener import snapshot_db as _snapshot_db  # noqa: E402


@pytest.fixture
def side_table(tmp_path, monkeypatch):
    """A `screener.db` in tmp, the 2a-03 fixture idiom: `SCREENER_DB_PATH` →
    `snapshot_db.connect()` → `rs_history`. Rows go in through
    `rh.store_rows` (which runs `ensure_schema`); the alert lane only reads."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    assert _snapshot_db.get_db_path() == str(path)
    return path


def test_the_rating_spec_declares_its_shape():
    fn = alert_series.SERIES_FUNCS[RATING]
    assert fn is ars.RS_SERIES[RATING] and alert_series.series_function(RATING) is fn
    assert fn.reads_benchmark is True, "the (tf, sym) call shape `call_series` routes on"
    assert fn.reads_rating is True, "what it actually reads"
    assert fn.timeframes == ("D",) == ars.RS_RATING_TFS
    assert fn.inputs == {} and fn.input_options == {} and alert_series.address_inputs(RATING) == {}
    assert fn.instance_defs == ["rsLine"]
    assert fn.lookback({}) == 0 and alert_series.address_lookback(RATING, {}) == 0
    assert fn.describe({}) == "" and fn.rs_kind == "rating" and fn.rs_column == "ibd"
    assert fn.validate({"benchmark": "INDUSTRY"}) is None, "no knobs: nothing to refuse"
    assert fn.validate({}, "cross_above") is None and fn.normalize({"x": 1}) == {"x": 1}
    assert ars.RATING_READ_PAD == 40
    assert ars.address_timeframes(RATING) == ("D",)
    assert ars.address_timeframes("rs_line.newHigh") == ars.address_timeframes(None) == ("D", "W")
    # no declared lookback: the evaluator's window is the lane's floor
    assert ev.bars_needed_for_alert({"indicator": RATING, "sym": "TEST", "tf": "D",
                                     "params_json": None}) == ev.BARS_MIN
    # the compute-side helpers do not know it: it is not an `RsSpec`
    with pytest.raises(KeyError):
        ars.build_rs_series(RATING, STOCK, SPY, {})


def test_the_rating_series_is_the_stored_row_for_the_bars_own_session(side_table):
    """Aligned by calendar date to a REAL side table: a gap session is None, an
    unrated row is None, and a later session never leaks backwards."""
    window = STOCK[-30:]
    gap, unrated = 10, 20
    for i, b in enumerate(window):
        if i == gap:
            continue
        rh.store_rows(_iso(b["t"]), {"TEST": {"ibd": None if i == unrated else 40 + i, "bars": 253}})
    # …and a session AFTER the window's newest bar, which must reach no bar
    rh.store_rows(_iso(_weekdays(N + 1)[-1]), {"TEST": {"ibd": 99, "bars": 253}})
    fn = alert_series.SERIES_FUNCS[RATING]
    with ars.rs_pass(fetch_bars=_Store()) as p:
        got = aus.call_series(fn, window, {}, tf="D", sym="TEST")      # the DEFAULT reader: the table
        assert p.rating_calls == 1
    assert len(got) == len(window)
    assert got[gap] is None and got[unrated] is None
    assert got[gap - 1] == 40 + gap - 1 and got[gap + 1] == 40 + gap + 1, "no fill across the gap"
    assert got[-1] == 40 + len(window) - 1 and 99 not in got, "a later session never leaks backwards"
    assert all(v is None or (isinstance(v, int) and 1 <= v <= 99) for v in got)
    assert [v for v in got if v is not None] == [40 + i for i in range(len(window)) if i not in (gap, unrated)]
    # the pure builder with the rows in hand gives the same column; an instant
    # encoding is never aligned by guesswork; an empty window is empty
    rows = rh.ticker_history("TEST", limit=100)
    assert ars.build_rs_rating_series(window, rows) == got
    assert ars.build_rs_rating_series([{"t": 1_700_000_000, "c": 1.0}], rows) == [None]
    assert ars.build_rs_rating_series([], rows) == [] and fn([], {}, tf="D", sym="TEST") == []
    assert ars.default_read_ratings("TEST", 5) == rows[:5]
    # the lower-case symbol reads the same rows (the table stores upper-case)
    with ars.rs_pass(fetch_bars=_Store()):
        assert aus.call_series(fn, window, {}, tf="D", sym="test") == got
    # the evaluator's closed lane reads the stored value at the judged bar
    alert = {"id": 1, "user_id": "u", "sym": "TEST", "tf": "D", "indicator": RATING,
             "condition": "above", "threshold": 50.0, "params_json": None, "last_value": None}
    with ars.rs_pass(fetch_bars=_Store()):
        assert ev._evaluate_one_closed(alert, window, now_epoch=FAR) == (got[-1], True, len(window) - 1)
        assert ias.diagnose(alert, window) == (False, None)


def test_without_a_table_the_rating_is_none_everywhere_and_the_table_is_never_created(side_table):
    """The web pod's nightly creates the table on first WRITE; the alert lane
    only reads — on a box without it (the worker, a fresh volume) the column is
    None everywhere, nothing raises, and nothing is created."""
    fn = alert_series.SERIES_FUNCS[RATING]
    with ars.rs_pass(fetch_bars=_Store()):
        assert aus.call_series(fn, STOCK, {}, tf="D", sym="TEST") == [None] * len(STOCK)
    assert ars.default_read_ratings("TEST", 10) == []
    tables = set()
    if side_table.exists():
        with sqlite3.connect(str(side_table)) as conn:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert rh.TABLE not in tables, "the alert lane must never create the side table"
    # the closed lane reads None as "no fire"; `diagnose` names the missing session
    alert = {"id": 1, "user_id": "u", "sym": "TEST", "tf": "D", "indicator": RATING,
             "condition": "above", "threshold": 50.0, "params_json": None, "last_value": None}
    with ars.rs_pass(fetch_bars=_Store()):
        assert ev._evaluate_one_closed(alert, STOCK, now_epoch=FAR) == (None, False, len(STOCK) - 1)
        is_fault, detail = ias.diagnose(alert, STOCK)
    assert is_fault is False and "no stored rating for TEST on " + _iso(TIMES[-1]) in detail


def test_the_rating_is_daily_only_and_the_eleven_stay_daily_or_weekly():
    fn = alert_series.SERIES_FUNCS[RATING]
    ratings = _Ratings(_rating_rows(STOCK, lambda i: 50))
    for tf in ("D", "1D", "d"):
        assert ars.timeframe_refusal(tf, RATING) is None, tf
        assert ias.refusal_for(RATING, "cross_above", tf, 90.0) is None, tf
        with ars.rs_pass(fetch_bars=_Store(), read_ratings=ratings):
            assert aus.call_series(fn, STOCK[-5:], {}, tf=tf, sym="TEST") == [50] * 5
    untouched = _Ratings([])
    for tf in ("W", "1W", "w", "5", "60", "M", "1M", "H", ""):
        why = ars.timeframe_refusal(tf, RATING)
        assert why is not None and "closed daily bars only" in why, tf
        assert "Arm it on D." in why and "or weekly" not in why, tf
        assert ias.REFUSAL_RS_TIMEFRAME in why, "the service's one anchor"
        assert ias.refusal_for(RATING, "cross_above", tf, 90.0) == why, tf
        with ars.rs_pass(fetch_bars=_Store(), read_ratings=untouched):
            with pytest.raises(ars.RsTimeframeRefused) as ei:
                aus.call_series(fn, STOCK, {}, tf=tf, sym="TEST")
        assert str(ei.value) == why and ei.value.address == RATING and ei.value.tf == tf
    assert untouched.calls == [], "refused BEFORE the history is read"
    assert "daily closes" in ars.timeframe_refusal("W", RATING)
    assert "weekly bar has no rating of its own" in ars.timeframe_refusal("W", RATING)
    assert "5-minute bar" in ars.timeframe_refusal("5", RATING)
    assert "monthly" in ars.timeframe_refusal("M", RATING)
    # the eleven are unmoved: W offered, the daily-or-weekly sentence otherwise
    for a in ars.RS_ADDRESS_SPECS:
        assert ars.timeframe_refusal("W", a) is None and ars.timeframe_refusal("D", a) is None
        assert "daily or weekly bars only" in ars.timeframe_refusal("5", a)
        assert ias.REFUSAL_RS_TIMEFRAME in ars.timeframe_refusal("5", a)
        if a in ars.RS_WITHHELD_ADDRESSES:
            # 2026-11-10 (RS split, S2): withheld from the offer, so the door refuses a NEW
            # alert with the withheld sentence (and not the timeframe one) -- see
            # tests/test_rs_split_alerts.py for both halves.
            assert ias.REFUSAL_RS_WITHHELD in ias.refusal_for(a, ev.ALERT_CONDITIONS[a][0]["value"], "W", 0.0)
            continue
        assert ias.refusal_for(a, ev.ALERT_CONDITIONS[a][0]["value"], "W", 0.0) is None


def test_the_history_is_read_once_per_pass_for_three_alerts_on_one_ticker():
    fn = alert_series.SERIES_FUNCS[RATING]
    ratings = _Ratings(_rating_rows(STOCK, lambda i: 1 + (i * 7) % 99))
    want = ars.build_rs_rating_series(STOCK, ratings.rows)
    assert len(set(want)) > 1 and None not in want
    store = _Store()
    with ars.rs_pass(fetch_bars=store, read_ratings=ratings) as p:
        for params in ({}, {"benchmark": "QQQ"}, {"anything": 1}):      # three alerts, one ticker
            assert aus.call_series(fn, STOCK, params, tf="D", sym="TEST") == want
        assert ratings.calls == [("TEST", N + ars.RATING_READ_PAD)] and p.rating_calls == 1
        assert store.calls == [], "the rating reads no benchmark"
        # a smaller window on the same ticker is served from the read already made
        assert aus.call_series(fn, STOCK[-100:], {}, tf="D", sym="TEST") == want[-100:]
        assert p.rating_calls == 1
        # another ticker is its own read; a compute column beside it reads no history
        aus.call_series(fn, OTHER, {}, tf="D", sym="ABC")
        aus.call_series(alert_series.SERIES_FUNCS["rs_line.value"], STOCK, {}, tf="D", sym="TEST")
        assert [c[0] for c in ratings.calls] == ["TEST", "ABC"] and p.rating_calls == 2
        assert store.calls == [("SPY", "D", N)]
    # a NEW pass reads again (no stale row outlives the pass it was read in)
    with ars.rs_pass(fetch_bars=store, read_ratings=ratings):
        aus.call_series(fn, STOCK, {}, tf="D", sym="TEST")
    assert len(ratings.calls) == 3
    # the memo's serve-or-reread rule, on the pass directly (the `fetch` rule)
    short = _Ratings(ratings.rows[:50])
    p = ars.RsPass(store, short)
    assert p.ratings("TEST", 30) == short.rows[:30] and short.calls == [("TEST", 30)]
    assert p.ratings("test", 20) == short.rows[:30] and len(short.calls) == 1, "smaller: served"
    assert p.ratings("TEST", 80) == short.rows[:50] and len(short.calls) == 2, "larger: re-read"
    assert p.ratings("TEST", 200) == short.rows[:50] and len(short.calls) == 2, "the table has no more"
    assert ars.RsPass(store).read_ratings is ars.default_read_ratings
    # nested without a reader of its own a pass joins the outer one; a reader names a new one
    with ars.rs_pass(fetch_bars=store, read_ratings=ratings) as outer:
        with ars.rs_pass() as inner:
            assert inner is outer
        with ars.rs_pass(read_ratings=_Ratings([])) as fresh:
            assert fresh is not outer and fresh.fetch_bars is ars.default_fetch_bars
        with ars.rs_pass(fetch_bars=store) as fresh2:
            assert fresh2 is not outer and fresh2.read_ratings is ars.default_read_ratings
    assert ars.current_pass() is None


def test_the_catalog_offers_the_rating_as_a_level_with_default_90_printed_as_an_integer():
    entry = {e["indicator"]: e for e in ev.alert_catalog()}["rs_line"]      # renders: no KeyError
    plot = entry["plots"][-1]
    assert plot["value"] == RATING and plot["label"] == "RS rating (IBD-style)" == ev.ALERT_LABELS[RATING]
    assert [c["value"] for c in plot["conditions"]] == ["above", "below", "cross_above", "cross_below"]
    assert all(c["needs_threshold"] for c in plot["conditions"])
    assert plot["default_threshold"] == 90.0 == ev._DEFAULT_THRESHOLDS[RATING]
    assert plot["inputs"] == {} and "input_options" not in plot and plot["instance_defs"] == ["rsLine"]
    assert plot["instance_label"] == ev.instance_label(RATING) == "RS rating (IBD-style)", "no knobs, no suffix"
    assert ev.instance_label("rs_line.ma") == "RS line average (vs SPY · EMA(21))", "the eleven keep theirs"
    assert ev.value_decimals(RATING) == 0 == ev.ALERT_VALUE_DECIMALS[RATING]
    assert ev.format_alert_value(RATING, 91) == "91" and ev.format_alert_value(RATING, 90.0) == "90"
    assert RATING in ev.RS_FUNCS and RATING in ev.CLOSED_ONLY_ADDRESSES and RATING not in ev.INDICATOR_FUNCS
    assert ev.resolve_address("RS_LINE.RATING") == RATING and ev._lane_for(RATING, "forming") == "closed"
    assert ev.params_refusal(RATING, "cross_above", {}) is None
    assert "offers above, below, cross_above, cross_below" in ev.params_refusal(RATING, "cross_zero", {})
    assert not any((RATING, c) in ev.THRESHOLD_OPERAND for c in ("above", "below", "cross_above", "cross_below"))
    # the soak matrix arms it at its default, through the catalog
    from tools import alert_soak_matrix as soak
    assert [s for s in soak.catalog_addresses() if s["address"] == RATING] == \
        [{"address": RATING, "condition": "above", "threshold": 90.0}]


def test_the_probe_seam_carries_a_rating_history_injected_or_derived(monkeypatch):
    instant, calendar = ias._probe_series()
    fn = alert_series.SERIES_FUNCS[RATING]
    # derived: one row per calendar bar, so the probe measures the column's own alignment
    monkeypatch.setattr(ias, "_PROBE_RATING_READ", None)
    col = ias._probe_column(fn, calendar, {})
    assert len(col) == len(calendar) and all(isinstance(v, int) and 1 <= v <= 99 for v in col)
    assert len(set(col)) > 1 and col[-1] is not None and ias.closed_lane_pad(RATING, calendar, {}) == 0
    read = ias._probe_rating_reader(calendar)
    rows = read("PROBE", len(calendar) + ars.RATING_READ_PAD)
    assert [r["session"] for r in rows] == [_iso(b["t"]) for b in calendar][::-1], "newest first"
    assert col == ars.build_rs_rating_series(calendar, rows)
    assert read("PROBE", 10) == rows[:10]
    assert ias._probe_rating_reader(instant)("PROBE", 10) == [], "no calendar, no rows"
    with pytest.raises(ars.RsTimeframeRefused):
        ias._probe_column(fn, instant, {})
    assert ias.closed_lane_pad(RATING, instant, {}) == 0, "a refusal is 'could not tell'"
    assert ars.current_pass() is None
    # injected: a test's own history wins, and the eleven do not read it
    ratings = _Ratings(_rating_rows(calendar, lambda i: 42))
    monkeypatch.setattr(ias, "_PROBE_RATING_READ", ratings)
    assert ias._probe_column(fn, calendar, {}) == [42] * len(calendar)
    assert ratings.calls == [("PROBE", len(calendar) + ars.RATING_READ_PAD)]
    ias._probe_column(alert_series.SERIES_FUNCS["rs_line.value"], calendar, {})
    assert len(ratings.calls) == 1
    # the two measured sets did not move, and every address still resolves on its probe
    monkeypatch.setattr(ias, "_INSTANT_ONLY_CACHE", None)
    monkeypatch.setattr(ias, "_CLOSED_LANE_DEAD_CACHE", None)
    assert ias.instant_only_addresses() == frozenset({"vwap"})
    assert ias.closed_lane_dead_addresses() == frozenset({"ichimoku.chikou"})
