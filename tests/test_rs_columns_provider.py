"""Rails for the UCT Relative Strength server lane (plan §8, §12.3
`tests/test_rs_columns_provider.py`): the Python row in both flag states, the
clamping resolver, benchmark resolution, the provider's envelope, the intraday
rule, the bar count, and the route end to end with the v3 row installed.

Phase 2a (unit 2a-14, `compute.rev` 3) adds: the Mansfield wire columns and the
cross dot against the shared `rs_mansfield` fixture; the three new toggles; the
`payload` blocks `rating`, `mansfield`, `regime`, `sensitivity`, `checks`,
`theme` and their null-with-reason branches; the ETF special case; the cache key
leading with the rev; and the READOUT-SOURCE RAIL, which parses every
`readout[].source` / `when` path out of `nativeRegistry.js` and resolves it
against a real provider payload, so a row can never name a scalar the server
does not send.

The flag is read ONCE at import (`registry_defs.RS_V2_ENABLED`), so these tests
never reload the module: they build the v3 row with `_rs_line_row(True)` and
install it into the live registry for the duration of a test.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import signature as sig
from api.services.signature import rs_provider as rsp
from api.services import relative_strength as rsmod
from api.services import rs_benchmarks as rb
from api.services import rs_evidence_pull as ep
from api.services.screener import rs_history
from api.services.signature import registry_defs as rd

# Reuse the router test module's app + paid-user fixtures (pytest discovers
# fixtures imported into a module's namespace).
from tests.test_signature_router import client, _paid_user  # noqa: F401


@pytest.fixture(autouse=True)
def _hermetic_reads(monkeypatch, tmp_path):
    """The v3 provider reads the industry map (theme, the sector leg) and the
    rating history table. Neither exists on a test box: both are stubbed to
    "nothing known" here, and the tests that need a sector or a rating set
    their own answer on top. `RS_HISTORY_ENABLED` is unset so a missing row
    reads `dark`, the pod's own default. The evidence artifact (unit 2b-03) is
    read from an EMPTY temp data dir, so no test here can see a real
    `rs_evidence.json`; the evidence tests at the end write their fixture into it."""
    monkeypatch.setattr(rb, "_groups_for", lambda s: {})
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {})
    monkeypatch.delenv("RS_HISTORY_ENABLED", raising=False)
    monkeypatch.setattr(ep, "_default_data_dir", lambda: str(tmp_path))


@pytest.fixture
def v2_row(monkeypatch):
    """Install the v3 row (the shape `RS_V2_ENABLED` turns on) and the flag for
    one test, restoring the import-time state. The fixture keeps its Phase 1
    name: the flag did not change, only what it switches on."""
    row = rd._rs_line_row(True)
    monkeypatch.setitem(rd._BY_ID, "rsLine", row)
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    return row


def _no_cache(monkeypatch):
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: None)


V3_COLUMNS = tuple(rsmod.PHASE1_COLUMNS) + tuple(rd.RS_PHASE2A_WIRE_COLUMNS)
V3_INPUT_KEYS = {"benchmark", "maLength", "maType", "lookback", "priceTolerance", "redDayThreshold",
                 "showNewHigh", "showNewHighBeforePrice", "shortHistoryDots",
                 "mansfieldLength", "showMansfield", "showRedDay", "showNewLow"}


def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": float(c), "v": 1} for i, c in enumerate(closes)]


# ── the row ────────────────────────────────────────────────────────────────

def test_v3_row_declares_the_phase1_and_mansfield_columns_payload_and_clamped_inputs():
    row = rd._rs_line_row(True)
    assert row["version"] == 3 and row["compute"]["rev"] == 3
    assert row["columns"] == list(V3_COLUMNS) and len(row["columns"]) == 22
    assert row["columns"][:18] == list(rsmod.PHASE1_COLUMNS), "the Phase 1 set leads, in its order"
    assert rd.RS_PHASE2A_WIRE_COLUMNS == ("mansfield", "mansfieldCrossUp", "mansfieldCrossDown", "dotMansfieldCross")
    assert "mansfieldState" not in row["columns"] and "mansfieldCrossBarsAgo" not in row["columns"]
    assert row["payload_keys"] == ["payload"]
    by_key = {i["key"]: i for i in row["inputs"]}
    assert set(by_key) == V3_INPUT_KEYS
    for k in ("maLength", "lookback", "priceTolerance", "redDayThreshold", "mansfieldLength"):
        assert "min" in by_key[k] and "max" in by_key[k], k
    assert (by_key["mansfieldLength"]["min"], by_key["mansfieldLength"]["max"]) == rsmod.MANSFIELD_LENGTH_RANGE
    assert by_key["mansfieldLength"]["default"] == rsmod.DEFAULT_MANSFIELD_LENGTH == 200
    for k in ("showMansfield", "showRedDay", "showNewLow"):
        assert by_key[k] == {"key": k, "type": "bool", "default": False}, k
    assert "lineColor" not in by_key, "style inputs never reach the server"


def test_the_python_lanes_agree_on_rev_5_and_the_v3_row_keeps_rev_3():
    """Phase 3 unit 3-05 made the v4 row (both flags) rev 4; Deepvue round 2
    (2026-11-08, the RS Rating Reading and its two wire columns) moved it and the
    alert migration table to rev 5 together. The v3 row (V2 only) still says 3."""
    from api.services import alert_rev_migration as rev
    v4 = rd._rs_line_row(True, True)
    assert v4["version"] == v4["compute"]["rev"] == rd.RS_V4_REV == 5
    assert rev.ADDRESS_REVS["rsLine"] == 5
    v3 = rd._rs_line_row(True)
    assert v3["version"] == 3 and v3["compute"]["rev"] == 3


def test_the_three_lanes_agree_on_rev_5():
    """JS definition, Python v4 row and the alert migration table: one revision
    (unit 3-08 shipped the JS v4 definition at 4; Deepvue round 2 moved all three
    to 5 in one commit)."""
    import pathlib
    import re
    from api.services import alert_rev_migration as rev
    src = pathlib.Path("app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    m = re.search(r"fn:\s*'rsLine'\s*,\s*rev:\s*(\d+)", src)
    assert m and int(m.group(1)) == 5
    assert re.search(r"id:\s*'rsLine',\s*\n\s*version:\s*5,", src), "the JS definition's version is 5"
    assert rd._rs_line_row(True, True)["compute"]["rev"] == 5
    assert rev.ADDRESS_REVS["rsLine"] == 5


def test_v1_row_is_the_shape_master_shipped():
    row = rd._rs_line_row(False)
    assert row["version"] == 1 and row["compute"]["rev"] == 1
    assert row["columns"] == ["rsLine"] and row["payload_keys"] == []
    assert [i["key"] for i in row["inputs"]] == ["benchmark"]


def test_the_installed_row_matches_the_flags():
    """The row installed at import is the shape the two import-time flags name
    (the subprocess control in tests/test_registry_string_inputs.py arms them)."""
    assert rd.definition("rsLine") == rd._rs_line_row(rd.RS_V2_ENABLED, rd.RS_V3_ENABLED)


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
    assert set(env["columns"]) == set(V3_COLUMNS)
    assert env["times"] == [1000 + i for i in range(n)]
    assert fetch.calls[0] == ("NVDA", "D", 852), "lookback + 600 bars on a daily chart"
    p = env["payload"]
    assert p["benchmark"] == {"requested": "SPY", "resolved": "SPY", "label": "S&P 500 (SPY)", "fallback": None,
                              "bars": n, "note": None}
    # 330 bars came back for a request of 852: the store holds the stock's whole
    # history, so this IS a short history and the partial dots are allowed.
    assert p["history"] == {"bars": n, "requested": 852, "short": True,
                            "summary": f"{n} bars held; dots use every bar"} and p["intraday"] is False
    assert p["state"] == "short-history" and p["benchmark"]["bars"] == n
    assert p["inputs"]["lookback"] == 252 and "lineColor" not in p["inputs"]
    assert p["inputs"]["mansfieldLength"] == 200
    assert p["legend"]["above"] is not None and p["lastRsHigh"]["barsAgo"] == 0
    # the v3 blocks are all present, each either answered or null WITH a reason
    for k in ("rating", "mansfield", "regime", "sensitivity", "checks", "theme"):
        assert k in p, k
    # Pin moved 2026-11-06 (visual round VA1): the rating carries its summary;
    # 2026-11-07 (shape 4): and its four component ranks and their Components text.
    assert p["rating"] == {"ibd": None, "fast": None, "asof": None, "d5": None, "d20": None, "source": "dark",
                           "m1": None, "m3": None, "m6": None, "m12": None,
                           "summary": None, "components": None}
    assert p["theme"] is None, "no industry map on a test box ⇒ no theme, never a guess"
    assert p["mansfield"]["length"] == 200 and p["mansfield"]["value"] is not None, "330 bars clear the 200-bar average"
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
    assert rsp._rs_bars_count("D", 252) == 852
    assert rsp._rs_bars_count("W", 52) == 252
    assert rsp._rs_bars_count("5", 252) == 400


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
    assert body["inputs"]["lookback"] == 20 and "lineColor" not in body["inputs"]
    assert body["inputs"]["showMansfield"] is False and body["inputs"]["mansfieldLength"] == 200
    assert set(body["columns"]) == set(V3_COLUMNS)
    assert body["rev"] == 3
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
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-06")
    seen = {}
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.update({"key": k, "ttl": ttl}))
    sig._rs_line_provider("NVDA", "D", {"lookback": 20})
    assert seen["key"].endswith(":2026-11-06")
    assert ":rs3:" in seen["key"] or seen["key"].startswith("rs3") or "rs3" in seen["key"], seen["key"]
    assert "rs2" not in seen["key"], "the rev leads the key: a bump is a cold cache by itself"
    assert '"showMansfield": false' in seen["key"] and '"mansfieldLength": 200' in seen["key"]
    assert 60 <= seen["ttl"] <= 3 * 24 * 3600
    assert 60 <= rsp._seconds_to_next_et_close() <= 3 * 24 * 3600


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


def test_the_v4_menu_is_the_v3_menu_plus_custom_by_name():
    """Unit 3-05 / D4: CUSTOM is added by NAME to the v4 menu only; the shared
    list (and so the alert lane's) never grows it."""
    assert rd.RS_LINE_BENCHMARKS_V4 == rd.RS_LINE_BENCHMARKS + ("CUSTOM",)
    assert rb.CUSTOM_BENCHMARK == "CUSTOM"
    assert "CUSTOM" not in rd.RS_LINE_BENCHMARKS
    assert "CUSTOM" not in rb.LITERAL_BENCHMARKS + rb.AUTO_BENCHMARKS
    assert rd._rs_line_row(True, True)["inputs"][0]["options"] == list(rd.RS_LINE_BENCHMARKS_V4)
    assert rd._rs_line_row(True)["inputs"][0]["options"] == list(rd.RS_LINE_BENCHMARKS)


def test_the_js_benchmark_enum_is_the_v4_menu():
    """The one-list rail against the v4 menu (3-08 added CUSTOM, "Your symbol")."""
    assert _js_rs_line_inputs()["benchmark"]["options"] == list(rd.RS_LINE_BENCHMARKS_V4)


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
    # ⭐ 3-08: the JS definition is v4, so it is the v4 row (both flags) it names.
    py = [i["key"] for i in rd._rs_line_row(True, True)["inputs"]]
    assert sorted(js) == sorted(py), (js, py)
    assert len(js) >= 3, "a short list makes this comparison vacuous"


def test_the_js_server_inputs_are_the_v4_row_keys():
    """The `serverInputs` rail against the v4 row (unit 3-05), green since 3-08
    shipped the JS v4 definition: the nine Phase 3 keys follow the thirteen v3
    ones, in the row's order."""
    import pathlib
    import re
    src = pathlib.Path("app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    block = src.split("serverInputs:", 1)[1].split("],", 1)[0]
    js = re.findall(r"'([A-Za-z]+)'", block)
    py = [i["key"] for i in rd._rs_line_row(True, True)["inputs"]]
    assert sorted(js) == sorted(py), (js, py)
    assert js[-9:] == py[-9:] == ["view", "customBenchmark", "rrgRatioLength", "rrgMomentumLength",
                                  "clenowWindow", "clenowGapPct", "atrLength", "varsLookback", "anchorDate"]


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

    ⭐ 3-08: a ``string`` input also reports ``pattern`` (the JS string literal
    UNESCAPED, so a doubled backslash in the source reads as one, the regex the Python row
    declares), ``maxLength`` (an int) and ``case``, each only when declared.
    """
    import pathlib
    import re
    src = pathlib.Path("app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    body = src.split("const RS_LINE_V5_RAW = {", 1)[1]
    block = body.split("\n  inputs: [", 1)[1].split("\n  plots: [", 1)[0]
    # Prose is not a field: drop comment lines and tooltip strings before any
    # `default:` / `min:` / `max:` is read, so a sentence can never masquerade.
    block = "\n".join(line for line in block.split("\n") if not line.lstrip().startswith("//"))
    block = re.sub(r"(?:tooltip|hint|placeholder):\s*'(?:[^'\\]|\\.)*'", "", block)
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
        if spec["type"] == "string":
            pat = re.search(r"\bpattern:\s*'((?:[^'\\]|\\.)*)'", entry)
            if pat:
                spec["pattern"] = re.sub(r"\\(.)", r"\1", pat.group(1))
            ml = re.search(r"\bmaxLength:\s*(\d+)", entry)
            if ml:
                spec["maxLength"] = int(ml.group(1))
            case = re.search(r"\bcase:\s*'([a-z]+)'", entry)
            if case:
                spec["case"] = case.group(1)
        out[key.group(1)] = spec
    return out


def test_the_js_ranges_and_defaults_are_the_python_rows():
    """Review finding B9 / Q5: the dialog's steppers (`min`/`max`/`default` in
    nativeRegistry.js) were railed by KEY only, so a range widened on the Python
    side left the dialog on the old bound with no red test. Every server input
    the Python row declares is diffed here field by field — numbers as numbers,
    bools as true/false, enums by default value AND option vocabulary."""
    js = _js_rs_line_inputs()
    # ⭐ 3-08: the JS definition is v4, so the v4 row (both flags) is its pair.
    py = {i["key"]: i for i in rd._rs_line_row(True, True)["inputs"]}
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
        elif p["type"] == "string":
            # the text box's own rules ARE the row's: pattern, length, case, default
            assert j["default"] == p["default"], (key, j, p)
            for field in ("pattern", "maxLength", "case"):
                assert j.get(field) == p.get(field), (key, field, j.get(field), p.get(field))
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
    assert js["benchmark"]["options"] == list(rd.RS_LINE_BENCHMARKS_V4)
    assert js["maType"] == {"type": "enum", "default": "EMA", "options": ["EMA", "SMA"]}
    # 3-08: the Reading, the string inputs and a Phase 3 length, by their shipped values
    assert js["view"] == {"type": "enum", "default": "ratio",
                          "options": ["ratio", "mansfield", "rotation", "quality", "vars", "rating"]}
    assert js["customBenchmark"] == {"type": "string", "default": "", "pattern": r"^[A-Z][A-Z.\-]{0,9}$",
                                     "maxLength": 10, "case": "upper"}
    assert js["anchorDate"] == {"type": "string", "default": "", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
    assert js["clenowGapPct"] == {"type": "float", "default": 15.0, "min": 1.0, "max": 50.0}
    # a hint or placeholder is prose, never a field
    assert "placeholder" not in js["customBenchmark"] and "hint" not in js["anchorDate"]
    # style inputs are parsed too (they are dialog controls) but never server ones
    assert "lineWidth" in js and "lineWidth" not in {i["key"] for i in rd._rs_line_row(True, True)["inputs"]}
    assert "color" not in js, "colorInput() entries carry no key: of their own and are skipped"



# ═════════════════════════════════════════════════════════════════════════════
# PHASE 2a (unit 2a-14): the Mansfield columns, the toggles, the payload blocks
# ═════════════════════════════════════════════════════════════════════════════

def _load_fixture(name):
    import pathlib
    return json.loads(pathlib.Path(f"tests/fixtures/indicators/{name}.json").read_text(encoding="utf-8"))


def _long_daily(n=900, seed=7):
    """A synthetic daily store long enough for every payload block to answer:
    the stock, SPY, RSP and the sector ETF, all with bars at the same times."""
    import math
    import random
    rnd = random.Random(seed)

    def series(start, drift, vol):
        out, c = [], start
        for i in range(n):
            o = c
            c = max(1.0, c * math.exp(rnd.gauss(drift, vol)))
            h = max(o, c) * (1 + abs(rnd.gauss(0, 0.004)))
            l = min(o, c) * (1 - abs(rnd.gauss(0, 0.004)))
            out.append({"t": 1_000 + i, "o": o, "h": h, "l": l, "c": c, "v": 1000})
        return out
    return {"NVDA": series(100.0, 0.001, 0.02), "SPY": series(400.0, 0.0004, 0.01),
            "RSP": series(150.0, 0.0003, 0.011), "XLK": series(200.0, 0.0006, 0.014)}


def test_provider_mansfield_columns_match_the_shared_fixture_in_the_python_lane(v2_row, monkeypatch):
    """Both lanes meet on `rs_mansfield.json`: the provider's four wire columns on
    the fixture's weekly bars equal the fixture's (the chart rounds the percent
    to four places), including the cross DOT the provider builds itself."""
    case = _load_fixture("rs_mansfield")
    store = {"XYZ": case["bars"], "SPY": case["benchmarkBars"]}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    _no_cache(monkeypatch)
    env = sig._rs_line_provider("XYZ", "W", {"benchmark": "SPY", "showMansfield": True,
                                             "mansfieldLength": case["params"]["length"], "lookback": 20})
    exp = case["expected"]
    for col in ("mansfield",):
        got = env["columns"][col]
        assert len(got) == len(exp[col])
        for i, (g, e) in enumerate(zip(got, exp[col])):
            assert (g is None) == (e is None), f"{col}[{i}]: {g!r} vs {e!r}"
            if e is not None:
                assert g == pytest.approx(round(e, 4), abs=5e-5), f"{col}[{i}]: {g!r} != {e!r}"
    for col in ("mansfieldCrossUp", "mansfieldCrossDown"):
        assert env["columns"][col] == exp[col], col
    # Pin moved 2026-11-06 (visual round A2): the dot is a cross UP only, centred
    # on the zero line (value 0); the fixture's `dotMansfieldCross` was moved
    # to the same rule on 2026-11-07, and the wire must equal it.
    assert env["columns"]["dotMansfieldCross"] == exp["dotMansfieldCross"]
    fired = [i for i, v in enumerate(env["columns"]["dotMansfieldCross"]) if v is not None]
    ups = [i for i, v in enumerate(exp["mansfieldCrossUp"]) if v == 1.0 and exp["mansfield"][i] is not None]
    assert fired == ups and len(fired) >= 1
    assert all(env["columns"]["dotMansfieldCross"][i] == 0.0 for i in fired)
    assert not any(exp["mansfieldCrossDown"][i] == 1.0 for i in fired), "no dot on a cross down"
    # the readout scalars read the same last bar
    ms = env["payload"]["mansfield"]
    assert ms["length"] == 10 and ms["value"] == pytest.approx(exp["mansfield"][-1])
    assert ms["state"] in (-1, 0, 1) and ms["stateLabel"] in ("bull", "bear", "neutral")
    assert ms["crossBarsAgo"] == int(exp["mansfieldCrossBarsAgo"][-1])
    assert set(env["columns"]) == set(V3_COLUMNS)


def test_mansfield_and_its_dot_are_blank_unless_shown_and_the_scalars_still_answer(v2_row, monkeypatch):
    case = _load_fixture("rs_mansfield")
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher({"XYZ": case["bars"], "SPY": case["benchmarkBars"]}))
    _no_cache(monkeypatch)
    env = sig._rs_line_provider("XYZ", "W", {"benchmark": "SPY", "mansfieldLength": 10, "lookback": 20})
    assert all(v is None for v in env["columns"]["mansfield"]), "showMansfield defaults OFF ⇒ the line is blank"
    assert all(v is None for v in env["columns"]["dotMansfieldCross"])
    assert any(v == 1.0 for v in env["columns"]["mansfieldCrossUp"]), "the EVENT columns stay for scans and alerts"
    assert env["payload"]["mansfield"]["value"] is not None, "the reading is read before the toggle blanks the column"


def test_the_red_day_and_new_low_dots_need_their_toggles_and_the_events_stay(v2_row, monkeypatch):
    case = _load_fixture("rs_events_default")
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher({"XYZ": case["bars"], "SPY": case["benchmarkBars"]}))
    _no_cache(monkeypatch)
    inputs = {"benchmark": "SPY", "lookback": 25, "maLength": 5, "maType": "EMA", "priceTolerance": 2.0,
              "redDayThreshold": -0.5}
    off = sig._rs_line_provider("XYZ", "D", inputs)
    assert all(v is None for v in off["columns"]["dotNHred"]) and all(v is None for v in off["columns"]["dotNL"])
    assert off["columns"]["rsNHred"][30] == 1.0 and off["columns"]["rsNL"][57] == 1.0
    on = sig._rs_line_provider("XYZ", "D", {**inputs, "showRedDay": True, "showNewLow": True})
    assert on["columns"]["dotNHred"][30] == pytest.approx(case["expected"]["dotNHred"][30], abs=1e-6)
    assert on["columns"]["dotNL"][57] == pytest.approx(case["expected"]["dotNL"][57], abs=1e-6)
    assert sum(v is not None for v in on["columns"]["dotNHred"]) == 1
    # the Phase 1 toggles are untouched by the new ones
    assert on["columns"]["dotNH"][25] == pytest.approx(case["expected"]["dotNH"][25], abs=1e-6)


def test_intraday_blanks_the_mansfield_crosses_and_dot_but_keeps_the_line(v2_row, monkeypatch):
    n = 300
    store = {"NVDA": _bars([100 + i for i in range(n)]), "SPY": _bars([400.0 + (i % 7) for i in range(n)])}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    _no_cache(monkeypatch)
    env = sig._rs_line_provider("NVDA", "5", {"lookback": 20, "showMansfield": True, "mansfieldLength": 10})
    assert any(v is not None for v in env["columns"]["mansfield"]), "the Mansfield line draws intraday"
    for k in ("mansfieldCrossUp", "mansfieldCrossDown", "dotMansfieldCross"):
        assert all(v is None for v in env["columns"][k]), k
    # Pins moved 2026-11-07 (RS review #24): the reason IS the regime label and
    # the checks summary, so the readout never prints "needs more history" for a
    # known reason; the words are "daily charts only".
    assert env["payload"]["regime"]["label"] == "daily charts only" and env["payload"]["regime"]["reason"] is None
    assert env["payload"]["checks"]["summary"] == "daily charts only" and env["payload"]["checks"]["ma"]["reason"] == "daily charts only"
    assert env["payload"]["sensitivity"]["summary"] is None
    assert env["payload"]["sensitivity"]["reasons"] == {"spy": "daily charts only", "rsp": "daily charts only", "sector": "daily charts only"}


def test_mansfield_length_is_clamped_like_every_other_number(v2_row):
    assert rsp._rs_mansfield_length(None) == 200
    assert rsp._rs_mansfield_length("abc") == 200
    assert rsp._rs_mansfield_length(99999) == rsmod.MANSFIELD_LENGTH_RANGE[1]
    assert rsp._rs_mansfield_length(0) == rsmod.MANSFIELD_LENGTH_RANGE[0]
    assert rsp._rs_mansfield_length(51.6) == 52
    assert rd.resolve_inputs("rsLine", {"mansfieldLength": 99999})["mansfieldLength"] == 500


def test_the_cross_dot_builder_sits_at_zero_on_crosses_up_unlike_the_rs_dot_builder():
    """Pin moved 2026-11-06 (visual round A2): the Mansfield dot is drawn at 0,
    on a cross UP only, wherever the line has a value."""
    mrs = [None, -2.0, -0.5, 0.0, 0.7, None, 1.1]
    up = [None, 1.0, 0.0, 1.0, 1.0, 1.0, 0.0]
    assert rsp._rs_zero_cross_dot(mrs, up) == [None, 0.0, None, 0.0, 0.0, None, None]
    assert rsmod.dot_column(mrs, up) == [None, None, None, None, 0.7, None, None], "the RS builder refuses ≤ 0 (a ratio)"


# ── rating ─────────────────────────────────────────────────────────────────

def test_rating_reads_the_history_row_and_names_its_source(monkeypatch):
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {
        "NVDA": {"ibd": 94, "fast": 91, "m1": 90, "asof": "2026-11-05", "d5": 2, "d20": -7}})
    # The component ranks the row holds are carried; the ones it does not stay
    # None and are left out of the Components text (never fabricated).
    assert rsp._rs_rating("nvda") == {"ibd": 94, "fast": 91, "asof": "2026-11-05", "d5": 2, "d20": -7, "source": "row",
                                      "m1": 90, "m3": None, "m6": None, "m12": None,
                                      "summary": "94 · fast 91", "components": "1M 90"}


def test_rating_components_are_the_four_ranks_in_order_as_the_spec_prints_them(monkeypatch):
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {
        "NVDA": {"ibd": 96, "fast": 98, "m1": 91, "m3": 97, "m6": 95, "m12": 96, "asof": "2026-11-05"}})
    r = rsp._rs_rating("NVDA")
    assert (r["m1"], r["m3"], r["m6"], r["m12"]) == (91, 97, 95, 96)
    assert r["components"] == "1M 91 · 3M 97 · 6M 95 · 12M 96"
    # a young listing: no 12-month rank, so no 12M in the text
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {
        "NVDA": {"ibd": 80, "fast": None, "m1": 70, "m3": 85, "m6": 88, "m12": None, "asof": "2026-11-05"}})
    assert rsp._rs_rating("NVDA")["components"] == "1M 70 · 3M 85 · 6M 88"
    # a rated row with no component at all prints no Components row
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {"NVDA": {"ibd": 80}})
    r = rsp._rs_rating("NVDA")
    assert r["components"] is None and r["m1"] is None
    assert rsp._rs_components_summary({}) is None


def test_rating_is_null_never_raises_and_says_dark_or_missing(monkeypatch):
    blank = {"ibd": None, "fast": None, "asof": None, "d5": None, "d20": None, "summary": None,
             "m1": None, "m3": None, "m6": None, "m12": None, "components": None}
    monkeypatch.delenv("RS_HISTORY_ENABLED", raising=False)
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {})
    assert rsp._rs_rating("NVDA") == {**blank, "source": "dark"}
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    assert rsp._rs_rating("NVDA") == {**blank, "source": "missing"}
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {"NVDA": {}})
    assert rsp._rs_rating("NVDA") == {**blank, "source": "missing"}, "an empty row is a missing rating, never a fabricated one"

    def boom(tickers, **kw):
        raise RuntimeError("table gone")
    monkeypatch.setattr(rs_history, "read_fields", boom)
    assert rsp._rs_rating("NVDA")["source"] == "missing"


# ── regime, sensitivity, checks, theme on a long daily series ──────────────

def test_payload_blocks_answer_on_a_long_daily_series_and_reuse_the_benchmark_bars(v2_row, monkeypatch):
    store = _long_daily()
    fetch = _fetcher(store)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", fetch)
    _no_cache(monkeypatch)
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    env = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})
    p = env["payload"]
    # regime: every leg decided, a label, no reason
    r = p["regime"]
    assert r["label"] in ("persistence", "rebound risk", "mixed") and r["reason"] is None
    assert isinstance(r["above200"], bool) and r["trend2y"] in (-1, 0, 1) and r["volTercile"] in ("low", "mid", "high")
    # Pin moved 2026-11-07 (RS review #19): the regime reads its benchmark at
    # the fixed 883-bar depth, whatever the lookback.
    assert r["bars"] == rsp._RS_REGIME_BARS == 883 and r["volSamples"] == 756
    # sensitivity: three legs, SPY's from the benchmark bars already in hand (fetched ONCE)
    s = p["sensitivity"]
    assert s["window"] == 20 and s["reasons"] == {}
    for leg, ticker in (("spy", "SPY"), ("rsp", "RSP"), ("sector", "XLK")):
        assert s[leg]["ticker"] == ticker and s[leg]["sign"] in (-1, 0, 1) and s[leg]["word"] in ("rising", "falling", "flat")
    assert isinstance(s["agree"], bool) and isinstance(s["summary"], str) and "SPY" in s["summary"]
    # Pin moved 2026-11-07 (RS review #19): at the default lookback (count 852 <
    # 883) the regime's own fixed-depth read is the one extra benchmark read;
    # the sensitivity legs still reuse the chart's bars.
    assert [c for c in fetch.calls if c[0] == "SPY"] == [("SPY", "D", 852), ("SPY", "D", 883)], \
        "the chart's benchmark read once, plus the regime's fixed-depth read"
    assert ("RSP", "D", 852) in fetch.calls and ("XLK", "D", 852) in fetch.calls
    # checks: four booleans with reasons that carry the numbers, a summary, the pullback
    c = p["checks"]
    for k in ("ma", "anchor", "pivotSpeed", "greenOnRed"):
        assert isinstance(c[k]["pass"], bool), k
        assert isinstance(c[k]["reason"], str) and any(ch.isdigit() for ch in c[k]["reason"]), k
    assert c["of"] == 4 and 0 <= c["passed"] <= 4 and c["summary"] == f"{c['passed']} of 4 pass"
    assert c["pivotSpeed"]["of"] == 10 and c["greenOnRed"]["of"] == 20
    assert c["ma"]["pass"] == (c["ma"]["stock200"] > c["ma"]["bench200"])
    assert c["anchor"]["pass"] == (c["anchor"]["stock"] > c["anchor"]["bench"]) and 0 <= c["anchor"]["barsAgo"] < 20
    assert c["greenOnRed"]["pass"] == (c["greenOnRed"]["count"] >= 6)
    assert c["pivotSpeed"]["pass"] == (c["pivotSpeed"]["count"] >= 5)
    assert isinstance(c["pullbackEma8"], float)
    # theme from the same map the SECTOR benchmark resolves through
    assert p["theme"] == {"sector": "Technology", "industry": "Semiconductors", "etf": "XLK",
                          "label": "Semiconductors (XLK)", "note": None}


def test_payload_blocks_are_null_with_a_reason_when_bars_are_short_or_a_leg_is_missing(v2_row, monkeypatch):
    store = _long_daily(n=120)
    del store["RSP"]
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    _no_cache(monkeypatch)
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    p = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    r = p["regime"]
    assert r["label"] is None and r["above200"] is None and r["trend2y"] is None
    assert "200-day" in r["reason"] and "two-year" in r["reason"], r["reason"]
    s = p["sensitivity"]
    assert s["rsp"] is None and s["reasons"]["rsp"] == "no RSP bars"
    assert s["spy"] is not None and s["sector"] is not None, "the legs that have bars still answer"
    assert s["agree"] is None, "agreement needs all three"
    assert "RSP: no bars" in s["summary"]       # pin moved 2026-11-06 (VA1): the short leg form
    c = p["checks"]
    assert c["ma"]["pass"] is None and "needs 200 bars" in c["ma"]["reason"]
    assert c["anchor"]["pass"] is not None, "20 sessions suffice for the anchor"
    assert c["greenOnRed"]["pass"] is not None
    assert c["of"] < 4 and c["summary"] == f"{c['passed']} of {c['of']} pass"


def test_an_etf_says_so_in_theme_and_has_no_sector_leg(v2_row, monkeypatch):
    store = _long_daily()
    store["QQQ"] = store.pop("NVDA")
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    _no_cache(monkeypatch)
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Financial", "industry": rb.ETF_INDUSTRY})
    p = sig._rs_line_provider("QQQ", "D", {"benchmark": "SECTOR"})["payload"]
    assert p["benchmark"]["resolved"] == "SPY" and p["benchmark"]["fallback"] == "symbol is an ETF"
    # the Benchmark row's muted second line: the reason, as a sentence
    assert p["benchmark"]["note"] == "Sector ETF not available for an ETF; using SPY"
    assert p["theme"] == {"sector": None, "industry": rb.ETF_INDUSTRY, "etf": None,
                          "label": "Exchange-traded fund", "note": "symbol is an ETF"}
    s = p["sensitivity"]
    assert s["sector"] is None and s["reasons"]["sector"] == "symbol is an ETF"
    assert s["spy"] is not None and s["rsp"] is not None and s["agree"] is None
    assert "sector: none for an ETF" in s["summary"]   # pin moved 2026-11-06 (VA1)


def test_theme_and_sensitivity_name_an_unmapped_sector(v2_row, monkeypatch):
    assert rsp._rs_theme({}) is None
    assert rsp._rs_theme({"sector": "Cryptocurrency", "industry": None}) == {
        "sector": "Cryptocurrency", "industry": None, "etf": None, "label": "Cryptocurrency", "note": None}
    store = _long_daily()
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    _no_cache(monkeypatch)
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Cryptocurrency", "industry": None})
    s = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]["sensitivity"]
    assert s["sector"] is None and s["reasons"]["sector"] == "sector not mapped: Cryptocurrency"


def test_same_symbol_and_no_benchmark_bars_blank_the_v3_blocks_with_the_state_as_reason(v2_row, monkeypatch):
    n = 60
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher({"SPY": _bars([400.0 + i for i in range(n)])}))
    _no_cache(monkeypatch)
    env = sig._rs_line_provider("SPY", "D", {"benchmark": "SPY", "lookback": 20, "showMansfield": True})
    assert env["payload"]["state"] == "same-symbol"
    assert all(v is None for v in env["columns"]["mansfield"]) and all(v is None for v in env["columns"]["dotMansfieldCross"])
    # Pin moved 2026-11-07 (RS review #24): the state is the regime LABEL and the
    # checks summary, not a reason behind a "needs more history" fallback.
    assert env["payload"]["regime"]["label"] == "benchmark is the symbol"
    assert env["payload"]["checks"]["summary"] == "benchmark is the symbol"
    assert env["payload"]["checks"]["ma"]["reason"] == "benchmark is the symbol"
    assert env["payload"]["mansfield"]["value"] is None
    env = sig._rs_line_provider("NVDA", "D", {"benchmark": "RSP", "lookback": 20})
    assert env["payload"]["state"] == "no-benchmark-bars"
    assert env["payload"]["sensitivity"]["reasons"]["spy"] == "no benchmark bars"


def test_regime_rules_on_hand_built_series():
    import math
    up = [100.0 * (1.0 + 0.001) ** i for i in range(900)]        # steady climb: above its 200-day, +2y
    r = rsp._rs_regime(up)
    assert r["above200"] is True and r["trend2y"] == 1 and r["label"] == "persistence"
    down = [100.0 * (1.0 - 0.001) ** i for i in range(900)]
    r = rsp._rs_regime(down)
    assert r["above200"] is False and r["trend2y"] == -1
    assert r["label"] in ("rebound risk", "mixed")             # the tercile decides between the two
    # a down trend whose volatility just exploded is the panic state
    calm = [100.0 * (1.0 - 0.0005) ** i for i in range(880)]
    wild = [calm[-1] * (1.0 + (0.08 if i % 2 == 0 else -0.09)) ** (i + 1) for i in range(130)]
    r = rsp._rs_regime(calm + wild)
    assert r["trend2y"] == -1 and r["volTercile"] == "high" and r["label"] == "rebound risk"   # words (VA1)
    # too short: null with the reasons, never a guess
    r = rsp._rs_regime(up[:150])
    assert r["label"] is None and "200-day" in r["reason"] and "two-year" in r["reason"]
    assert r["bars"] == 150
    assert rsp._rs_regime([])["label"] is None


def test_checks_rules_on_hand_built_bars():
    # a stock that doubles the benchmark's move every day, red days every third bar
    stock, bench = [], []
    c, b = 100.0, 400.0
    for i in range(260):
        bchg = -0.01 if i % 3 == 0 else 0.004
        b *= 1 + bchg
        c *= 1 + 2 * bchg if bchg > 0 else 1 + 0.002        # up on the benchmark's red days
        stock.append({"t": 1000 + i, "o": c * 0.99, "h": c * 1.005, "l": c * 0.985, "c": c, "v": 1})
        bench.append({"t": 1000 + i, "o": b, "h": b, "l": b, "c": b, "v": 1})
    out = rsp._rs_checks(stock, bench, "SPY", -0.5)
    assert out["ma"]["pass"] is True and out["ma"]["stock200"] > out["ma"]["bench200"]
    assert "SPY" in out["ma"]["reason"] and "%" in out["ma"]["reason"]
    assert out["anchor"]["pass"] is True and out["anchor"]["anchorTime"] >= 1000 + 240
    assert out["greenOnRed"]["count"] == 7 and out["greenOnRed"]["pass"] is True         # 20 sessions ⇒ 6 or 7 red days, all green
    assert out["pivotSpeed"]["of"] == 10 and out["pivotSpeed"]["count"] == 10 and out["pivotSpeed"]["pass"] is True
    assert out["passed"] == 4 and out["of"] == 4 and out["summary"] == "4 of 4 pass"
    assert isinstance(out["pullbackEma8"], float)
    # a flat stock on the same benchmark fails the first two and the pivot (close mid-range)
    flat = [{"t": 1000 + i, "o": 50.0, "h": 51.0, "l": 49.0, "c": 50.0, "v": 1} for i in range(260)]
    out = rsp._rs_checks(flat, bench, "SPY", -0.5)
    assert out["ma"]["stock200"] == pytest.approx(0.0) and out["ma"]["pass"] is (0.0 > out["ma"]["bench200"])
    assert out["anchor"]["stock"] == pytest.approx(0.0) and out["anchor"]["pass"] is False, "the benchmark rose off its own low"
    assert out["pivotSpeed"]["count"] == 0 and out["pivotSpeed"]["pass"] is False, "a mid-range close is not the top third"
    assert out["greenOnRed"]["count"] == 0 and out["greenOnRed"]["pass"] is False
    assert out["summary"] == f"{1 if out['ma']['pass'] else 0} of 4 pass"
    # too short for the averages: null with the bar counts in the reason
    out = rsp._rs_checks(stock[:100], bench[:100], "SPY", -0.5)
    assert out["ma"]["pass"] is None and "have 100 and 100" in out["ma"]["reason"]
    # Pin moved 2026-11-07 (RS review #13): bar 99 is a benchmark red day and its
    # 20-session low, so the anchor is undecided ("low is today") and leaves the
    # count; it used to score a FAIL at +0.0% vs +0.0%.
    assert out["anchor"]["pass"] is None and out["anchor"]["barsAgo"] == 0
    assert out["of"] == 2


def test_sensitivity_legs_reuse_the_resolved_benchmark_and_agree_on_three_rising_slopes():
    bars = [{"t": 1000 + i, "c": 100.0 + i} for i in range(40)]
    flat = [{"t": 1000 + i, "c": 100.0} for i in range(40)]
    calls = []

    def fetch(sym, tf, count):
        calls.append(sym)
        return flat
    bench = {"resolved": "SPY", "bars": flat}
    out = rsp._rs_sensitivity("NVDA", bars, bench, "D", 40, {"sector": "Technology", "industry": "x"}, fetch)
    assert calls == ["RSP", "XLK"], "SPY came from the benchmark already in hand"
    # Pins moved 2026-11-06 (visual round VA1): the Agreement row's grouped copy.
    assert out["agree"] is True and out["summary"] == "SPY, RSP and XLK all rising"
    assert out["spy"]["sign"] == out["rsp"]["sign"] == out["sector"]["sign"] == 1
    # a flat leg disagrees (a flat slope is neither sign)
    out = rsp._rs_sensitivity("NVDA", flat, bench, "D", 40, {"sector": "Technology", "industry": "x"}, fetch)
    assert out["agree"] is False and out["summary"] == "SPY, RSP and XLK all flat"
    # a short series: null legs with the reason
    out = rsp._rs_sensitivity("NVDA", bars[:5], bench, "D", 40, {"sector": "Technology", "industry": "x"}, fetch)
    assert out["spy"] is None and "needs 20 bars" in out["reasons"]["spy"]


def test_the_v1_lane_never_touches_a_phase2a_helper(monkeypatch):
    monkeypatch.setattr(rd, "RS_V2_ENABLED", False)
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(False))
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher({"NVDA": _bars([100, 110]), "SPY": _bars([400, 400])}))
    _no_cache(monkeypatch)

    def boom(*a, **k):
        raise AssertionError("a Phase 2a helper ran on the v1 lane")
    for name in ("_rs_rating", "_rs_regime", "_rs_sensitivity", "_rs_checks", "_rs_theme"):
        monkeypatch.setattr(rsp, name, boom)
    monkeypatch.setattr(rb, "_groups_for", boom)
    env = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})
    assert set(env["columns"]) == {"rsLine"} and "payload" not in env


# ── THE READOUT-SOURCE RAIL ────────────────────────────────────────────────
#
# `RS_LINE_RAW.readout[]` (nativeRegistry.js) names the scalars the legend
# prints as `scalar:<dotted.path>` / `payload:<path>` / `input:<key>`. Parsed
# out of the source text the way the serverInputs rail parses that list, and
# resolved against a REAL provider payload — long bars, a sector, a rating row —
# so a row can never name a scalar the server does not send. An `input:` key
# must be a declared input of the definition.
#
# Since unit 2b-09 a row's `card` may carry `evidenceSource` (the same grammar;
# `readoutSchema.cardEvidenceText` reads it): it is parsed as a third field of
# the entry, so the evidence paths ride the same two rails — resolve on a real
# payload, resolve (to the honesty sentence) on a short series.

# ⭐ 3-08: `muted` may be a gate too (`scalar:rotation.reason`), so it rides the rail.
READOUT_SOURCE_FIELDS = ("source", "when", "evidenceSource", "note", "muted")


def _js_rs_line_source() -> str:
    import pathlib
    return pathlib.Path("app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")


def _js_rs_readout_sources() -> list:
    import re
    body = _js_rs_line_source().split("const RS_LINE_V5_RAW = {", 1)[1]
    block = body.split("\n  readout: [", 1)[1].split("\n  ],", 1)[0]
    block = "\n".join(line for line in block.split("\n") if not line.lstrip().startswith("//"))
    out = []
    for entry in re.split(r"\n    \{", block)[1:]:
        key = re.search(r"\bkey:\s*'([A-Za-z0-9_]+)'", entry).group(1)
        for field in READOUT_SOURCE_FIELDS:
            # ⭐ 3-08: `=` is admitted, so an equals gate (`input:view=rotation`) is
            # READ and checked below rather than silently skipped (3-07's note).
            m = re.search(rf"\b{field}:\s*'((?:scalar|payload|input):[A-Za-z0-9_.=]+)'", entry)
            if m:
                out.append((key, field, m.group(1)))
    return out


def _js_rs_honesty_sentence() -> str:
    """`RS_HONESTY_SENTENCE` as nativeRegistry.js declares it (the cards' static
    evidence line), parsed out of the source text."""
    import re
    m = re.search(r"^const RS_HONESTY_SENTENCE = '([^']+)'$", _js_rs_line_source(), re.M)
    assert m, "nativeRegistry.js declares RS_HONESTY_SENTENCE"
    return m.group(1)


def _resolve_path(payload: dict, path: str):
    """``(resolved, value)``. A block that is ``None`` resolves to null (the
    readout omits the row, or prints its fallback); a KEY that is absent from
    a dict does not resolve — that is the drift this rail exists to catch."""
    cur = payload
    for seg in path.split("."):
        if cur is None:
            return True, None
        if not isinstance(cur, dict) or seg not in cur:
            return False, None
        cur = cur[seg]
    return True, cur


@pytest.fixture
def v4_row(monkeypatch):
    """The v4 row installed (`RS_V3_ENABLED` on top of `RS_V2_ENABLED`), the row
    the v4 JS definition's readout reads (unit 3-08), with the cache stubbed."""
    row = rd._rs_line_row(True, True)
    monkeypatch.setitem(rd._BY_ID, "rsLine", row)
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    monkeypatch.setattr(rb, "_custom_warmed", {})
    _no_cache(monkeypatch)
    return row


