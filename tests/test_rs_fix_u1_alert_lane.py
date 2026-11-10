"""2026-11-07 — RS Phase 2a/2b review, unit U1 (the alert lane).

One regression per confirmed finding, each written to FAIL on the branch head
(cb97c86931) and pass after the fix:

* #1  (critical) the pass memo key left out the symbol, so two tickers on the
      same dates with the same last close shared one RS column set.
* #2  the RS catalog and the create door were not dark; the rating armed with
      its table dark.
* #10 every RS alert recomputed the full window every cycle (closed window +
      cross-cycle cache).
* #17 a self-benchmark alert was accepted and diagnosed as "warming up".
* #28 the shadow cycle evaluated RS alerts outside any pass.
* #29 /current-value always answered null for an RS address.
* #36 refusal sentences cited the plan and a table name.

No server, no store: injected benchmark readers, the TestClient with the auth
dependency overridden (the `tests/test_indicator_alert_service.py` idiom).
"""
from __future__ import annotations

import ast
import datetime as _dt
import math
import pathlib

import pytest

from api.services import alert_rs_series as ars
from api.services import alert_series
from api.services import alert_shadow_log
from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import relative_strength as rsm
from api.services import rs_benchmarks as rb
from api.services.indicator_compute import _round_series
from api.services.signature import registry_defs


# ─── fixtures ────────────────────────────────────────────────────────────────

def _weekdays(n, start=_dt.date(2022, 1, 3)):
    out, day = [], start
    while len(out) < n:
        if day.weekday() < 5:
            out.append(int(day.strftime("%Y%m%d")))
        day += _dt.timedelta(days=1)
    return out


def _bars(closes, times):
    return [{"t": t, "o": c - 0.3, "h": c + 1.0, "l": c - 1.2, "c": float(c), "v": 1_000_000 + i}
            for i, (t, c) in enumerate(zip(times, closes))]


N = 420
TIMES = _weekdays(N)
SPY = _bars([200.0 + 20.0 * math.sin(i / 5.0 + 1.0) + i * 0.03 for i in range(N)], TIMES)
_A = [100.0 + 12.0 * math.sin(i / 11.0) + i * 0.08 for i in range(N)]
_B = [80.0 + 9.0 * math.sin(i / 7.0 + 0.4) + i * 0.11 for i in range(N)]
_B[-1] = _A[-1]                     # ⭐ the collision: same dates, same LAST CLOSE to the cent
AAA = _bars(_A, TIMES)
BBB = _bars(_B, TIMES)


class _Store:
    """A counting `(ticker, tf, want) -> bars` benchmark reader."""

    def __init__(self, table=None):
        self.table = {k.upper(): v for k, v in (table or {"SPY": SPY}).items()}
        self.calls = []

    def __call__(self, ticker, tf, want):
        self.calls.append((str(ticker).upper(), str(tf), int(want)))
        bars = self.table.get(str(ticker).upper(), [])
        return bars[-int(want):] if int(want) < len(bars) else list(bars)


def _alone(address, bars, bench, params=None):
    spec = ars.RS_ADDRESS_SPECS[address]
    if spec.family == "phase1":
        cols = rsm.compute_phase1_columns(bars, bench, rsm.resolve_phase1_inputs(dict(params or {})))
    else:
        cols = rsm.compute_mansfield_columns(bars, bench, ars.mansfield_length(params or {}))
    col = list(cols[spec.column])
    return _round_series(col, 6) if spec.rounded else col


def _alert(address, sym="AAA", tf="D", params=None):
    cond = ev.ALERT_CONDITIONS[address][0]
    return {"id": 7, "user_id": "u", "sym": sym, "tf": tf, "indicator": address,
            "condition": cond["value"], "threshold": -1e12 if cond["needs_threshold"] else None,
            "params_json": params, "last_value": None}


@pytest.fixture(autouse=True)
def _isolated_cache():
    ars.clear_column_cache()
    yield
    ars.clear_column_cache()


@pytest.fixture
def lit(monkeypatch):
    """Both RS flags lit, deterministically (the catalog's ON shape)."""
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")


@pytest.fixture
def dark(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "0")


# ─── #1 (critical): the memo key names the symbol ───────────────────────────

@pytest.mark.parametrize("address", ["rs_line.value", "rs_line.ma", "rs_line.newHigh",
                                     "rs_line.mansfield"])
