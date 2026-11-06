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


def test_the_two_clamp_paths_round_an_integer_input_the_same_way(v2_row):
    """Review B9 residual: `_clamp_number` (the route) and
    `resolve_phase1_inputs` (direct callers) must agree on 20.6 → 21; the pure
    guard used to truncate to 20, so a chart and a scan could read one input
    two ways."""
    raw = {"lookback": 20.6, "maLength": 20.6}
    route = rd.resolve_inputs("rsLine", raw)
    pure = rsmod.resolve_phase1_inputs(raw)
    assert route["lookback"] == pure["lookback"] == 21
    assert route["maLength"] == pure["maLength"] == 21
    raw = {"lookback": 20.4, "maLength": 2.4}
    assert rd.resolve_inputs("rsLine", raw)["lookback"] == rsmod.resolve_phase1_inputs(raw)["lookback"] == 20
    assert rd.resolve_inputs("rsLine", raw)["maLength"] == rsmod.resolve_phase1_inputs(raw)["maLength"] == 2


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


def test_composite_does_not_step_when_a_member_joins_mid_window():
    """Review finding B8. Two incumbents have risen 19 % when a third name's
    history begins. Indexing the joiner to 100 at ITS first bar (the earlier
    shape) averaged (119 + 119 + 100) / 3 = 112.67 on the join bar — a −5.3 %
    step the whole group's red-day and RS-new-high columns would have read as
    real. Chain-linked, the joiner enters AT the composite's 119 and its own
    +10 % the next bar moves the composite by one third of that."""
    series = {
        "A": _bars([100, 119, 119, 119]),
        "B": _bars([100, 119, 119, 119]),
        "C": _bars([50, 55], start_t=1_002),           # history begins on the third bar
    }
    comp = rb.equal_weight_composite(series)
    assert [b["t"] for b in comp] == [1000, 1001, 1002, 1003]
    c = [b["c"] for b in comp]
    assert c[0] == pytest.approx(100.0) and c[1] == pytest.approx(119.0)
    assert c[2] == pytest.approx(119.0), "the join bar is flat: 119 → 119, no step"
    old_rule_join_bar = (119 + 119 + 100) / 3
    assert c[2] != pytest.approx(old_rule_join_bar), "the pre-fix mean would have stepped to 112.67"
    assert c[3] == pytest.approx(119.0 * (1 + 0.10 / 3)), "C's +10 % at one-third weight: 119 × (1 + 0.1/3) = 122.97"


def test_composite_does_not_step_when_a_member_misses_one_bar_and_returns():
    """Review finding B8, the other half. One of four members sits 36 % below
    the others (A/B/C at 120 indexed, D at 80 ⇒ composite 110). D has no bar at
    t=1002 and is back at t=1003 with its price unchanged. The earlier shape
    averaged the three remaining names (120) on the gap bar and the four again
    on the return (110): a +9.1 % / −8.3 % pair out of nothing. Chain-linked,
    nobody present moved, so the composite stays at 110 through both bars, and
    D's +10 % after it returns counts at its re-linked weight."""
    series = {
        "A": _bars([100, 120, 120, 120, 120]),
        "B": _bars([100, 120, 120, 120, 120]),
        "C": _bars([100, 120, 120, 120, 120]),
        "D": [{"t": 1000, "c": 100.0}, {"t": 1001, "c": 80.0},            # no bar at t=1002
              {"t": 1003, "c": 80.0}, {"t": 1004, "c": 88.0}],
    }
    comp = rb.equal_weight_composite(series)
    assert [b["t"] for b in comp] == [1000, 1001, 1002, 1003, 1004], "3 of 4 present is ≥ half, so 1002 is emitted"
    c = [b["c"] for b in comp]
    assert c[0] == pytest.approx(100.0)
    assert c[1] == pytest.approx((120 * 3 + 80) / 4) == pytest.approx(110.0)
    assert c[2] == pytest.approx(110.0), "D dropped out and nobody moved: no step (the pre-fix mean read 120)"
    assert c[3] == pytest.approx(110.0), "D returned at its old price and nobody moved: no step back"
    # D re-linked at the composite's 110 on bar 3 (scale 110 / 80 = 1.375), so its
    # 80 → 88 on bar 4 is 110 → 121 indexed, against A/B/C's unchanged 3 × 120:
    # 110 × (360 + 121) / (360 + 110) = 112.5745.
    assert c[4] == pytest.approx(110.0 * (360 + 88 * (110 / 80)) / (360 + 110))
    assert c[4] == pytest.approx(112.574468, rel=1e-6)


