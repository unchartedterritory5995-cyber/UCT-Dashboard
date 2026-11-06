"""Rails for the UCT Relative Strength server lane (plan §8, §12.3
`tests/test_rs_columns_provider.py`): the Python row in both flag states, the
clamping resolver, benchmark resolution, the provider's envelope, the intraday
rule, the bar count, and the route end to end with the v2 row installed.

The flag is read ONCE at import (`registry_defs.RS_V2_ENABLED`), so these tests
never reload the module: they build the v2 row with `_rs_line_row(True)` and
install it into the live registry for the duration of a test.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import signature as sig
from api.services import relative_strength as rsmod
from api.services import rs_benchmarks as rb
from api.services.signature import registry_defs as rd

# Reuse the router test module's app + paid-user fixtures (pytest discovers
# fixtures imported into a module's namespace).
from tests.test_signature_router import client, _paid_user  # noqa: F401


@pytest.fixture
def v2_row(monkeypatch):
    """Install the v2 row and flag for one test, restoring the import-time state."""
    row = rd._rs_line_row(True)
    monkeypatch.setitem(rd._BY_ID, "rsLine", row)
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    return row


def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": float(c), "v": 1} for i, c in enumerate(closes)]


# ── the row ────────────────────────────────────────────────────────────────

def test_v2_row_declares_the_phase1_columns_payload_and_clamped_inputs():
    row = rd._rs_line_row(True)
    assert row["version"] == 2 and row["compute"]["rev"] == 2
    assert row["columns"] == list(rsmod.PHASE1_COLUMNS)
    assert row["payload_keys"] == ["payload"]
    by_key = {i["key"]: i for i in row["inputs"]}
    assert set(by_key) == {"benchmark", "maLength", "maType", "lookback", "priceTolerance",
                           "redDayThreshold", "showNewHigh", "showNewHighBeforePrice", "shortHistoryDots"}
    for k in ("maLength", "lookback", "priceTolerance", "redDayThreshold"):
        assert "min" in by_key[k] and "max" in by_key[k], k
    assert "lineColor" not in by_key, "style inputs never reach the server"


def test_v1_row_is_the_shape_master_shipped():
    row = rd._rs_line_row(False)
    assert row["version"] == 1 and row["compute"]["rev"] == 1
    assert row["columns"] == ["rsLine"] and row["payload_keys"] == []
    assert [i["key"] for i in row["inputs"]] == ["benchmark"]


def test_the_installed_row_matches_the_flag():
    assert rd.definition("rsLine")["version"] == (2 if rd.RS_V2_ENABLED else 1)


def test_benchmark_vocabulary_grew_with_the_equal_weight_and_auto_options():
    assert rd.RS_LINE_BENCHMARKS == ("SPY", "RSP", "SECTOR", "QQQ", "IWM", "INDUSTRY")
    row = rd._rs_line_row(True)
    assert row["inputs"][0]["options"] == list(rd.RS_LINE_BENCHMARKS)


# ── the resolver clamps and coerces ────────────────────────────────────────

def test_resolve_inputs_clamps_numbers_and_coerces_bools(v2_row):
    out = rd.resolve_inputs("rsLine", {"lookback": 99999, "maLength": 0, "priceTolerance": "abc",
                                       "redDayThreshold": 5, "showNewHigh": "false",
                                       "shortHistoryDots": 1, "lineColor": "#fff"})
    assert out["lookback"] == 500 and out["maLength"] == 2
    assert out["priceTolerance"] == 2.0, "unparseable ⇒ the declared default"
    assert out["redDayThreshold"] == 0.0
    assert out["showNewHigh"] is False and out["shortHistoryDots"] is True
    assert "lineColor" not in out, "undeclared keys are dropped, so colours never key the cache"


def test_resolve_inputs_still_refuses_an_enum_outside_the_vocabulary(v2_row):
    with pytest.raises(rd.InputRejected):
        rd.resolve_inputs("rsLine", {"benchmark": "TSLA"})
    with pytest.raises(rd.InputRejected):
        rd.resolve_inputs("rsLine", {"maType": "WMA"})


# ── benchmark resolution ───────────────────────────────────────────────────

def _fetcher(store):
    calls = []
    def fetch(sym, tf, count):
        calls.append((sym, tf, count))
        return store.get(sym.upper(), [])
    fetch.calls = calls
    return fetch


def test_sector_etf_table_covers_the_eleven_spdr_sectors():
    assert len(rb.SECTOR_ETF) == 11
    assert rb.SECTOR_ETF["Technology"] == "XLK" and rb.SECTOR_ETF["Real Estate"] == "XLRE"


def test_literal_benchmarks_pass_straight_through():
    fetch = _fetcher({"RSP": _bars([1, 2])})
    out = rb.resolve_benchmark("NVDA", "RSP", "D", 50, fetch)
    assert out["resolved"] == "RSP" and out["fallback"] is None and len(out["bars"]) == 2
    assert fetch.calls == [("RSP", "D", 50)]


def test_sector_resolves_through_the_industry_map_and_falls_back_to_spy(monkeypatch):
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    fetch = _fetcher({"XLK": _bars([1]), "SPY": _bars([2])})
    out = rb.resolve_benchmark("NVDA", "SECTOR", "D", 10, fetch)
    assert out["resolved"] == "XLK" and out["label"] == "Technology (XLK)" and out["fallback"] is None

    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": None, "industry": None})
    out = rb.resolve_benchmark("ZZZZ", "SECTOR", "D", 10, fetch)
    assert out["resolved"] == "SPY" and out["fallback"] == "no sector"

    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Cryptocurrency", "industry": None})
    out = rb.resolve_benchmark("COIN", "SECTOR", "D", 10, fetch)
    assert out["resolved"] == "SPY" and out["fallback"].startswith("sector not mapped")


def test_industry_composite_is_equal_weight_and_falls_back_when_the_group_is_tiny(monkeypatch):
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    monkeypatch.setattr(rb, "_members_of", lambda ind: ["AMD", "NVDA", "AVGO"])
    store = {"AMD": _bars([10, 11, 12]), "NVDA": _bars([100, 100, 100]), "AVGO": _bars([50, 55, 50]), "XLK": _bars([1])}
    out = rb.resolve_benchmark("NVDA", "INDUSTRY", "D", 10, _fetcher(store))
    assert out["resolved"] == "INDUSTRY:Semiconductors" and out["fallback"] is None
    comp = out["bars"]
    assert [b["t"] for b in comp] == [1000, 1001, 1002]
    assert comp[0]["c"] == pytest.approx(100.0)
    # bar 2: AMD 110, NVDA 100, AVGO 110 → mean 106.667
    assert comp[1]["c"] == pytest.approx((110 + 100 + 110) / 3)

    monkeypatch.setattr(rb, "_members_of", lambda ind: ["NVDA"])
    out = rb.resolve_benchmark("NVDA", "INDUSTRY", "D", 10, _fetcher(store))
    assert out["resolved"] == "XLK" and out["fallback"] == "industry group too small"


def test_composite_leaves_a_gap_when_too_few_members_have_a_bar():
    comp = rb.equal_weight_composite({"A": _bars([1, 2, 3]), "B": _bars([1, 2]), "C": _bars([1])})
    times = [b["t"] for b in comp]
    assert 1000 in times and 1001 in times, "two of three present is half, so it counts"
    assert 1002 not in times, "one of three present is a gap, not a guess"


# ── the provider ───────────────────────────────────────────────────────────

def test_provider_v2_envelope_columns_payload_and_bar_count(v2_row, monkeypatch):
    n = 330
    store = {"NVDA": _bars([100 + i for i in range(n)]), "SPY": _bars([400 + 0.5 * i for i in range(n)])}
    fetch = _fetcher(store)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", fetch)
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: None)
    env = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY", "lookback": 252, "lineColor": "#fff"})
    assert set(env["columns"]) == set(rsmod.PHASE1_COLUMNS)
    assert env["times"] == [1000 + i for i in range(n)]
    assert fetch.calls[0] == ("NVDA", "D", 852), "lookback + 600 bars on a daily chart"
    p = env["payload"]
    assert p["benchmark"] == {"requested": "SPY", "resolved": "SPY", "label": "S&P 500 (SPY)", "fallback": None}
    assert p["history"] == {"bars": n, "short": False} and p["intraday"] is False
    assert p["inputs"]["lookback"] == 252 and "lineColor" not in p["inputs"]
    assert p["legend"]["above"] is not None and p["lastRsHigh"]["barsAgo"] == 0
    # events are 0/1/None and dots sit on the line
    for k in ("rsNH", "rsNHbeforePx", "gor"):
        assert all(v in (0.0, 1.0, None) for v in env["columns"][k]), k
    i = n - 1
    assert env["columns"]["dotNH"][i] == env["columns"]["rsLine"][i]


def test_provider_blanks_events_and_dots_on_intraday_and_honours_the_toggles(v2_row, monkeypatch):
    n = 300
    store = {"NVDA": _bars([100 + i for i in range(n)]), "SPY": _bars([400.0] * n)}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: None)
    env = sig._rs_line_provider("NVDA", "5", {"lookback": 20})
    assert env["payload"]["intraday"] is True
    assert all(v is None for v in env["columns"]["rsNH"]) and all(v is None for v in env["columns"]["dotNH"])
    assert any(v is not None for v in env["columns"]["rsLine"]), "the line still draws intraday"

    env = sig._rs_line_provider("NVDA", "D", {"lookback": 20, "showNewHigh": False})
    assert all(v is None for v in env["columns"]["dotNH"]), "toggle off blanks the dot column"
    assert any(v == 1.0 for v in env["columns"]["rsNH"]), "the event column stays for scans"


def test_provider_v1_shape_when_the_flag_is_off(monkeypatch):
    monkeypatch.setattr(rd, "RS_V2_ENABLED", False)
    store = {"NVDA": _bars([100, 110]), "SPY": _bars([400, 400])}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: None)
    env = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})
    assert set(env["columns"]) == {"rsLine"} and "payload" not in env
    assert env["columns"]["rsLine"] == [0.25, 0.275]


def test_provider_serves_the_cached_envelope_when_present(v2_row, monkeypatch):
    sentinel = {"columns": {}, "times": [], "asOf": 0, "payload": {}}
    monkeypatch.setattr(sig.cache, "get", lambda k: sentinel)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", lambda *a, **k: pytest.fail("no fetch on a cache hit"))
    assert sig._rs_line_provider("NVDA", "D", {}) is sentinel


def test_bar_count_rule():
    assert sig._rs_bars_count("D", 252) == 852
    assert sig._rs_bars_count("W", 52) == 252
    assert sig._rs_bars_count("5", 252) == 400


# ── the route, v2 row installed ───────────────────────────────────────────

def test_columns_route_serves_the_v2_envelope(client, monkeypatch, v2_row):  # noqa: F811
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    n = 60
    store = {"NVDA": _bars([100 + i for i in range(n)]), "SPY": _bars([400.0] * n)}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: None)
    c = TestClient(client)
    from urllib.parse import quote
    r = c.get('/api/signature/columns?defId=rsLine&sym=NVDA&tf=D&inputs='
              + quote(json.dumps({"lookback": 20, "lineColor": "#abc"}), safe=""))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rev"] == 2 and body["inputs"]["lookback"] == 20 and "lineColor" not in body["inputs"]
    assert set(body["columns"]) == set(rsmod.PHASE1_COLUMNS)
    assert body["payload"]["benchmark"]["resolved"] == "SPY"
    assert all(len(col) == n for col in body["columns"].values())
    assert all(v is None or isinstance(v, (int, float)) for v in body["columns"]["rsNH"])


def test_the_js_definition_names_exactly_the_inputs_the_python_row_declares():
    """`meta.serverInputs` in nativeRegistry.js is what keys the client's fetch;
    the Python row's `inputs` is what the server resolves. Diffed the same way
    the benchmark enum is, so a key added on one side alone is a red test rather
    than an input that is sent and dropped, or declared and never sent."""
    import pathlib
    import re
    src = pathlib.Path("app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    block = src.split("serverInputs:", 1)[1].split("],", 1)[0]
    js = re.findall(r"'([A-Za-z]+)'", block)
    py = [i["key"] for i in rd._rs_line_row(True)["inputs"]]
    assert sorted(js) == sorted(py), (js, py)
    assert len(js) >= 3, "a short list makes this comparison vacuous"


def test_columns_route_422s_an_unknown_benchmark(client, monkeypatch, v2_row):  # noqa: F811
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    r = c.get('/api/signature/columns?defId=rsLine&sym=NVDA&tf=D&inputs={"benchmark":"TSLA"}')
    assert r.status_code == 422