def _check_input_gate(key, field, path):
    """An `input:` source or gate names a declared input; the equals form
    (`view=rotation`) names a declared ENUM input and one of its options."""
    js = _js_rs_line_inputs()
    declared = set(V3_INPUT_KEYS) | set(js) | {i["key"] for i in rd._rs_line_row(True, True)["inputs"]}
    name, _, value = path.partition("=")
    assert name in declared, f"readout[{key}].{field} names undeclared input {name!r}"
    if value:
        assert js.get(name, {}).get("type") == "enum", f"readout[{key}].{field}: {name!r} is not an enum"
        assert value in js[name]["options"], f"readout[{key}].{field}: {value!r} is not an option of {name!r}"


def test_every_readout_source_resolves_in_a_real_provider_payload(v4_row, monkeypatch):
    sources = _js_rs_readout_sources()
    assert len(sources) >= 20, sources
    store = _long_daily()
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {
        "NVDA": {"ibd": 94, "fast": 91, "asof": "2026-11-05", "d5": 2, "d20": 7}})
    payload = sig._rs_line_provider("NVDA", "D", {"benchmark": "SECTOR", "showMansfield": True})["payload"]
    missing = []
    for key, field, src in sources:
        kind, path = src.split(":", 1)
        if kind == "input":
            _check_input_gate(key, field, path)
            continue
        ok, _ = _resolve_path(payload, path)
        if not ok:
            missing.append((key, field, src))
    assert not missing, f"readout sources the provider payload does not carry: {missing}"
    # every block is answered on this series, so every path resolved to a dict walk, not a null
    for k in ("rating", "mansfield", "regime", "sensitivity", "checks", "theme", "lastRsHigh", "legend", "history",
              "rotation", "quality", "vars"):
        assert payload[k] is not None, k
    # and the two chip rows print on this payload: the resolved benchmark and the rating
    assert payload["benchmark"]["resolved"] == "XLK" and payload["rating"]["ibd"] == 94
    # 3-08: every Phase 3 path the readout names, by name, so the rail cannot pass
    # by having parsed none of them
    v4_paths = {src for _k, _f, src in sources if src.split(":", 1)[1].split(".")[0] in ("rotation", "quality", "vars")}
    assert v4_paths >= {"scalar:rotation.summary", "scalar:rotation.reason", "scalar:rotation.quadrant",
                        "scalar:rotation.ratio", "scalar:rotation.momentum", "scalar:rotation.inQuadrantBars",
                        "scalar:quality.summary", "scalar:quality.reason", "scalar:quality.score",
                        "scalar:quality.annualPct", "scalar:quality.r2", "scalar:quality.gap", "scalar:quality.window",
                        "scalar:vars.summary", "scalar:vars.reason", "scalar:vars.value", "scalar:vars.ma",
                        "scalar:vars.stateWord", "scalar:vars.lookback", "scalar:vars.atrLength"}, v4_paths
    for block in ("rotation", "quality", "vars"):
        assert payload[block]["reason"] is None and payload[block]["summary"], (block, payload[block])