def test_composite_with_constant_membership_is_still_the_mean_of_indexed_values():
    """Chain-linking changes nothing while nobody joins or leaves: the step
    ``Σ indexed[t] / Σ indexed[prev]`` IS the ratio of the two means."""
    comp = rb.equal_weight_composite({"A": _bars([10, 11, 12, 9]), "B": _bars([100, 100, 100, 100]),
                                      "C": _bars([50, 55, 50, 60])})
    c = [b["c"] for b in comp]
    assert c == pytest.approx([100.0, (110 + 100 + 110) / 3, (120 + 100 + 100) / 3, (90 + 100 + 120) / 3])


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
    assert p["benchmark"] == {"requested": "SPY", "resolved": "SPY", "label": "S&P 500 (SPY)", "fallback": None, "bars": n}
    # 330 bars came back for a request of 852: the store holds the stock's whole
    # history, so this IS a short history and the partial dots are allowed.
    assert p["history"] == {"bars": n, "requested": 852, "short": True} and p["intraday"] is False
    assert p["state"] == "short-history" and p["benchmark"]["bars"] == n
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


def test_benchmark_equal_to_the_symbol_is_a_state_not_a_flat_line_of_new_highs(v2_row, monkeypatch):
    """SPY vs SPY is 1.0 on every bar; ties count as new highs, so without this a
    SPY chart on the default benchmark would wear a dot on every bar."""
    n = 60
    store = {"SPY": _bars([400.0 + i for i in range(n)])}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: None)
    env = sig._rs_line_provider("SPY", "D", {"benchmark": "SPY", "lookback": 20})
    assert env["payload"]["state"] == "same-symbol"
    assert all(v is None for v in env["columns"]["rsNH"]) and all(v is None for v in env["columns"]["rsLine"])


def test_a_benchmark_without_bars_is_a_state_cached_for_one_minute_only(v2_row, monkeypatch):
    n = 60
    store = {"NVDA": _bars([100.0 + i for i in range(n)])}      # RSP has no rows yet
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    ttls = []
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: ttls.append(ttl))
    env = sig._rs_line_provider("NVDA", "D", {"benchmark": "RSP", "lookback": 20})
    assert env["payload"]["state"] == "no-benchmark-bars"
    assert env["payload"]["benchmark"]["bars"] == 0 and env["payload"]["history"]["bars"] == n
    assert all(v is None for v in env["columns"]["rsLine"])
    assert ttls == [60], "a degraded answer must not be remembered for six hours"


def test_cache_key_carries_the_ET_session_day_and_ttl_runs_to_the_next_close(v2_row, monkeypatch):
    n = 30
    store = {"NVDA": _bars([100.0 + i for i in range(n)]), "SPY": _bars([400.0] * n)}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    monkeypatch.setattr(sig, "_et_session_day", lambda: "2026-11-06")
    seen = {}
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.update({"key": k, "ttl": ttl}))
    sig._rs_line_provider("NVDA", "D", {"lookback": 20})
    assert seen["key"].endswith(":2026-11-06")
    assert 60 <= seen["ttl"] <= 3 * 24 * 3600
    assert 60 <= sig._seconds_to_next_et_close() <= 3 * 24 * 3600


def test_an_etf_gets_the_market_as_its_sector_benchmark_with_a_reason(monkeypatch):
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Financial", "industry": rb.ETF_INDUSTRY})
    fetch = _fetcher({"SPY": _bars([1, 2]), "XLF": _bars([9, 9])})
    out = rb.resolve_benchmark("QQQ", "SECTOR", "D", 10, fetch)
    assert out["resolved"] == "SPY" and out["fallback"] == "symbol is an ETF"
    out = rb.resolve_benchmark("QQQ", "INDUSTRY", "D", 10, fetch)
    assert out["resolved"] == "SPY" and out["fallback"] == "symbol is an ETF"


