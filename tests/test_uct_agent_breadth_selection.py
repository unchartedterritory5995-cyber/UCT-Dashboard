"""UCT Agent — ONE breadth reading-selection policy (owner 2026-10-13 audit; D5 amended the same day).

The three production failures of 2026-10-13, reproduced through the REAL /api/agent/breadth (+ /history)
routes with Market Intelligence's synthetic finalized world (last finalized = FIN, Oct 8) and BREADTH's
REAL `completed_sessions` selector over synthetic live payloads (Fri Oct 9 a closing-bars row; Mon Oct 12
in progress, or completed once its data time passes the close):

  F1  "% of Nasdaq stocks AT OR BELOW their 50-day" planned as a latest CLOSE → was the finalized close
      (Oct 8 here, Oct 9 in production) → now the newest completed session, a labelled provisional close,
      complemented from that SAME observation;
  F2  "US A50 at the October 12, 2026 close" → was refused ("latest finalized is …") → now Oct 12's
      completed close, labelled provisional — and refused (never another date) while Oct 12 trades;
  F3  "US 50-day breadth history for the last 30 trading days" → was an all-history "above 0%" search →
      now the last 30 sessions (mode rows), each with its status; an always-true search is refused.

Also: the finalized close is preferred whenever the session IS finalized; a non-trading date is the
session in effect on it (labelled); NH/NL stays finalized-only; every universe × 50/200; values never in
logs or the model's note. Synthetic values only; no network, no model.
"""
from __future__ import annotations

import json
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import breadth_current as bc
from api.services.uct_agent import breadth_now, breadth_select, turn
from tests.test_uct_agent_breadth_current import ADMIN, BASE, ET, FIN, world  # noqa: F401

MON_1152 = datetime(2026, 10, 12, 11, 52, tzinfo=ET)        # Oct 12 in progress
MON_1720 = datetime(2026, 10, 12, 17, 20, tzinfo=ET)        # Oct 12 completed (data passed the close)
OCT9, OCT12 = 60.2345, 61.2345                              # the synthetic completed closes (sentinels)
LEAKS = ("60.2345", "61.2345", "60.23", "61.23")


def payload(today_data_as_of: str, universes=("us", "nyse", "nasdaq")):
    rows = [{"date": "2026-10-09", "final": True, "metrics": {"pct_above_50sma": OCT9, "pct_above_200sma": OCT9,
                                                              "net_new_high_low": 99.0}},
            {"date": "2026-10-12", "final": False, "metrics": {"pct_above_50sma": OCT12, "pct_above_200sma": OCT12,
                                                               "net_new_high_low": 101.0}}]
    return {"ok": True, "as_of": today_data_as_of, "data_as_of": today_data_as_of,
            "universes": {u: {"ok": True, "population_drift": 0.01, "rows": rows} for u in universes}}


@pytest.fixture
def at(monkeypatch):
    """Steer BREADTH's real completed_sessions: `at(now, payload)`; finalized = {FIN: …} (MI's watermark)."""
    real = bc.completed_sessions

    def set_(now, p):
        monkeypatch.setattr(bc, "_inputs", lambda u, m: (p, {FIN: 25.6, "2026-10-07": 24.0}))
        monkeypatch.setattr(bc, "completed_sessions", lambda u, m, now_=None: real(u, m, now=now))
    return set_


@pytest.fixture
def client(world, monkeypatch):
    monkeypatch.setenv("AGENT_BREADTH_CURRENT", "1")
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[rx.require_admin_dark] = lambda: ADMIN
    return TestClient(app)


def post(client, **kw):
    return client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": ["pct_above_50sma"],
                                                   "side": None, "sessions": None, **kw}).json()


# ═══ F1 · at or below, at the close ══════════════════════════════════════════════════════════════

def test_F1_at_or_below_at_the_close_is_the_newest_COMPLETED_session_complemented_from_it(client, at):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    b = post(client, universe="nasdaq", basis="close", side="below")
    p = b["present"]
    assert p["value"] == "38.8%"                                               # 100 − 61.2345, Oct 12's close
    assert p["label"] == "NASDAQ · % of Stocks At or Below 50-Day MA"
    assert p["note"] == f"Provisional close · Oct 12. {breadth_select.NOT_FINALIZED}"
    assert "finalized" not in p["note"].split(".")[0].lower()                 # never called finalized
    assert not any(s in json.dumps(b["present"]) for s in LEAKS)