# ── THE PANE TABLE'S SOURCES (design round, 2026-11-08) ──────────────────────
#
# `RS_LINE_RAW.meta.paneTable` (nativeRegistry.js) prints `scalar:` paths in the
# RS pane's corner table. The same rail as the readout's: every REQUIRED column
# must resolve in a real provider payload, and an OPTIONAL column must name a key
# the provider does not send yet, so the day it arrives this test asks for the
# column to become required. ⭐ Round 2 (2026-11-08) did exactly that for 9M:
# `_rs_rating` sends `rating.m9` on the v4 envelope, and the column is required.

def _js_rs_pane_table_sources() -> list:
    import re
    body = _js_rs_line_source().split("const RS_LINE_V5_RAW = {", 1)[1]
    block = body.split("\n    paneTable: {", 1)[1].split("\n    },", 1)[0]
    out = []
    for line in block.split("\n"):
        m = re.search(r"\{ key: '(\w+)', label: '([^']+)', source: '((?:scalar|payload):[A-Za-z0-9_.]+)'(.*)\}", line)
        if m:
            out.append((m.group(1), m.group(2), m.group(3), "optional: true" in m.group(4)))
    gates = re.findall(r"'((?:input|scalar):[A-Za-z0-9_.=]+)'", block.split("columns:", 1)[0])
    return out, gates