def test_industry_composite_counts_only_members_that_have_bars(monkeypatch):
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    monkeypatch.setattr(rb, "_members_of", lambda ind: ["AAAA", "AMD", "NVDA", "AVGO", "ZZZZ"])
    store = {"AMD": _bars([10, 11]), "NVDA": _bars([100, 100]), "AVGO": _bars([50, 55]), "XLK": _bars([1])}
    out = rb.resolve_benchmark("NVDA", "INDUSTRY", "D", 10, _fetcher(store))
    assert out["resolved"] == "INDUSTRY:Semiconductors"
    assert out["label"].endswith("(equal-weight, 3 names)"), out["label"]
    monkeypatch.setattr(rb, "_members_of", lambda ind: ["AAAA", "AMD", "ZZZZ"])
    out = rb.resolve_benchmark("NVDA", "INDUSTRY", "D", 10, _fetcher(store))
    assert out["resolved"] == "XLK" and out["fallback"] == "industry group too small"


def test_industry_composite_takes_the_names_with_bars_not_the_alphabet_first_sixty(monkeypatch):
    """Review finding B7. A 70-name group whose alphabet-first 60 have no bars
    and whose last 10 do: sliced alphabetically the composite was empty (or a
    tiny accident); ordered by presence the 10 carry it, and the label says 10."""
    first60 = [f"A{i:02d}" for i in range(60)]
    last10 = [f"Z{i:02d}" for i in range(10)]
    assert len(first60) == rb.MAX_INDUSTRY_MEMBERS
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Healthcare", "industry": "Biotechnology"})
    monkeypatch.setattr(rb, "_members_of", lambda ind: first60 + last10)
    monkeypatch.setattr(rb, "_cap_universe", lambda: set())
    store = {m: _bars([100 + i, 101 + i, 103 + i]) for i, m in enumerate(last10)}
    store["XLV"] = _bars([1, 1, 1])
    fetch = _fetcher(store)
    out = rb.resolve_benchmark("Z03", "INDUSTRY", "D", 10, fetch)
    assert out["resolved"] == "INDUSTRY:Biotechnology" and out["fallback"] is None
    assert out["label"] == "Biotechnology (equal-weight, 10 names)"
    assert [b["t"] for b in out["bars"]] == [1000, 1001, 1002]
    full = [s for s, _, c in fetch.calls if c == 10]
    assert set(last10) <= set(full), "every name with bars was inside the fetch cap"
    assert len(full) == rb.MAX_INDUSTRY_MEMBERS, "the cap still bounds the full reads"
    probes = [s for s, _, c in fetch.calls if c == 1]
    assert sorted(probes) == sorted(first60 + last10), "the whole group was probed once, cheaply"


def test_industry_members_in_the_cap_universe_come_before_the_rest_when_all_have_bars(monkeypatch):
    names = [f"A{i:02d}" for i in range(60)] + [f"Z{i:02d}" for i in range(10)]
    monkeypatch.setattr(rb, "_cap_universe", lambda: {f"Z{i:02d}" for i in range(10)} | {"BRK-B"})
    fetch = _fetcher({m: _bars([1, 2]) for m in names + ["BRK.B"]})
    ordered = rb.order_industry_members(names, "D", fetch)
    assert ordered[:10] == [f"Z{i:02d}" for i in range(10)], "cap-universe names first, alphabetical within"
    assert ordered[10:] == [f"A{i:02d}" for i in range(60)]
    # a class share (bars present) is checked in the cap universe's hyphen form
    assert rb.order_industry_members(names + ["BRK.B"], "D", fetch)[0] == "BRK.B"


def test_industry_ordering_puts_presence_ahead_of_cap_membership(monkeypatch):
    names = [f"N{i:02d}" for i in range(61)]
    monkeypatch.setattr(rb, "_cap_universe", lambda: {"N00", "N01"})       # in the universe, but no bars
    fetch = _fetcher({"N60": _bars([1]), "N59": _bars([1])})
    ordered = rb.order_industry_members(names, "D", fetch)
    assert ordered[:2] == ["N59", "N60"], "a name without bars contributes nothing whatever its cap status"
    assert ordered[2:4] == ["N00", "N01"]