def test_two_tickers_with_equal_dates_and_last_close_get_their_own_columns_in_one_pass(address):
    assert AAA[-1]["c"] == BBB[-1]["c"] and AAA[0]["t"] == BBB[0]["t"] and len(AAA) == len(BBB)
    want_a, want_b = _alone(address, AAA, SPY), _alone(address, BBB, SPY)
    assert want_a != want_b, "the fixture must differ, or the test proves nothing"
    fn = alert_series.SERIES_FUNCS[address]
    with ars.rs_pass(fetch_bars=_Store()) as p:
        got_a = aus.call_series(fn, AAA, {}, tf="D", sym="AAA")
        got_b = aus.call_series(fn, BBB, {}, tf="D", sym="BBB")
        assert p.compute_calls == 2, "one compute per SYMBOL, not one for both"
    assert got_a == want_a
    assert got_b == want_b, "BBB was served AAA's column"


def test_the_collision_through_the_evaluator_in_one_default_pass(monkeypatch):
    """The cycle's own shape: one `rs_pass()` (default readers, the cross-cycle
    cache in play) and two alerts whose windows collide on the old key."""
    monkeypatch.setattr(ars, "default_fetch_bars", _Store())
    address = "rs_line.ma"          # the line itself is equal on the last bar; its average is not
    with ars.rs_pass():
        va, _t, ia = ev._evaluate_one_closed(_alert(address, "AAA"), AAA, now_epoch=_FAR)
        vb, _t, ib = ev._evaluate_one_closed(_alert(address, "BBB"), BBB, now_epoch=_FAR)
    assert va == _alone(address, AAA, SPY)[ia]
    assert vb == _alone(address, BBB, SPY)[ib]
    assert va != vb


_FAR = _dt.datetime(2030, 1, 1, tzinfo=_dt.timezone.utc).timestamp()


# ─── #10: the closed window, and a cache that outlives the cycle ────────────

def _forming(bars, close):
    """`bars` plus one more bar on the next weekday — a forming bar."""
    nxt = _weekdays(1, _dt.date(int(str(bars[-1]["t"])[:4]), int(str(bars[-1]["t"])[4:6]),
                               int(str(bars[-1]["t"])[6:])) + _dt.timedelta(days=1))[0]
    return list(bars) + [{"t": nxt, "o": close, "h": close, "l": close, "c": float(close), "v": 1}]


def test_the_closed_lane_computes_an_rs_column_on_the_closed_window(monkeypatch):
    seen = []
    real = rsm.compute_phase1_columns
    monkeypatch.setattr(rsm, "compute_phase1_columns",
                        lambda bars, *a, **k: seen.append(len(bars)) or real(bars, *a, **k))
    stock = _forming(AAA, 150.0)
    bench = _forming(SPY, 260.0)
    monkeypatch.setattr(ev, "closed_bar_index", lambda bars, tf, now: len(bars) - 2)
    with ars.rs_pass(fetch_bars=_Store({"SPY": bench})):
        value, _trig, i = ev._evaluate_one_closed(_alert("rs_line.value"), stock, now_epoch=_FAR)
    assert i == len(stock) - 2
    assert seen == [i + 1], "the forming bar was part of the computed window"
    # …and the number at the judged bar is the full window's number there
    assert value == _alone("rs_line.value", stock, bench)[i]


def test_the_closed_window_keeps_the_full_benchmark_overlap():
    """The benchmark's newest bar is past the closed window; the lane reads that
    many more so the window's FIRST bar keeps its ratio."""
    stock = _forming(AAA, 150.0)
    bench = _forming(SPY, 260.0)
    store = _Store({"SPY": bench})
    closed = stock[:-1]
    with ars.rs_pass(fetch_bars=store):
        col = aus.call_series(alert_series.SERIES_FUNCS["rs_line.value"], closed, {}, tf="D", sym="AAA")
    assert col == _alone("rs_line.value", closed, SPY)
    assert col[0] is not None, "the window's first bar lost its benchmark close"
    assert store.calls[-1] == ("SPY", "D", len(closed) + 1)