def test_every_pane_table_source_resolves_in_a_real_provider_payload(v4_row, monkeypatch):
    cols, gates = _js_rs_pane_table_sources()
    assert [c[1] for c in cols] == ["1M", "3M", "6M", "9M", "12M", "RS"], cols
    assert gates == ["input:showRating", "input:showRanksTable", "scalar:rating.asof"], gates
    store = _long_daily()
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {
        "NVDA": {"ibd": 94, "fast": 91, "asof": "2026-11-05", "d5": 2, "d20": 7,
                 "m1": 91, "m3": 97, "m6": 95, "m9": 93, "m12": 96}})
    payload = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    assert not [c for c in cols if c[3]], "no optional column is left: 9M is required since round 2"
    for key, label, src, optional in cols:
        ok, value = _resolve_path(payload, src.split(":", 1)[1])
        if optional:
            assert not ok, f"{label} ({src}) now arrives from the provider: make the column required"
        else:
            assert ok and isinstance(value, int) and 1 <= value <= 99, (label, src, value)
    for g in gates:
        kind, path = g.split(":", 1)
        if kind == "input":
            _check_input_gate("paneTable", "when", path)
        else:
            assert _resolve_path(payload, path) == (True, "2026-11-05"), g
    # ⛔ and the gate CLOSES on a symbol with no row: asof is None there
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {})
    empty = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    assert empty["rating"]["asof"] is None and empty["rating"]["m1"] is None