def test_industry_ordering_is_unprobed_within_the_cap_and_uses_an_injected_has_bars(monkeypatch):
    monkeypatch.setattr(rb, "_cap_universe", lambda: set())
    fetch = _fetcher({})
    small = ["C", "A", "B"]
    assert rb.order_industry_members(small, "D", fetch) == ["A", "B", "C"]
    assert fetch.calls == [], "a group within the cap is fetched whole; nothing to order, nothing probed"
    big = [f"N{i:02d}" for i in range(61)]
    seen = []
    def has_bars(sym, tf):
        seen.append((sym, tf))
        return sym == "N60"
    assert rb.order_industry_members(big, "W", fetch, has_bars)[0] == "N60"
    assert fetch.calls == [], "the injected probe replaces the fetch_bars(sym, tf, 1) probe"
    assert len(seen) == 61 and all(tf == "W" for _, tf in seen)


def test_the_two_python_benchmark_vocabularies_are_one_set():
    assert set(rd.RS_LINE_BENCHMARKS) == set(rb.LITERAL_BENCHMARKS) | set(rb.AUTO_BENCHMARKS)


def test_the_python_vocabulary_is_derived_from_the_resolver_not_retyped():
    """Review finding B10: one derivation, not two tuples a test holds equal."""
    assert rd.RS_LINE_BENCHMARKS == rd.rs_benchmark_menu(
        rd._RS_MENU_ORDER, rb.LITERAL_BENCHMARKS + rb.AUTO_BENCHMARKS)
    # The derivation DROPS a menu name the resolver does not know and APPENDS a
    # resolver name the menu does not mention, so the tuple can never offer a
    # benchmark `resolve_benchmark` would refuse.
    assert rd.rs_benchmark_menu(("SPY", "DIA", "SECTOR"), ("SPY", "QQQ", "SECTOR")) == ("SPY", "SECTOR", "QQQ")
    assert rd.rs_benchmark_menu((), ("A", "B", "A")) == ("A", "B")


def test_resolve_benchmark_raises_on_a_value_outside_the_vocabulary():
    """Unreachable from the route (`resolve_inputs` refuses first); a direct
    caller gets an error, never an RS line against SPY under another name."""
    fetch = _fetcher({"SPY": _bars([1, 2])})
    with pytest.raises(ValueError, match="DIA"):
        rb.resolve_benchmark("NVDA", "DIA", "D", 10, fetch)
    assert fetch.calls == [], "nothing was fetched in its place"
    assert rb.resolve_benchmark("NVDA", None, "D", 10, fetch)["resolved"] == "SPY", "blank still means the default"


def test_the_python_row_reads_its_ranges_from_the_compute_module():
    by_key = {i["key"]: i for i in rd._rs_line_row(True)["inputs"]}
    assert (by_key["lookback"]["min"], by_key["lookback"]["max"]) == rsmod.LOOKBACK_RANGE
    assert (by_key["maLength"]["min"], by_key["maLength"]["max"]) == rsmod.MA_LENGTH_RANGE
    assert by_key["lookback"]["default"] == rsmod.DEFAULT_LOOKBACK
    assert by_key["redDayThreshold"]["default"] == rsmod.DEFAULT_RED_DAY_PCT


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


# ── the JS ranges and defaults ARE the Python row's (review fix unit 10) ──────