def test_F1_while_the_session_trades_the_latest_close_is_the_previous_completed_one(client, at):
    at(MON_1152, payload("2026-10-12T11:51:30-04:00"))
    p = post(client, universe="nasdaq", basis="close", side="below")["present"]
    assert p["value"] == "39.8%" and p["note"].startswith("Provisional close · Oct 9")    # never today's in-progress


def test_F1_no_completed_session_newer_than_finalized_keeps_the_finalized_close(client, at):
    at(MON_1720, {"ok": False, "reason": "boot grace"})
    p = post(client, basis="close")["present"]
    assert p["value"] == "25.6%" and p["note"].startswith(f"As of {FIN} close")


# ═══ F2 · a dated close ══════════════════════════════════════════════════════════════════════════

def test_F2_the_october_12_close_is_its_completed_close_labelled_provisional(client, at):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    b = post(client, date="2026-10-12")
    assert b["status"] == "ok"
    assert b["present"] == {"kind": "value", "value": "61.2%", "label": "US · % of Stocks Above 50-Day MA",
                            "note": f"Provisional close · Oct 12. {breadth_select.NOT_FINALIZED}"}
    assert b["chart"]["symbol"]                                                 # Open chart keeps its series


def test_F2_a_session_still_trading_is_refused_never_another_date(client, at):
    at(MON_1152, payload("2026-10-12T11:51:30-04:00"))
    b = post(client, date="2026-10-12")
    assert b["status"] == "refused"
    assert "Oct 9" not in json.dumps(b["present"]) and "60.2" not in json.dumps(b["present"])


def test_F2_a_finalized_session_is_ALWAYS_the_finalized_close(client, at):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    p = post(client, date=FIN)["present"]
    assert p["value"] == "25.6%" and "Provisional" not in p["note"]


def test_F2_a_weekend_date_is_the_session_in_effect_on_it_labelled(client, at):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    p = post(client, date="2026-10-10")["present"]                              # Saturday → Fri Oct 9
    assert p["value"] == "60.2%"
    assert p["note"].startswith("Provisional close · Oct 9 (the session in effect on 2026-10-10)")


@pytest.mark.parametrize("universe", ["us", "nyse", "nasdaq"])
@pytest.mark.parametrize("metric", ["pct_above_50sma", "pct_above_200sma"])
def test_F2_every_universe_and_period(client, at, universe, metric):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    p = post(client, universe=universe, metrics=[metric], date="2026-10-12")["present"]
    assert p["value"] == "61.2%" and p["note"].startswith("Provisional close · Oct 12")


def test_NHNL_stays_finalized_only_for_closes_and_dates(client, at):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    b = post(client, metrics=["net_new_high_low"], date="2026-10-12")
    assert b["status"] == "refused" and "101" not in json.dumps(b)
    p = post(client, metrics=["net_new_high_low"], basis="close")["present"]
    assert "Provisional" not in p.get("note", "")


def test_SOURCE_LAG_a_session_MI_has_finalized_is_ALWAYS_finalized_even_if_Breadth_still_lists_it(client, monkeypatch):
    """Finalization reaches the two sources at slightly different moments. When MI has FIN finalized but
    Breadth's finalized tail still ends a session earlier (so FIN is still among its completed sessions),
    the finalized close wins — for the date AND for the latest close."""
    real = bc.completed_sessions
    lagged = {"ok": True, "as_of": "2026-10-09T16:00:30-04:00", "data_as_of": "2026-10-09T16:00:30-04:00",
              "universes": {u: {"ok": True, "population_drift": 0.01, "rows": [
                  {"date": FIN, "final": True, "metrics": {"pct_above_50sma": OCT9}}]} for u in ("us", "nyse", "nasdaq")}}
    monkeypatch.setattr(bc, "_inputs", lambda u, m: (lagged, {"2026-10-07": 24.0}))     # Breadth: finalized through Oct 7
    monkeypatch.setattr(bc, "completed_sessions", lambda u, m, now_=None: real(u, m, now=MON_1720))
    assert [x["session"] for x in bc.completed_sessions("us", "pct_above_50sma")["sessions"]] == [FIN]   # the lag itself
    for kw in ({"date": FIN}, {"basis": "close"}):
        p = post(client, **kw)["present"]
        assert p["value"] == "25.6%" and "Provisional" not in p["note"], kw


# ═══ F3 · the last N sessions ════════════════════════════════════════════════════════════════════