def test_the_readout_source_parser_reads_the_rows_it_claims_to():
    sources = _js_rs_readout_sources()
    by_key = {}
    for key, field, src in sources:
        by_key.setdefault(key, {})[field] = src
    assert by_key["benchmark"]["source"] == "scalar:benchmark.resolved"
    assert by_key["rating"]["source"] == "scalar:rating.ibd"
    # the card's Note row and the glance row's second line read the server's
    # sentence (2026-11-07), never the raw fallback code
    assert by_key["benchmarkNote"] == {"source": "scalar:benchmark.note", "when": "scalar:benchmark.note"}
    assert by_key["benchmarkName"]["note"] == "scalar:benchmark.note"
    assert by_key["regime"]["source"] == "scalar:regime.label"
    assert by_key["checks"]["source"] == "scalar:checks.summary"
    # visual round A1: the glance rows read the server's summary strings; the
    # numbers move into the cards (the detail rows keep the raw scalars)
    # v4 (3-08): the Reading's equals gate is read, not skipped
    assert by_key["mansfield"] == {"source": "scalar:mansfield.summary", "when": "input:view=mansfield",
                                  "evidenceSource": "scalar:evidence.sentence.mansfield"}
    assert by_key["rotation"] == {"source": "scalar:rotation.summary", "when": "input:view=rotation",
                                 "muted": "scalar:rotation.reason"}
    assert by_key["quality"] == {"source": "scalar:quality.summary", "when": "input:view=quality",
                                "muted": "scalar:quality.reason"}
    assert by_key["vars"] == {"source": "scalar:vars.summary", "when": "input:view=vars", "muted": "scalar:vars.reason"}
    assert by_key["checkAnchorPicked"] == {"source": "input:anchorDate", "when": "input:anchorDate"}
    assert by_key["mansfieldValue"]["source"] == "scalar:mansfield.value"
    assert by_key["ratingSummary"]["source"] == "scalar:rating.summary"
    assert by_key["phase"]["source"] == "scalar:legend.summary"
    assert by_key["rsHigh"]["source"] == "scalar:lastRsHigh.summary"
    for key, check in (("checkMa", "ma"), ("checkAnchor", "anchor"), ("checkPivot", "pivotSpeed"),
                       ("checkGreenOnRed", "greenOnRed")):
        assert by_key[key]["source"] == f"scalar:checks.{check}.line", key
    assert by_key["sensitivity"]["source"] == "scalar:sensitivity.summary"
    assert by_key["theme"]["source"] == "scalar:theme.label"
    # 2b-09: the five measured signals' cards read the provider's evidence sentence
    for key in ep.CARD_SIGNALS:
        assert by_key[key]["evidenceSource"] == f"scalar:evidence.sentence.{key}", key
    assert "evidenceSource" not in by_key["benchmark"] and "evidenceSource" not in by_key["rating"]