def _js_rs_line_inputs() -> dict:
    """`RS_LINE_RAW.inputs[]` as nativeRegistry.js declares them, parsed from the
    source text — the same cwd-relative read the serverInputs rail makes.

    Returns ``{key: {"type", "default", "min", "max", "options"}}`` with numbers
    as floats, bools as bools, enum defaults as strings and ``options`` as the
    list of option KEYS. Entries built by the ``colorInput`` helper carry no
    ``key:`` of their own and are skipped: a colour is never a server input.
    """
    import pathlib
    import re
    src = pathlib.Path("app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    body = src.split("const RS_LINE_RAW = {", 1)[1]
    block = body.split("\n  inputs: [", 1)[1].split("\n  plots: [", 1)[0]
    # Prose is not a field: drop comment lines and tooltip strings before any
    # `default:` / `min:` / `max:` is read, so a sentence can never masquerade.
    block = "\n".join(line for line in block.split("\n") if not line.lstrip().startswith("//"))
    block = re.sub(r"tooltip:\s*'(?:[^'\\]|\\.)*'", "", block)
    out: dict = {}
    for entry in re.split(r"\n    \{", block)[1:]:
        key = re.search(r"\bkey:\s*'([A-Za-z]+)'", entry)
        if not key:
            continue
        spec: dict = {"type": re.search(r"\btype:\s*'([a-z]+)'", entry).group(1)}
        dflt = re.search(r"\bdefault:\s*('[^']*'|true|false|-?\d+(?:\.\d+)?)", entry)
        if dflt:
            raw = dflt.group(1)
            if raw.startswith("'"):
                spec["default"] = raw.strip("'")
            elif raw in ("true", "false"):
                spec["default"] = raw == "true"
            else:
                spec["default"] = float(raw)
        for bound in ("min", "max"):
            m = re.search(rf"\b{bound}:\s*(-?\d+(?:\.\d+)?)", entry)
            if m:
                spec[bound] = float(m.group(1))
        if spec["type"] == "enum":
            spec["options"] = re.findall(r"\['([A-Za-z]+)',", entry)
        out[key.group(1)] = spec
    return out


def test_the_js_ranges_and_defaults_are_the_python_rows():
    """Review finding B9 / Q5: the dialog's steppers (`min`/`max`/`default` in
    nativeRegistry.js) were railed by KEY only, so a range widened on the Python
    side left the dialog on the old bound with no red test. Every server input
    the Python row declares is diffed here field by field — numbers as numbers,
    bools as true/false, enums by default value AND option vocabulary."""
    js = _js_rs_line_inputs()
    py = {i["key"]: i for i in rd._rs_line_row(True)["inputs"]}
    assert len(js) >= 6, js  # the parser found the dialog's inputs, not a stub
    # The ONE server input with no dialog control in Phase 1 (the golden test
    # pins the same fact from the JS side). Anything else missing is drift.
    assert set(py) - set(js) == {"redDayThreshold"}, (set(py) - set(js))
    compared = 0
    for key, p in py.items():
        if key not in js:
            continue
        j = js[key]
        assert j["type"] == p["type"], (key, j, p)
        if p["type"] == "enum":
            assert j["default"] == p["default"], (key, j, p)
            assert j["options"] == list(p["options"]), (key, j["options"], p["options"])
        elif p["type"] == "bool":
            assert j["default"] is bool(p["default"]), (key, j, p)
        else:
            assert j["default"] == pytest.approx(float(p["default"])), (key, j, p)
            assert j["min"] == pytest.approx(float(p["min"])), (key, j, p)
            assert j["max"] == pytest.approx(float(p["max"])), (key, j, p)
        compared += 1
    assert compared == len(py) - 1, compared


def test_the_js_input_parser_reads_the_fields_it_claims_to():
    """The parser's own control: the shipped numbers, so a regex that silently
    matched nothing (and let the diff above pass vacuously) is caught by name."""
    js = _js_rs_line_inputs()
    assert js["maLength"] == {"type": "int", "default": 21.0, "min": 2.0, "max": 200.0}
    assert js["lookback"]["min"] == 20.0 and js["lookback"]["max"] == 500.0
    assert js["priceTolerance"] == {"type": "float", "default": 2.0, "min": 0.0, "max": 10.0}
    assert js["showNewHigh"] == {"type": "bool", "default": True}
    assert js["benchmark"]["options"] == list(rd.RS_LINE_BENCHMARKS)
    assert js["maType"] == {"type": "enum", "default": "EMA", "options": ["EMA", "SMA"]}
    # style inputs are parsed too (they are dialog controls) but never server ones
    assert "lineWidth" in js and "lineWidth" not in {i["key"] for i in rd._rs_line_row(True)["inputs"]}
    assert "color" not in js, "colorInput() entries carry no key: of their own and are skipped"