def rows(client, **kw):
    return post(client, mode="rows", sessions=30, **kw)


def test_F3_the_last_30_sessions_finalized_then_completed_provisional_each_with_its_status(client, at):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    b = rows(client)
    assert b["status"] == "ok" and b["present"]["kind"] == "table"
    t = b["table"]["rows"]
    assert len(t) == 30
    assert [r["session"] for r in t[:3]] == ["2026-10-12", "2026-10-09", FIN]      # newest first, no gap invented
    assert [r["status"] for r in t[:3]] == ["Provisional close", "Provisional close", "Finalized"]
    assert all(r["status"] == "Finalized" for r in t[2:])
    assert t[0]["value"] == "61.2%" and t[2]["value"] == "25.6%"
    assert sorted(r["session"] for r in t) == [r["session"] for r in reversed(t)]   # strictly ordered
    assert "last 30 sessions" in b["present"]["text"] and b["chart"]["symbol"]


def test_F3_while_the_session_trades_today_is_not_a_row(client, at):
    at(MON_1152, payload("2026-10-12T11:51:30-04:00"))
    t = rows(client)["table"]["rows"]
    assert t[0]["session"] == "2026-10-09" and "2026-10-12" not in [r["session"] for r in t]


def test_F3_below_complements_every_row_and_NHNL_rows_are_finalized_only(client, at):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    t = rows(client, side="below")["table"]["rows"]
    assert t[0]["value"] == "38.8%" and t[2]["value"] == "74.4%"
    n = rows(client, metrics=["net_new_high_low"])["table"]["rows"]
    assert all(r["status"] == "Finalized" for r in n)


@pytest.mark.parametrize("bad", [0, 251, -3, None, "30", True])
def test_F3_a_session_count_out_of_range_is_refused(client, at, bad):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    assert post(client, mode="rows", sessions=bad)["status"] == "refused"


def test_F3_more_sessions_than_exist_says_so(client, at, world):
    at(MON_1720, {"ok": False, "reason": "down"})
    b = post(client, mode="rows", sessions=250)
    assert b["status"] == "ok" and len(b["table"]["rows"]) <= 250


@pytest.mark.parametrize("op, level", [("above", 0), ("at_or_above", 0), ("below", 100), ("at_or_below", 100)])
def test_F3_an_always_true_threshold_search_is_refused_not_run(client, op, level, monkeypatch):
    from api.services.market_intel import breadth_events
    monkeypatch.setattr(breadth_events, "run", lambda body: pytest.fail("an always-true search must not run"))
    b = client.post("/api/agent/breadth/history", json={"universe": "us", "metric": "pct_above_50sma", "op": op, "level": level,
                                                        "find": "count", "start": None, "end": None, "aggregation": "daily"}).json()
    assert b["status"] == "refused" and "last N sessions" in b["text"]


# ═══ isolation ═══════════════════════════════════════════════════════════════════════════════════

def test_LOGS_and_the_models_note_carry_no_value(client, at, caplog):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    with caplog.at_level("INFO"):
        post(client, date="2026-10-12")
        rows(client)
    assert not any(s in caplog.text for s in LEAKS) and "provisional=1" in caplog.text
    note = turn._local_requests({"requests": [{**BASE, "mode": "rows", "metrics": ["pct_above_50sma"], "sessions": 30, "side": "below"}]})
    assert note == "The member asked for: breadth sessions list (US: pct_above_50sma — share at or below; the last 30 sessions)."


def test_POLICY_now_is_unchanged_the_current_reading(client, at, monkeypatch):
    at(MON_1720, payload("2026-10-12T16:00:30-04:00"))
    monkeypatch.setattr(breadth_now, "_reader", lambda: (lambda u, m: {"ok": True, "current": True, "status": "intraday",
                                                                        "session": "2026-10-13", "value": 40.04, "label": "Intraday · 10:31 AM ET",
                                                                        "accuracy_tier": "validated"}))
    assert post(client)["present"]["note"] == "Intraday · 10:31 AM ET"


def test_WHEN_classification():
    w = breadth_select.when_of
    assert w({"mode": "value"}) == "now" and w({"mode": "value", "basis": "close"}) == "latest_close"
    assert w({"mode": "value", "date": "2026-10-12"}) == "session" and w({"mode": "rows"}) == "rows"
    assert w({"mode": "compare"}) == "compare" and w({"mode": "series"}) == "series" and w(None) == "other"