def test_the_short_history_payload_still_resolves_every_row_or_answers_null_with_a_reason(v4_row, monkeypatch):
    """The fail-closed half: on a short series the paths the rows read still
    EXIST (the surface prints a muted fallback for a null), so a null is never a
    missing key, and every null block carries its reason."""
    store = _long_daily(n=80)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    _no_cache(monkeypatch)
    payload = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    for key, field, src in _js_rs_readout_sources():
        kind, path = src.split(":", 1)
        if kind == "input":
            continue
        ok, _ = _resolve_path(payload, path)
        assert ok, f"readout[{key}].{field} = {src} is MISSING (not null) on a short series"
    assert payload["regime"]["label"] is None and payload["regime"]["reason"]
    assert payload["checks"]["summary"] is not None or payload["checks"]["ma"]["reason"]
    # 3-08: Quality needs 90 sessions; on 80 its block answers null WITH a reason,
    # which is what the glance row's `muted` gate reads
    assert payload["quality"]["score"] is None and payload["quality"]["reason"]
    assert payload["rating"]["ibd"] is None and payload["rating"]["source"] in ("dark", "missing")


# ── the alert lane reads the rsLine rev through the `rs_line` base (2b-05 finding) ──

def test_a_bound_rs_alert_address_reads_the_rsLine_rev_not_the_default():
    """`compute_rev` keys `ADDRESS_REVS` on `plot_base(address)`, which for the
    RS alert addresses is `rs_line` (`alert_rs_series.RS_BASE`) while the table
    is keyed by the definition id `rsLine` (held equal to the JS registry by
    `test_the_python_rev_table_matches_the_JS_registry`). Without the alias a
    bound `rs_line.*` alert read DEFAULT_REV 1 against a rev-3 definition.
    Rev 4 since Phase 3 unit 3-05, rev 5 since Deepvue round 2 (a vocabulary
    mirror both times; no binding migrates)."""
    from api.services import alert_rev_migration as rev
    from api.services.indicator_alert_evaluator import plot_base, resolve_address
    assert plot_base(resolve_address("rs_line.crossUp")) == "rs_line"
    assert rev.ADDRESS_BASE_DEFINITION == {"rs_line": "rsLine"}
    assert rev.compute_rev("rs_line.crossUp") == 5
    assert rev.compute_rev("rs_line.newHigh") == 5
    assert rev.compute_rev("RS_LINE.NEWHIGH") == 5, "resolution folds case like every other address"
    # (`rsLine.<plot>` is NOT an alert address — the grammar is `rs_line.<plot>` —
    # and `resolve_address` lowercases an unknown one, so no assertion on it.)
    assert rev.compute_rev("vwap.vwap") == 2 and rev.compute_rev("rsi.rsi") == rev.DEFAULT_REV, "controls"
    assert "rs_line" not in rev.ADDRESS_REVS, "one table, keyed by definition id — the alias is the map, not a second row"


