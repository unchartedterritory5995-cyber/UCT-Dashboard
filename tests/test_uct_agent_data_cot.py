"""MD-1 kind `cot.positioning` (Phase 2 COT research) — CFTC Commitments of Traders rows for the Agent.

No network, no cot.db: `cot_service.get_cot_data` is stubbed at its public read, and the ET clock is pinned. Pins:
symbol resolution (member words → stored codes, never a guess), as_of = the Tuesday REPORT date, the publish delay,
stale by the service's OWN calendar rule (expected_latest_report_date), missing weeks counted (never filled), unmapped
and no-history markets refused with the covered roster, the gateway's dark gate, and ACCESS: an anonymous or unpaid
request through the Agent's real doors gets no COT data.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import cot_service
from api.services.uct_agent.marketdata import cot
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

# Friday 2026-11-13, 18:00 ET — after the 16:30 publish threshold, so the expected report is Tuesday 2026-11-10
NOW = datetime(2026, 11, 13, 18, 0, tzinfo=cot._ET)
EXPECTED = date(2026, 11, 10)


def _rows(last: date, n: int, *, skip: tuple = (), base: int = 1000):
    """n weekly rows ending at `last` (ascending); weeks whose index (from the end) is in `skip` are absent."""
    out = []
    for i in range(n - 1, -1, -1):
        if i in skip:
            continue
        d = last - timedelta(days=7 * i)
        k = n - i
        out.append({"date": d.isoformat(), "large_spec_net": base + 10 * k, "commercial_net": -base - 7 * k,
                    "small_spec_net": 5 * k - 50, "open_interest": 10 * base + k})
    return out


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, cot.KIND)
    gw._reset_for_test(None)
    monkeypatch.setattr(cot, "now_et", lambda: NOW)
    yield
    gw._reset_for_test(None)


@pytest.fixture()
def store(monkeypatch):
    data: dict[str, list] = {}
    calls: list = []

    def get(sym, weeks=52):
        calls.append((sym, weeks))
        return list(data.get(sym, []))[-weeks:]
    monkeypatch.setattr(cot_service, "get_cot_data", get)
    return data, calls


def _read(params, turn="t1"):
    return gw.read(cot.KIND, params, user_id=1, turn_id=turn, purpose="answer")


# ── symbol resolution ────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("word,code", [
    ("gold", "GC"), ("Gold futures", "GC"), ("crude", "CL"), ("crude oil", "CL"), ("the S&P", "ES"), ("S&P 500", "ES"),
    ("10-year", "ZN"), ("the 10-year note", "ZN"), ("euro", "E6"), ("yen", "J6"), ("bitcoin's", "BTC"), ("GC", "GC"),
    ("es", "ES"), ("Nasdaq", "NQ"), ("natural gas", "NG"), ("Euro FX", "E6"), ("VIX", "VI"), ("sr3", "SR3"),
])
def test_member_words_resolve_to_stored_codes(word, code):
    assert cot.resolve(word) == code
    assert code in cot_service.SYMBOL_MAP


@pytest.mark.parametrize("word", ["tesla", "NVDA", "lithium", "uranium", "iron ore", "", "s&p 600"])
def test_unmapped_words_are_never_guessed(word):
    assert cot.resolve(word) is None


def test_every_alias_points_at_a_stored_code():
    assert set(cot.ALIASES.values()) <= set(cot_service.SYMBOL_MAP)


# ── as_of / freshness / delay ─────────────────────────────────────────────────────────────────────
def test_as_of_is_the_tuesday_report_date_with_the_friday_delay_and_not_stale(store):
    data, calls = store
    data["GC"] = _rows(EXPECTED, 200)
    out = _read({"symbols": ["gold"], "weeks": 160})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] == "2026-11-10T00:00:00Z"
    assert out["delay_s"] == 3 * 86400 and out["provider_calls"] == 0
    d = out["data"]
    assert d["report_date"] == "2026-11-10" and d["expected_report_date"] == "2026-11-10" and d["delay_days"] == 3
    s = d["series"][0]
    assert s["symbol"] == "GC" and s["name"] == "Gold" and s["weeks"] == 160 and s["missing_weeks"] == 0
    assert s["rows"][-1]["date"] == "2026-11-10" and set(s["rows"][0]) == {
        "date", "large_spec_net", "commercial_net", "small_spec_net", "open_interest"}
    assert cot.NOTE_DELAY in out["notes"] and cot.NOTE_WEEKLY in out["notes"]
    assert calls == [("GC", 160)]


def test_stale_when_older_than_the_services_expected_report(store):
    data, _ = store
    data["GC"] = _rows(EXPECTED - timedelta(days=14), 60)       # 17 days old on the read: two releases missed
    out = _read({"symbols": ["GC"], "weeks": 52})
    assert out["stale"] is True and out["data"]["series"][0]["stale"] is True
    assert any(n.startswith("the newest stored report is 2026-10-27") for n in out["notes"])


def test_stale_uses_the_services_own_calendar_rule_not_a_copy(store, monkeypatch):
    data, _ = store
    data["GC"] = _rows(EXPECTED, 10)
    # the service decides; moving its answer moves ours (no duplicated Friday/Tuesday rule here)
    monkeypatch.setattr(cot_service, "expected_latest_report_date", lambda now: EXPECTED + timedelta(days=7))
    assert _read({"symbols": ["GC"], "weeks": 10})["stale"] is True
    monkeypatch.setattr(cot_service, "expected_latest_report_date", lambda now: EXPECTED)
    assert _read({"symbols": ["GC"], "weeks": 10}, turn="t2")["stale"] is False


def test_friday_before_the_publish_time_expects_the_previous_tuesday(store, monkeypatch):
    data, _ = store
    data["GC"] = _rows(EXPECTED - timedelta(days=7), 10)
    monkeypatch.setattr(cot, "now_et", lambda: NOW.replace(hour=12))
    out = _read({"symbols": ["GC"], "weeks": 10})
    assert out["stale"] is False and out["data"]["expected_report_date"] == "2026-11-03"


def test_comparison_as_of_is_the_oldest_report_and_only_the_lagging_market_is_stale(store):
    data, _ = store
    data["GC"] = _rows(EXPECTED, 30)
    data["SI"] = _rows(EXPECTED - timedelta(days=7), 30)
    out = _read({"symbols": ["gold", "silver"], "weeks": 30})
    assert out["as_of"] == "2026-11-03T00:00:00Z" and out["stale"] is True
    assert [(s["symbol"], s["stale"]) for s in out["data"]["series"]] == [("GC", False), ("SI", True)]


def test_missing_weeks_are_counted_never_filled(store):
    data, _ = store
    data["CL"] = _rows(EXPECTED, 20, skip=(3, 4, 9))
    out = _read({"symbols": ["crude"], "weeks": 20})
    s = out["data"]["series"][0]
    assert s["missing_weeks"] == 3 and len(s["rows"]) == 17
    assert any(n.startswith("the store holds 17 weeks for CL") for n in out["notes"])


# ── not covered / no history: refused, with the roster ───────────────────────────────────────────
def test_unmapped_word_is_not_covered_with_the_roster(store):
    data, calls = store
    data["GC"] = _rows(EXPECTED, 10)
    out = _read({"symbols": ["gold", "lithium"], "weeks": 10})
    assert env.validate_envelope(out) == []
    assert out["status"] == "partial" and out["data"]["not_covered"] == ["lithium"]
    roster = out["data"]["covered"]
    assert {"symbol": "GC", "name": "Gold", "group": "Metals"} in roster and len(roster) == len(cot_service.SYMBOL_MAP)
    assert calls == [("GC", 10)]                                # never read for the unmapped word


def test_all_unmapped_is_an_honest_partial_with_no_figure(store):
    _, calls = store
    out = _read({"symbols": ["tesla"], "weeks": 10})
    assert env.validate_envelope(out) == []
    assert out["status"] == "partial" and out["as_of"] is None and out["data"]["series"] == []
    assert out["data"]["not_covered"] == ["tesla"] and out["data"]["covered"] and calls == []


def test_a_mapped_market_with_no_rows_is_no_history_never_fabricated(store):
    out = _read({"symbols": ["gold"], "weeks": 10})
    assert out["data"]["series"] == [] and out["data"]["no_history"] == ["GC"]
    assert out["coverage"] == {"requested": 1, "answered": 0}


@pytest.mark.parametrize("params", [{}, {"symbols": []}, {"symbols": "gold"}, {"symbols": ["gold"] * 7},
                                    {"symbols": ["gold"], "weeks": 0}, {"symbols": ["gold"], "weeks": 521},
                                    {"symbols": ["<script>"]}, {"symbols": ["gold"], "weeks": True}])
def test_bad_requests_are_refused_before_any_read(store, params):
    _, calls = store
    out = _read(params)
    assert out["status"] == "refused" and calls == []


# ── dark gate ────────────────────────────────────────────────────────────────────────────────────
def test_dark_unless_the_kind_is_named(store, monkeypatch):
    _, calls = store
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes")
    assert _read({"symbols": ["gold"]})["status"] == "refused"
    monkeypatch.delenv(gw.DATA_ENV)
    assert _read({"symbols": ["gold"]}, turn="t2")["status"] == "refused"
    assert calls == []


# ── ACCESS: the Agent's real doors give anonymous and unpaid callers no COT data ───────────────────
COT_ASK = "where are large speculators positioned in gold?"


def _app(user=None):
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import uct_agent as rx
    app = FastAPI()
    app.include_router(rx.router)
    if user is not None:                       # identity only; the paid / admin gates stay the real dependencies
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize("user,code", [(None, 401), ({"id": "u-free", "plan": "free", "role": "user"}, 402)])
def test_anonymous_and_unpaid_get_no_cot_data_through_any_agent_door(store, user, code):
    data, calls = store
    data["GC"] = _rows(EXPECTED, 10)
    c = _app(user)
    r = c.post("/api/agent/data", json={"kind": cot.KIND, "params": {"symbols": ["gold"]}, "turn_id": "t-anon"})
    assert r.status_code == code and "series" not in r.text
    for path in ("/api/agent/turn", "/api/agent/turn/stream", "/api/agent/turn/resume"):
        r = c.post(path, json={"message": COT_ASK, "context": {}, "capabilities": []})
        assert r.status_code == code, path
    assert calls == []                         # the COT store was never read


def test_a_paid_member_who_is_not_an_admin_is_refused_too_while_the_agent_is_dark(store):
    data, calls = store
    data["GC"] = _rows(EXPECTED, 10)
    r = _app({"id": "u-paid", "plan": "pro", "role": "user"}).post(
        "/api/agent/data", json={"kind": cot.KIND, "params": {"symbols": ["gold"]}, "turn_id": "t-m"})
    assert r.status_code == 403 and calls == []


def test_an_admin_reads_it_through_the_gateway(store):
    data, calls = store
    data["GC"] = _rows(EXPECTED, 10)
    r = _app({"id": "u-admin", "plan": "pro", "role": "admin"}).post(
        "/api/agent/data", json={"kind": cot.KIND, "params": {"symbols": ["gold"], "weeks": 10}, "turn_id": "t-a"})
    assert r.status_code == 200 and r.json()["data"]["series"][0]["symbol"] == "GC" and calls == [("GC", 10)]
