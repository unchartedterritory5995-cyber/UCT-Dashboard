"""The member route GET /api/wisdom/archive/ticker/{sym} applies the archive's aging rule.

SYNTHETIC data only — the repo is public. Tickers are ZZ-prefixed.

The archive's rule (provider.PRICE_AGE_SESSIONS, decided by provider.is_aged): a call's stated
prices and its measured outcome leave the archive only once the call is MORE than 20 trading
sessions old. team_history.py and ask_setup.py already apply it; this route did not.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a call 20 sessions old or younger carrying entry / stop / target / reported, or any outcome
   value, or lacking `prices_status: "pending_age"`;
2. an aged call losing its prices or outcome, or lacking `prices_status: "shown"`;
3. the boundary disagreeing with provider.is_aged (exactly 20 sessions is pending, 21 is shown),
   on a session day AND on a weekend;
4. a young call's r20 leaking into the ticker summary (n_scored / mean_r20).
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import provider, service
from api.services.wisdom.core import store
from tests.authclients import PAID_MEMBER, authorize

SECRET = "s3cret-member-ticker-age-test"
BATCH = "/api/internal/wisdom/archive/batch"
AUTH = {"Authorization": f"Bearer {SECRET}"}
ROUTE = "/api/wisdom/archive/ticker/ZZAG"
TODAY = date(2026, 10, 14)                     # a Wednesday (a session day)
SATURDAY = date(2026, 10, 17)


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


def _pin_today(monkeypatch, today):
    monkeypatch.setattr(provider, "_today", lambda: today)


def _client(user):
    a = FastAPI()
    a.include_router(wisdom_archive.member_router)
    a.include_router(wisdom_archive.internal_router)
    if user is not None:
        authorize(a, user)
    return TestClient(a, raise_server_exceptions=False)


def _posted_at_age(n: int, today: date) -> date:
    """The latest calendar date whose sessions_since(today) is exactly n (searched, not assumed)."""
    d = today
    for _ in range(80):
        if provider.sessions_since(d, today) == n:
            return d
        d -= timedelta(days=1)
    raise AssertionError(f"no date {n} sessions before {today}")


def _call(cid, posted: date, r20, **kw):
    c = {"call_id": cid, "record_id": cid.split("#")[0], "author_id": "tsdr", "ticker": "ZZAG",
         "direction": "long", "setup": "synthetic_setup", "action": "entry",
         "posted": posted.isoformat() + "T14:00:00", "entry": 10.0, "stop": 9.0, "target": 13.0,
         "reported": "synthetic +12%", "outcome": {"r1": 0.01, "r5": 0.03, "r20": r20, "sim_R": 2.0}}
    c.update(kw)
    return c


def _seed(calls):
    r = _client(None).post(BATCH, json={"kind": "calls", "items": calls}, headers=AUTH)
    assert r.status_code == 200 and r.json()["inserted"] == len(calls), r.text


def _by_id(payload):
    return {c["call_id"]: c for c in payload["calls"]}


def test_a_young_call_has_no_prices_and_no_outcome(wisdom_db, on, monkeypatch):
    _pin_today(monkeypatch, TODAY)
    _seed([_call("t9701#0", TODAY - timedelta(days=2), 0.40)])
    c = _by_id(_client(PAID_MEMBER).get(ROUTE).json())["t9701#0"]
    assert c["prices_status"] == "pending_age"
    assert c["entry"] is None and c["stop"] is None and c["target"] is None and c["reported"] is None
    assert c["outcome"] == {"r5": None, "r20": None}                 # r1 / sim_R do not ride along
    assert c["posted"].startswith((TODAY - timedelta(days=2)).isoformat())   # the call itself still shows


def test_an_aged_call_keeps_its_prices_and_outcome(wisdom_db, on, monkeypatch):
    _pin_today(monkeypatch, TODAY)
    _seed([_call("t9702#0", date(2025, 1, 2), 0.10)])
    c = _by_id(_client(PAID_MEMBER).get(ROUTE).json())["t9702#0"]
    assert c["prices_status"] == "shown"
    assert (c["entry"], c["stop"], c["target"], c["reported"]) == (10.0, 9.0, 13.0, "synthetic +12%")
    assert c["outcome"]["r5"] == 0.03 and c["outcome"]["r20"] == 0.10 and c["outcome"]["sim_R"] == 2.0


@pytest.mark.parametrize("today", [TODAY, SATURDAY], ids=["session-day", "weekend"])
def test_the_boundary_is_provider_is_aged_exactly(wisdom_db, on, monkeypatch, today):
    _pin_today(monkeypatch, today)
    at20, at21 = _posted_at_age(20, today), _posted_at_age(21, today)
    assert not provider.is_aged(at20, today) and provider.is_aged(at21, today)      # control
    _seed([_call("t9703#0", at20, 0.20), _call("t9704#0", at21, -0.05)])
    out = _client(PAID_MEMBER).get(ROUTE).json()
    calls = _by_id(out)
    assert calls["t9703#0"]["prices_status"] == "pending_age" and calls["t9703#0"]["entry"] is None
    assert calls["t9703#0"]["outcome"]["r20"] is None
    assert calls["t9704#0"]["prices_status"] == "shown" and calls["t9704#0"]["entry"] == 10.0
    assert calls["t9704#0"]["outcome"]["r20"] == -0.05
    # the summary agrees with the rows: only the 21-session call is scored
    assert out["n_calls"] == 2 and out["n_scored"] == 1 and abs(out["mean_r20"] - (-0.05)) < 1e-9
    assert out["age_sessions"] == provider.PRICE_AGE_SESSIONS


def test_a_young_calls_r20_cannot_leak_through_the_summary(wisdom_db, on, monkeypatch):
    _pin_today(monkeypatch, TODAY)
    _seed([_call("t9705#0", date(2025, 1, 2), 0.10), _call("t9706#0", TODAY - timedelta(days=1), 0.90)])
    out = _client(PAID_MEMBER).get(ROUTE).json()
    assert out["n_calls"] == 2 and out["n_scored"] == 1 and abs(out["mean_r20"] - 0.10) < 1e-9
    with store.read() as conn:                                        # the admin summary is untouched
        assert service.ticker_summary(conn, "ZZAG")["n_scored"] == 2


def test_the_admin_route_is_not_gated(wisdom_db, on, monkeypatch):
    """Scope control: the gate is the MEMBER shape. The admin read still sees stated prices."""
    _pin_today(monkeypatch, TODAY)
    _seed([_call("t9707#0", TODAY - timedelta(days=1), 0.30)])
    with store.read() as conn:
        c = service.by_ticker(conn, "ZZAG")["calls"][0]
    assert c["entry"] == 10.0 and "prices_status" not in c