# ── payload.evidence: the 2b-03 artifact behind the cards ──────────────────
#
# `_rs_evidence` reads the artifact the 04:30 ET pull lands in DATA_DIR into
# `payload.evidence`, keyed by the readout rows' own keys (`CARD_SIGNALS`), so
# unit 2b-09 can point a card at `scalar:evidence.sentence.<key>`. The fixture
# is built by the 2b-01 builder (tests/test_rs_evidence_pull.py), never retyped.

from tests.test_rs_evidence_pull import fixture_artifact, write_artifact  # noqa: E402

EVIDENCE_KEYS = ("rsHigh", "beforePrice", "redDay", "phase", "mansfield")
# Pins moved 2026-11-07 (RS review #6, #7, #22): the measured sentence names its
# sessions, daily bars and the all-bars baseline; a signal the artifact carries
# under the floor says what was measured instead of "has not measured one yet".
# Moved again 2026-11-07 (owner decision N6): the hit rate states its base, the next open.
# Moved again 2026-11-07 (unit VA3): the hit rate carries its likely range (a 95% Wilson
# interval over the effective n, 240 sessions), and the withheld sentence says in plain
# words what a number needs instead of "(floor 100)".
BEFORE_PRICE_SENTENCE = ("1,284 RS new highs before price on 240 sessions, 2025-11-05 to 2026-11-04, daily bars: "
                         "58.3% (likely between 52.0% and 64.4%) beat SPY from the next session's open to the "
                         "close 63 sessions later "
                         "(about 3 months; median +2.1%), against 50.2% for all bars. "
                         "Universe as held, survivorship not yet corrected.")
RED_DAY_BELOW_FLOOR = ("UCT measured 40 events on 12 sessions, too few to print a hit rate: it needs at least "
                       "100 events on at least 100 different sessions.")
MANSFIELD_PENDING = ("UCT has recorded 300 events on 100 sessions, none with a complete 63-session window yet, "
                     "so no hit rate is printed.")