def test_the_cross_cycle_cache_serves_the_next_cycle_while_the_forming_close_moves(monkeypatch):
    computes = []
    real = rsm.compute_phase1_columns
    monkeypatch.setattr(rsm, "compute_phase1_columns",
                        lambda *a, **k: computes.append(1) or real(*a, **k))
    monkeypatch.setattr(ev, "closed_bar_index", lambda bars, tf, now: len(bars) - 2)
    results = []
    for tick, (px, bx) in enumerate(((150.0, 260.0), (151.5, 258.0), (149.0, 262.5))):
        monkeypatch.setattr(ars, "default_fetch_bars", _Store({"SPY": _forming(SPY, bx)}))
        with ars.rs_pass():          # a fresh cycle each time, as `_run_one_cycle` opens one
            results.append(ev._evaluate_one_closed(_alert("rs_line.newHigh"),
                                                   _forming(AAA, px), now_epoch=_FAR))
    assert len(computes) == 1, f"recomputed every cycle: {len(computes)} computes"
    assert results[0] == results[1] == results[2]
    assert ars.column_cache_stats()["hits"] == 2


def test_the_cross_cycle_cache_is_keyed_on_symbol_and_content_and_bounded(monkeypatch):
    monkeypatch.setattr(ars, "default_fetch_bars", _Store())
    fn = alert_series.SERIES_FUNCS["rs_line.value"]
    with ars.rs_pass():
        a = aus.call_series(fn, AAA, {}, tf="D", sym="AAA")
    with ars.rs_pass():
        b = aus.call_series(fn, BBB, {}, tf="D", sym="BBB")
        a2 = aus.call_series(fn, AAA, {}, tf="D", sym="AAA")
    assert a == a2 == _alone("rs_line.value", AAA, SPY)
    assert b == _alone("rs_line.value", BBB, SPY)
    # a corrected close on the same dates is a different entry, never the old one
    fixed = [dict(x) for x in AAA]
    fixed[-5]["c"] += 1.0
    with ars.rs_pass():
        assert aus.call_series(fn, fixed, {}, tf="D", sym="AAA") == _alone("rs_line.value", fixed, SPY)
    # an injected reader (a test, the probes) never touches the shared cache
    before = ars.column_cache_stats()
    with ars.rs_pass(fetch_bars=_Store()):
        aus.call_series(fn, AAA, {}, tf="D", sym="AAA")
    assert ars.column_cache_stats() == before
    monkeypatch.setattr(ars, "RS_COLUMN_CACHE_MAX", 2)
    with ars.rs_pass():
        for k in range(4):
            aus.call_series(fn, AAA[k:], {}, tf="D", sym="AAA")
    assert ars.column_cache_stats()["entries"] == 2


# ─── #2: dark by default; registration unconditional ────────────────────────

def test_the_catalog_carries_no_rs_group_while_rs_v2_is_dark(dark):
    bases = [e["indicator"] for e in ev.alert_catalog()]
    assert "rs_line" not in bases
    # …while registration stays: every address still resolves and evaluates
    assert all(a in ev.all_addresses() for a in ev.RS_ADDRESSES)
    assert all(alert_series.SERIES_FUNCS.get(a) is ars.RS_SERIES[a] for a in ev.RS_ADDRESSES)
    assert all(ev.value_function(a) is not None for a in ev.RS_ADDRESSES)


def test_v2_lit_offers_the_eleven_and_the_rating_waits_for_its_table(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "0")
    entry = {e["indicator"]: e for e in ev.alert_catalog()}["rs_line"]
    values = [p["value"] for p in entry["plots"]]
    # 2026-11-10 (RS split, S2): 11 -> 8, the three Mansfield addresses are withheld from the offer
    assert len(values) == 8 and ars.RS_RATING_ADDRESS not in values
    assert not set(values) & set(ars.RS_WITHHELD_ADDRESSES)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    entry = {e["indicator"]: e for e in ev.alert_catalog()}["rs_line"]
    assert [p["value"] for p in entry["plots"]] == [
        a for a in ev.RS_ADDRESSES if a.startswith("rs_line.") and a not in ars.RS_WITHHELD_ADDRESSES]


