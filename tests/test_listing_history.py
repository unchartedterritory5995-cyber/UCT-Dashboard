"""e100 rails: the listing rule a SERVER run asks (``api/services/listing_history.py``).

  * PARITY: the port answers ``reference`` and ``rule`` on every case of ``tests/fixtures/listing_rule_parity.json``,
    the fixture the chart's own functions are held to (``listingSeedServerParity.test.js``);
  * the server's ONE extra condition: a FINAL first-trade decision, ``first_trade_final is True``;
  * a store key (``YYYYMMDD`` int) reads as the day the chart keys the bar by;
  * the facts are CACHE ONLY (``ticker_ipo.peek``): never a provider call, never a resolve kick;
  * off a daily timeframe, or with no bars, no fact is even asked.
No network.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import listing_history as lh
from api.services import ticker_ipo

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "listing_rule_parity.json").read_text(encoding="utf-8"))
CASES = FIXTURE["cases"]


def test_the_fixture_is_the_shared_one_and_exercises_both_arms():
    assert FIXTURE["schema"] == "uct.listing-rule-parity/v1"
    assert len(CASES) >= 15
    assert {c["rule"] for c in CASES} == {True, False}
    assert {c["server"] for c in CASES} == {True, False}
    # the case that tells finality from the rule: the rule holds, the server refuses
    assert any(c["rule"] and not c["server"] for c in CASES)


@pytest.mark.parametrize("case", CASES, ids=[c["name"][:60] for c in CASES])
def test_PARITY_the_port_answers_the_charts_rule_on_every_shared_case(case):
    ref = lh.listing_reference_date(case["ipo"])
    assert ref == case["reference"]
    assert lh.history_from_listing_of(case["bars"], case["tf"], ref) is case["rule"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"][:60] for c in CASES])
def test_FINAL_the_server_claims_the_listing_only_on_a_final_decision(case):
    assert lh.server_from_listing(case["bars"], case["tf"], case["ipo"]) is case["server"]
    ipo = case["ipo"]
    if case["rule"] and isinstance(ipo, dict):
        assert lh.server_from_listing(case["bars"], case["tf"], dict(ipo, first_trade_final=True)) is True
        for not_final in (False, None, "true", 1):
            assert lh.server_from_listing(case["bars"], case["tf"], dict(ipo, first_trade_final=not_final)) is False


@pytest.mark.parametrize("t,day", [(19930129, "1993-01-29"), ("1993-01-29", "1993-01-29"),
                                   ("1993-01-29T00:00:00Z", "1993-01-29"), (728265600, None), (True, None),
                                   ("Jan 29", None), (None, None), (18991231, None)])
def test_a_store_key_reads_as_the_day_the_chart_keys_the_bar_by(t, day):
    assert lh.store_day(t) == day


def _facts(monkeypatch, answer):
    asked = []

    def peek(sym):
        asked.append(sym)
        return answer
    monkeypatch.setattr(ticker_ipo, "peek", peek)
    return asked


FINAL = {"symbol": "SPY", "list_date": "1993-01-22", "first_trade_date": "1993-01-29", "first_trade_final": True}


def test_from_listing_for_reads_store_keys_and_the_cached_fact(monkeypatch):
    asked = _facts(monkeypatch, FINAL)
    assert lh.from_listing_for([{"t": 19930129}, {"t": 19930201}], "D", "SPY") is True
    assert lh.from_listing_for([{"t": "1993-01-29"}], "D", "SPY") is True
    assert lh.from_listing_for([{"t": 19930201}], "D", "SPY") is False      # a curtain
    assert asked == ["SPY", "SPY", "SPY"]


def test_from_listing_for_asks_nothing_off_daily_or_without_bars(monkeypatch):
    asked = _facts(monkeypatch, FINAL)
    for tf in ("W", "M", "60", "5", "", None):
        assert lh.from_listing_for([{"t": 19930129}], tf, "SPY") is False
    assert lh.from_listing_for([], "D", "SPY") is False
    assert asked == []


def test_an_unreadable_fact_is_the_curtain(monkeypatch):
    def boom(sym):
        raise RuntimeError("disk gone")
    monkeypatch.setattr(ticker_ipo, "peek", boom)
    assert lh.listing_facts("SPY") is None
    assert lh.from_listing_for([{"t": 19930129}], "D", "SPY") is False
    _facts(monkeypatch, None)
    assert lh.from_listing_for([{"t": 19930129}], "D", "SPY") is False
    _facts(monkeypatch, dict(FINAL, first_trade_final=False))
    assert lh.from_listing_for([{"t": 19930129}], "D", "SPY") is False


def test_peek_reads_memory_then_disk_and_never_a_provider_or_a_resolve(monkeypatch, tmp_path):
    monkeypatch.setattr(ticker_ipo, "_CACHE_DIR", str(tmp_path))
    for sym in ("ZZZQ", "ZZZM"):
        ticker_ipo._mem.invalidate(f"ticker_ipo_{sym}")
    calls = []

    def no_provider(*a, **k):
        calls.append(a)
        raise AssertionError("peek reached a provider or a resolve")
    monkeypatch.setattr(ticker_ipo, "_kick_resolve", no_provider)
    monkeypatch.setattr(ticker_ipo, "_resolve_first_trade", no_provider)
    import api.services.massive as massive
    monkeypatch.setattr(massive, "get_ticker_details", no_provider)
    assert ticker_ipo.peek("ZZZQ") is None
    ticker_ipo._disk_put("ZZZQ", dict(FINAL, symbol="ZZZQ"))
    assert ticker_ipo.peek("zzzq ")["first_trade_final"] is True
    ticker_ipo._mem.set("ticker_ipo_ZZZM", {"symbol": "ZZZM", "first_trade_final": False}, ttl=60)
    assert ticker_ipo.peek("ZZZM") == {"symbol": "ZZZM", "first_trade_final": False}
    assert ticker_ipo.peek("") is None
    assert calls == []


# ── the lanes that STAY at 5,000 (the ruling: sweeps / scans / screener backtests / definition records) ─────────

import ast  # noqa: E402

_STAY = ("api/services/screener/scan_evaluator.py", "api/routers/screener_backtest.py",
         "api/services/definition_record.py")
_LISTING_KWARGS = ("history_from_listing", "listing_depth_bars")


@pytest.mark.parametrize("rel", _STAY)
def test_STAY_the_sweep_the_screener_backtest_and_the_record_never_claim_the_listing(rel):
    tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"), filename=rel)
    for n in ast.walk(tree):
        if isinstance(n, ast.keyword) and n.arg in _LISTING_KWARGS:
            assert isinstance(n.value, ast.Constant) and n.value.value in (False, None), (rel, n.lineno, n.arg)
        assert not (isinstance(n, ast.Name) and n.id == "listing_history"), (rel, n.lineno)
        assert not (isinstance(n, ast.alias) and n.name.endswith("listing_history")), (rel, n.lineno)
        assert not (isinstance(n, ast.Attribute) and n.attr in ("from_listing_for", "server_from_listing")), (rel, n.lineno)


def test_STAY_every_default_is_the_curtain():
    """A lane that states nothing is a run off the listing: the client's Job and both lane adapters default false
    (definition_record and the sweep rely on it)."""
    import inspect
    from api.services import pine_runtime_client as prc
    assert prc.Job(job="a", ticker="A", tf="D", bars=[]).history_from_listing is False
    assert prc.Job(job="a", ticker="A", tf="D", bars=[]).listing_depth_bars is None
    tree = ast.parse((ROOT / "api/services/runtime_server_lane.py").read_text(encoding="utf-8"))
    defaults = []
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            kw = n.args.kwonlyargs
            for a, d in zip(kw, n.args.kw_defaults):
                if a.arg == "history_from_listing":
                    defaults.append(d)
    assert len(defaults) == 2 and all(isinstance(d, ast.Constant) and d.value is False for d in defaults)
    assert inspect.signature(prc.Job).parameters["history_from_listing"].default is False