def test_the_evidence_block_reads_the_local_artifact_into_every_card_key(v2_row, monkeypatch, tmp_path):
    write_artifact(tmp_path, fixture_artifact())
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily()))
    _no_cache(monkeypatch)
    ev = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]["evidence"]
    assert ev["source"] == "artifact" and ev["asof"] == "2026-11-04" and ev["horizon"] == 63
    assert set(ev["signals"]) == set(EVIDENCE_KEYS) == set(ev["sentence"]) == set(ep.CARD_SIGNALS)
    bp = ev["signals"]["beforePrice"]
    assert bp["signal"] == "rs_new_high_before_price" and bp["horizon_bars"] == 63
    assert bp["hit_rate_pct"] == 58.3 and bp["n"] == 1284 and bp["median_excess_pct"] == 2.1
    assert bp["displayable"] is True
    assert ev["sentence"]["beforePrice"] == BEFORE_PRICE_SENTENCE
    # the red-day signal sits under the artifact's display floor in the fixture:
    # its numbers are carried, its sentence is the honest one
    rd = ev["signals"]["redDay"]
    assert rd["n"] == 40 and rd["displayable"] is False
    assert ev["sentence"]["redDay"] == RED_DAY_BELOW_FLOOR
    # the Mansfield cross has no complete 63-bar window yet: null, not invented
    mc = ev["signals"]["mansfield"]
    assert mc["hit_rate_pct"] is None and mc["displayable"] is False
    assert ev["sentence"]["mansfield"] == MANSFIELD_PENDING
    assert ev["baseline"] == {"n": 590000, "hit_rate_pct": 50.2, "median_excess_pct": 0.05, "horizon_bars": 63}
    # every card key maps to a signal the artifact carries
    assert set(ep.CARD_SIGNALS.values()) <= set(fixture_artifact()["per_signal"])


def test_the_evidence_block_is_honest_when_no_artifact_has_been_pulled(v2_row, monkeypatch):
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily()))
    _no_cache(monkeypatch)
    ev = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]["evidence"]
    assert ev["source"] == "none" and ev["asof"] is None and ev["baseline"] is None and ev["horizon"] == 63
    assert all(ev["signals"][k] is None for k in EVIDENCE_KEYS)
    assert all(ev["sentence"][k] == ep.HONESTY_SENTENCE for k in EVIDENCE_KEYS)
    assert ep.HONESTY_SENTENCE == "No published hit rate exists for this signal and UCT has not measured one yet."


def test_a_failing_artifact_read_never_costs_the_envelope(v2_row, monkeypatch):
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily()))
    _no_cache(monkeypatch)
    monkeypatch.setattr(ep, "load_local", lambda data_dir=None: (_ for _ in ()).throw(RuntimeError("disk")))
    env = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})
    assert env["payload"]["evidence"]["source"] == "none"
    assert env["payload"]["evidence"]["sentence"]["rsHigh"] == ep.HONESTY_SENTENCE
    assert "rsLine" in env["columns"]


def test_the_evidence_card_sources_resolve_with_and_without_the_artifact(v2_row, monkeypatch, tmp_path):
    """Unit 2b-09 pointed the five measured cards at `scalar:evidence.sentence.<key>`
    (parsed out of the registry, never retyped). Both halves of the readout rail
    hold for those paths: without the artifact they walk to the honesty
    sentence, never a missing key; with it, to the measured sentence where the
    signal clears the floor and the honesty sentence where it does not."""
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily()))
    _no_cache(monkeypatch)
    card_sources = {key: src for key, field, src in _js_rs_readout_sources() if field == "evidenceSource"}
    assert card_sources == {k: f"scalar:evidence.sentence.{k}" for k in ep.CARD_SIGNALS}, card_sources
    paths = ([src.split(":", 1)[1] for src in card_sources.values()]
             + ["evidence.signals." + k for k in EVIDENCE_KEYS]
             + ["evidence.signals.beforePrice.hit_rate_pct", "evidence.asof", "evidence.source", "evidence.horizon"])
    absent = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    for path in paths:
        ok, _ = _resolve_path(absent, path)
        assert ok, f"scalar:{path} is MISSING (not null) without the artifact"
    for key, src in card_sources.items():
        assert _resolve_path(absent, src.split(":", 1)[1]) == (True, ep.HONESTY_SENTENCE), key
    assert _resolve_path(absent, "evidence.signals.beforePrice.hit_rate_pct") == (True, None)
    write_artifact(tmp_path, fixture_artifact())
    present = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    for path in paths:
        ok, _ = _resolve_path(present, path)
        assert ok, f"scalar:{path} is MISSING with the artifact"
    assert _resolve_path(present, "evidence.signals.beforePrice.hit_rate_pct") == (True, 58.3)
    assert _resolve_path(present, card_sources["beforePrice"].split(":", 1)[1]) == (True, BEFORE_PRICE_SENTENCE)
    assert _resolve_path(present, card_sources["redDay"].split(":", 1)[1]) == (True, RED_DAY_BELOW_FLOOR)      # under the floor
    assert _resolve_path(present, card_sources["mansfield"].split(":", 1)[1]) == (True, MANSFIELD_PENDING)    # null statistic
    # the card keys ARE readout row keys the registry carries: 2b-09 added a
    # source to an existing row, never a new row
    row_keys = {key for key, _, _ in _js_rs_readout_sources()}
    assert set(ep.CARD_SIGNALS) <= row_keys, set(ep.CARD_SIGNALS) - row_keys


def test_the_honesty_sentence_is_ONE_fact_in_two_files():
    """The cards' static evidence line (`RS_HONESTY_SENTENCE`, nativeRegistry.js)
    and the provider's no-artifact sentence (`rs_evidence_pull.HONESTY_SENTENCE`)
    are the same words: a chart with no landed envelope and a chart whose
    envelope says "no artifact" must not read two different honesty lines."""
    assert _js_rs_honesty_sentence() == ep.HONESTY_SENTENCE



# ── The Benchmark row's second line (visual spec rows 1 and A8, 2026-11-07) ──

def _leg(index):
    return {"index": index}


def test_benchmark_note_names_the_missing_benchmark_bar_on_a_daily_chart():
    times = [20261103, 20261104, 20261105]
    bench = {"requested": "SPY", "resolved": "SPY", "fallback": None}
    # the newest bar has no ratio: the benchmark has no bar for that day yet
    assert rsp._rs_benchmark_note(bench, _leg(1), times, intraday=False) == "No SPY bar for Nov 5 yet"
    # no finite value anywhere in the window says the same
    assert rsp._rs_benchmark_note(bench, _leg(None), times, intraday=False) == "No SPY bar for Nov 5 yet"
    # control: the newest bar has a value, so there is no note at all
    assert rsp._rs_benchmark_note(bench, _leg(2), times, intraday=False) is None


def test_benchmark_note_stays_silent_where_a_date_would_mislead():
    times = [20261103, 20261104, 20261105]
    bench = {"requested": "SPY", "resolved": "SPY", "fallback": None}
    assert rsp._rs_benchmark_note(bench, _leg(1), times, intraday=True) is None
    assert rsp._rs_benchmark_note(bench, _leg(None), times, intraday=False, same_symbol=True) is None
    assert rsp._rs_benchmark_note(bench, _leg(None), [], intraday=False) is None


def test_benchmark_note_turns_every_fallback_reason_into_a_sentence():
    def note(requested, reason, resolved="SPY"):
        b = {"requested": requested, "resolved": resolved, "fallback": reason}
        return rsp._rs_benchmark_note(b, _leg(2), [1, 2, 3], intraday=False)

    assert note("SECTOR", "symbol is an ETF") == "Sector ETF not available for an ETF; using SPY"
    assert note("SECTOR", "no sector") == "Sector ETF not available: no sector on file; using SPY"
    assert note("SECTOR", "sector not mapped: Shell Companies") == \
        "Sector ETF not available for the Shell Companies sector; using SPY"
    assert note("INDUSTRY", "industry group too small", "XLK") == "Industry group too small to average; using XLK"
    assert note("INDUSTRY", "no industry", "XLK") == "Industry group not available: no industry on file; using XLK"
    assert note("INDUSTRY", "no industry or sector") == \
        "Industry group not available: no industry or sector on file; using SPY"
    # a reason the table does not know still prints, never vanishes
    assert note("SECTOR", "brand new reason") == "Sector ETF not available: brand new reason; using SPY"
    # control: no fallback, no note
    assert note("SPY", None) is None


def test_every_reason_the_resolver_can_return_has_a_sentence_shape():
    # the resolver's reasons, read from its own source, so a new one cannot ship unworded
    import inspect
    import re
    src = inspect.getsource(rb.resolve_benchmark)
    reasons = set(re.findall(r'"fallback": "([^"]+)"', src)) | set(re.findall(r'else "([^"]+)"', src))
    reasons |= set(re.findall(r'"([a-z ]+)" if [a-z]+ else', src))
    assert reasons, "control: the scan found the resolver's reasons"
    for r in reasons:
        assert r in rsp._RS_FALLBACK_SENTENCE, r