def test_the_rating_gate_reads_rs_history_enabled_and_needs_v2(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    assert ev.rs_rating_offered() is False, "the rating rides on V2"
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    assert ev.rs_rating_offered() is True
    monkeypatch.setenv("RS_HISTORY_ENABLED", "yes")
    assert ev.rs_rating_offered() is False, "only '1' arms it (the one reader's rule)"


def test_the_door_refuses_every_rs_address_while_dark_in_a_sentence(dark):
    for a in ev.RS_ADDRESSES:
        cond = ev.ALERT_CONDITIONS[a][0]
        why = ias.refusal_for(a, cond["value"], "D", 0.0)
        # 2026-11-10 (RS split, S2): a withheld Mansfield address is refused with its own
        # sentence whatever the flags say (the withheld gate answers first).
        anchor = ias.REFUSAL_RS_WITHHELD if a in ars.RS_WITHHELD_ADDRESSES else ias.REFUSAL_RS_NOT_OFFERED
        assert why is not None and anchor in why, a
    assert "rating" in ias.refusal_for(ars.RS_RATING_ADDRESS, "above", "D", 90.0)
    assert ias.refusal_for("rsi", "above", "D", 70.0) is None, "every other address is unmoved"


def test_the_door_refuses_the_rating_while_its_table_is_dark(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "0")
    why = ias.refusal_for(ars.RS_RATING_ADDRESS, "above", "D", 90.0)
    assert why is not None and ias.REFUSAL_RS_NOT_OFFERED in why
    assert ias.refusal_for("rs_line.newHigh", "above", "D", None) is None


def test_the_route_refuses_a_dark_rs_create(client, dark):
    r = client.post("/api/indicator-alerts", json={
        "sym": "AAPL", "indicator": "rs_line.newHigh", "condition": "above",
        "threshold": 0.5, "tf": "D"})
    assert r.status_code == 400 and ias.REFUSAL_RS_NOT_OFFERED in r.text


def test_the_new_anchors_are_disjoint_from_every_other_gate(monkeypatch, lit):
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    lit_messages = {
        "condition": ias.refusal_for("rsi", "nonsense", "5", 70.0),
        "timeframe": ias.refusal_for("vwap", "above", "D", 400.0),
        "level": ias.refusal_for("rsi", "above", "5", None),
        "displaced": ias.refusal_for("ichimoku.chikou", "above", "5", 0.0),
        "rs_timeframe": ias.refusal_for("rs_line.newHigh", "above", "5", None),
        "rs_self": ias.refusal_for("rs_line.newHigh", "above", "D", None, sym="SPY"),
    }
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    messages = {**lit_messages, "rs_dark": ias.refusal_for("rs_line.newHigh", "above", "D", None)}
    anchors = {
        "condition": ias.REFUSAL_UNJUDGEABLE_CONDITION,
        "timeframe": ias.REFUSAL_INTRADAY_ONLY,
        "level": ias.REFUSAL_NO_LEVEL,
        "displaced": ias.CLOSED_LANE_TRAILING_PAD,
        "rs_timeframe": ias.REFUSAL_RS_TIMEFRAME,
        "rs_self": ias.REFUSAL_RS_SELF_BENCHMARK,
        "rs_dark": ias.REFUSAL_RS_NOT_OFFERED,
    }
    assert all(messages.values())
    for gate, anchor in anchors.items():
        for other, message in messages.items():
            assert (anchor in message) is (gate == other), (gate, other)


# ─── #17: a benchmark that can never value ──────────────────────────────────

def test_the_door_refuses_a_symbol_measured_against_itself(lit, monkeypatch):
    why = ias.refusal_for("rs_line.newHigh", "above", "D", None, sym="SPY")
    assert why is not None and ias.REFUSAL_RS_SELF_BENCHMARK in why and "SPY" in why
    why = ias.refusal_for("rs_line.value", "above", "W", 0.01, sym="qqq", params={"benchmark": "QQQ"})
    assert why is not None and ias.REFUSAL_RS_SELF_BENCHMARK in why
    assert ias.refusal_for("rs_line.newHigh", "above", "D", None, sym="AAPL") is None
    assert ias.refusal_for("rs_line.newHigh", "above", "D", None, sym="QQQ") is None
    # an ETF on SECTOR resolves to SPY (the chart's own rule)
    monkeypatch.setattr(rb, "_groups_for", lambda sym: {"sector": "Financial", "industry": rb.ETF_INDUSTRY})
    why = ias.refusal_for("rs_line.newHigh", "above", "D", None, sym="SPY", params={"benchmark": "SECTOR"})
    assert why is not None and "SECTOR" in why
    # the rating reads no benchmark
    assert ias.refusal_for(ars.RS_RATING_ADDRESS, "above", "D", 90.0, sym="SPY") is None
    # without a symbol (the taxonomy caller) the gate is not asked
    assert ias.refusal_for("rs_line.newHigh", "above", "D", None) is None


def test_the_route_passes_the_symbol_to_the_door(client, lit):
    r = client.post("/api/indicator-alerts", json={
        "sym": "spy", "indicator": "rs_line.newHigh", "condition": "above",
        "threshold": 0.5, "tf": "D"})
    assert r.status_code == 400 and ias.REFUSAL_RS_SELF_BENCHMARK in r.text


def test_diagnose_names_a_self_benchmark_and_an_empty_benchmark_as_faults():
    with ars.rs_pass(fetch_bars=_Store()):
        is_fault, detail = ias.diagnose(_alert("rs_line.newHigh", sym="SPY"), SPY)
    assert is_fault is True and "resolves to the symbol itself" in detail
    assert "not enough history" not in detail
    with ars.rs_pass(fetch_bars=_Store({"SPY": []})):
        is_fault, detail = ias.diagnose(_alert("rs_line.newHigh", sym="AAA"), AAA)
    assert is_fault is True and "no stored bars for the benchmark SPY" in detail
    # a healthy one is untouched, and warming is still not a fault
    with ars.rs_pass(fetch_bars=_Store()):
        assert ias.diagnose(_alert("rs_line.newHigh", sym="AAA"), AAA) == (False, None)
        is_fault, detail = ias.diagnose(_alert("rs_line.ma", sym="AAA"), AAA[:5])
    assert is_fault is False and "not enough history" in detail


# ─── #28: the shadow cycle opens one RS pass ────────────────────────────────

def test_the_shadow_cycle_wraps_its_group_loop_in_one_rs_pass():
    src = pathlib.Path(alert_shadow_log.__file__).read_text(encoding="utf-8")
    fns = {n.name: n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef)}
    withs = [n for n in ast.walk(fns["run_shadow_cycle"]) if isinstance(n, ast.With)
             and any(ast.unparse(i.context_expr) == "alert_rs_series.rs_pass()" for i in n.items)]
    assert len(withs) == 1, "the shadow cycle does not open exactly one RS pass"
    loops = [n for n in ast.walk(withs[0]) if isinstance(n, ast.For)
             and ast.unparse(n.iter) == "groups.items()"]
    assert len(loops) == 1, "the group loop is not inside the RS pass"


# ─── #29: the prefill answers the closed-lane number ────────────────────────

def test_current_value_prefills_an_rs_address_with_the_closed_lane_number(client, monkeypatch):
    monkeypatch.setattr(ev, "_fetch_bars_for_alert", lambda sym, tf, count=400: list(AAA))
    monkeypatch.setattr(ars, "default_fetch_bars", _Store())
    r = client.get("/api/indicator-alerts/current-value",
                   params={"sym": "aaa", "tf": "D", "indicator": "rs_line.value"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["value"] == _alone("rs_line.value", AAA, SPY)[-1]
    assert body["value"] is not None
    # a refused timeframe is an honest null, never a 500
    r = client.get("/api/indicator-alerts/current-value",
                   params={"sym": "AAA", "tf": "5", "indicator": "rs_line.value"})
    assert r.status_code == 200 and r.json()["value"] is None


# ─── #36: member sentences carry no internal references ─────────────────────

@pytest.mark.parametrize("tf", ["1", "5", "15", "30", "60", "M", "W", "H"])
def test_refusal_sentences_cite_no_plan_section_and_no_table(tf):
    for address in ("rs_line.newHigh", ars.RS_RATING_ADDRESS):
        why = ars.timeframe_refusal(tf, address)
        if why is None:
            continue
        assert "plan" not in why and "§" not in why, why
        assert "`" not in why and "rs_rating_history" not in why, why
    assert "the chart blanks RS events intraday" in ars.timeframe_refusal("5", "rs_line.newHigh")
    assert ("the rating is computed nightly from daily closes, one per session, so a weekly "
            "bar has no rating of its own") in ars.timeframe_refusal("W", ars.RS_RATING_ADDRESS)


# ─── the TestClient (the service test file's idiom) ─────────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user

    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    ias.init_schema()
    app.dependency_overrides[get_current_user] = lambda: {"id": "user-abc", "email": "abc@test",
                                                           "role": "member"}
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
