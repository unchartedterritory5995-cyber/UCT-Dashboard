"""UCT Agent — PRESENT-TENSE breadth from the Breadth team's current reading (owner decision 2026-10-12).

Through the REAL /api/agent/breadth route and the Breadth team's REAL decision function
(`breadth_current.choose`), fed synthetic live payloads and MI's synthetic finalized world. Pins:
  · present tense ("now", no date, not a close) → the current intraday / provisional reading, labelled
    with its own time/status; history, explicit closes, comparisons and ranges → finalized (D5);
  · a mixed overview labels each measure; new highs/lows stay finalized-only; counts say "approximate";
  · stale / unavailable live data is said, and the finalized close is shown as dated context;
  · after hours, weekends and pre-market follow the contract's sessions;
  · the kill switch and a missing dependency fall back to finalized;
  · ⛔ no current value reaches a model request, replayed history, chat naming, or the logs.
Synthetic values only; no model call, no network, no production data.
"""
from __future__ import annotations

import json
import logging
import types
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import breadth_current as bc
from api.services.uct_agent import breadth_now, turn
from tests.market_intel_breadth_fixtures import synthetic_breadth_world

ET = bc._ET
FIN = "2026-10-08"                    # latest finalized (production's shape on Mon 2026-10-12)
LIVE = 61.2345                        # the intraday sentinel — must never reach a model
LIVE_LEAKS = ("61.2345", "61.23", "61.2")
BASE = {"universe": "us", "date": None, "compare_date": None, "start": None, "end": None, "basis": None}
ADMIN = {"id": "c0ffee00-0000-4000-8000-0000000000a1", "plan": "pro", "role": "admin"}
MON_1152 = datetime(2026, 10, 12, 11, 52, tzinfo=ET)


def live_payload(as_of, today="2026-10-12", ok=True, drift=0.01, final_today=False, data_as_of="same"):
    """`as_of` = UCT's compute time; `data_as_of` = the vendor snapshot's data time (the label's source)."""
    m = {"pct_above_50sma": LIVE, "pct_above_200sma": 41.5, "adv_decline": 812.0, "net_new_high_low": 99.0,
         "new_52w_highs": 150.0}
    return {"ok": ok, "as_of": as_of, "data_as_of": as_of if data_as_of == "same" else data_as_of,
            "reason": None if ok else "engine down",
            "universes": {"us": {"ok": True, "population_drift": drift, "rows": [
                {"date": "2026-10-09", "final": True, "metrics": {k: v - 1 for k, v in m.items()}},
                {"date": today, "final": final_today, "metrics": m}]}}}


@pytest.fixture
def world(monkeypatch):
    st = synthetic_breadth_world(monkeypatch, sentinel=25.6, session=FIN, forbid_network=True)
    for row in st["avail"].values():
        row["last"] = FIN
    return st


@pytest.fixture
def live(monkeypatch):
    """Steer the Breadth team's REAL decision: `live.now` + `live.payload`; records each call."""
    state = types.SimpleNamespace(now=MON_1152, payload=live_payload("2026-10-12T11:51:30-04:00"), calls=[])

    def reading(universe, metric):
        state.calls.append((universe, metric))
        return bc.choose(universe, metric, state.now, state.payload, {FIN: 25.6, "2026-10-07": 24.0})
    monkeypatch.setattr(breadth_now, "_reader", lambda: reading)
    monkeypatch.setenv("AGENT_BREADTH_CURRENT", "1")            # ⛔ default OFF: these tests enable it explicitly
    return state


@pytest.fixture
def client(world):
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[rx.require_admin_dark] = lambda: ADMIN
    return TestClient(app)


def ask(client, **kw):
    return client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": ["pct_above_50sma"], **kw}).json()


# ═══ present tense → the current reading ═════════════════════════════════════════════════════════

def test_NOW_an_intraday_reading_with_its_observation_time(client, live):
    b = ask(client)
    assert b["present"] == {"kind": "value", "value": "61.2%", "label": "US · % of Stocks Above 50-Day MA",
                            "note": "Intraday · 11:51 AM ET"}
    assert live.calls == [("us", "pct_above_50sma")]
    # the finalized close stays as clearly dated context under Details
    assert "Latest finalized close" in b["text"] and FIN in b["text"]


def test_NOW_the_general_overview_labels_each_measure_its_own_way(client, live):
    b = client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": []}).json()
    p = b["present"]
    assert p["kind"] == "metrics" and p["title"] == "US breadth overview"
    notes = {i["label"]: (i["value"], i["note"]) for i in p["items"]}
    assert notes["% of Stocks Above 50-Day MA"] == ("61.2%", "Intraday · 11:51 AM ET")
    assert notes["% of Stocks Above 200-Day MA"] == ("41.5%", "Intraday · 11:51 AM ET")
    assert notes["Net Advancers (Daily)"] == ("+812", "Intraday · 11:51 AM ET · approximate count")
    v, n = notes["Net New 52-Week Highs-Lows"]
    assert n == "Finalized close · Oct 8 (finalized only)" and v != "+99"          # never the live NH/NL
    assert p["note"] == "Each measure shows its own time and status."


def test_NOW_a_new_highs_question_is_finalized_only_and_says_so(client, live):
    p = ask(client, metrics=["net_new_high_low"])["present"]
    assert p["note"] == "Finalized close · Oct 8 (finalized only). This measure is published from finalized closes only."
    assert p["value"] != "+99"


# ═══ history, closes, comparisons, ranges → finalized; reading() is not consulted ══════════════════

@pytest.mark.parametrize("req", [
    {"date": "2026-10-07"},                                                     # a historical date
    {"basis": "close"},                                                         # "at the latest close"
    {"mode": "compare", "compare_date": "2026-09-08"},
    {"mode": "series", "start": "2026-09-01"},
])
def test_HISTORY_and_CLOSES_stay_finalized(client, live, req):
    b = ask(client, **req)
    assert live.calls == []
    assert not any(s in json.dumps(b) for s in LIVE_LEAKS)


def test_CLOSE_an_explicit_closing_question_is_the_dated_finalized_close(client, live):
    p = ask(client, basis="close")["present"]
    assert p["value"] == "25.6%" and p["note"].startswith(f"As of {FIN} close")


# ═══ stale / unavailable → said, with the finalized close as dated context ═══════════════════════

@pytest.mark.parametrize("payload", [
    live_payload("2026-10-12T10:00:00-04:00"),                                  # 112 minutes old mid-session
    # ⛔ recomputed seconds ago over a 15-minute-DELAYED snapshot: the data time decides, never compute time
    live_payload("2026-10-12T11:51:30-04:00", data_as_of="2026-10-12T11:36:30-04:00"),
    live_payload("2026-10-12T11:51:30-04:00", data_as_of=None),                 # data time unknown
    live_payload("2026-10-12T11:51:30-04:00", ok=False),                        # engine down
    live_payload("2026-10-12T11:51:30-04:00", drift=0.2),                       # population doesn't reconcile
    None,                                                                       # no payload at all
])
def test_STALE_or_UNAVAILABLE_is_said_and_never_shown_as_now(client, live, payload):
    live.payload = payload
    b = ask(client)
    p = b["present"]
    assert p["value"] == "25.6%"                                                # the finalized close
    assert p["note"].startswith(f"As of {FIN} close")
    assert breadth_now.UNAVAILABLE in p["note"] and f". {breadth_now.UNAVAILABLE}" in p["note"]    # its own sentence
    assert "Intraday" not in json.dumps(b) and not any(s in json.dumps(b) for s in LIVE_LEAKS)


def test_STALE_in_an_overview_only_the_stale_measures_fall_back(client, live, monkeypatch):
    real = bc.choose

    def choose(u, m, now, payload, fin):
        return real(u, m, now, None if m == "pct_above_200sma" else payload, fin)
    monkeypatch.setattr(bc, "choose", choose)
    p = client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": []}).json()["present"]
    notes = {i["label"]: i["note"] for i in p["items"]}
    assert notes["% of Stocks Above 50-Day MA"] == "Intraday · 11:51 AM ET"
    assert notes["% of Stocks Above 200-Day MA"] == "Finalized close · Oct 8"
    assert "isn't available right now" in p["note"]


# ═══ after hours, weekend, pre-market ══════════════════════════════════════════════════════════════

def test_AFTER_HOURS_today_is_a_provisional_close(client, live):
    live.now = datetime(2026, 10, 12, 18, 30, tzinfo=ET)
    live.payload = live_payload("2026-10-12T16:05:00-04:00")
    p = ask(client)["present"]
    assert (p["value"], p["note"]) == ("61.2%", "Provisional close · Oct 12")


def test_WEEKEND_is_Fridays_provisional_close(client, live):
    live.now = datetime(2026, 10, 10, 12, 0, tzinfo=ET)
    live.payload = live_payload("2026-10-09T16:10:00-04:00", today="2026-10-09", final_today=True)
    p = ask(client)["present"]
    assert (p["value"], p["note"]) == ("61.2%", "Provisional close · Oct 9")


def test_PRE_MARKET_is_the_last_completed_session_not_today(client, live):
    live.now = datetime(2026, 10, 12, 8, 0, tzinfo=ET)
    live.payload = live_payload("2026-10-09T16:10:00-04:00", today="2026-10-09", final_today=True)
    p = ask(client)["present"]
    assert p["note"] == "Provisional close · Oct 9"


def test_MARKET_OPEN_yesterdays_close_is_not_now(client, live):
    """09:45 on Monday with only Friday's closing row live: a close while the session trades is not now."""
    live.now = datetime(2026, 10, 12, 9, 45, tzinfo=ET)
    live.payload = live_payload("2026-10-09T16:10:00-04:00", today="2026-10-09", final_today=True)
    p = ask(client)["present"]
    assert p["value"] == "25.6%" and breadth_now.UNAVAILABLE in p["note"]


# ═══ switches ══════════════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("value", [None, "", "   ", "0", "false", "off", "no", "OFF", "enabled", "2", "tru"])
def test_FLAG_default_OFF_missing_empty_disabled_or_malformed_is_finalized_exactly_as_before(client, live, monkeypatch, value):
    if value is None:
        monkeypatch.delenv("AGENT_BREADTH_CURRENT", raising=False)
    else:
        monkeypatch.setenv("AGENT_BREADTH_CURRENT", value)
    assert breadth_now.enabled() is False
    b = ask(client)
    assert live.calls == []                                                     # the live service is never asked
    assert b["present"]["value"] == "25.6%" and b["present"]["note"].startswith(f"As of {FIN} close")
    assert breadth_now.UNAVAILABLE not in b["present"]["note"] and "Intraday" not in json.dumps(b)
    assert "Latest finalized close (for history" not in b["text"]               # the pre-feature answer, unchanged


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "on", "On", "yes", " 1 "])
def test_FLAG_explicit_enablement_turns_it_on(client, live, monkeypatch, value):
    monkeypatch.setenv("AGENT_BREADTH_CURRENT", value)
    assert breadth_now.enabled() is True
    assert ask(client)["present"]["note"] == "Intraday · 11:51 AM ET"


def test_FLAG_ships_OFF_in_code():
    import inspect
    src = inspect.getsource(breadth_now.enabled)
    assert 'os.environ.get("AGENT_BREADTH_CURRENT", "")' in src and "ON_VALUES" in src


def test_DEPENDENCY_MISSING_says_there_is_no_current_reading(client, live, monkeypatch):
    """Enabled, but the Breadth service is absent: never a silent finalized answer posing as current."""
    monkeypatch.setattr(breadth_now, "_reader", lambda: None)
    p = ask(client)["present"]
    assert p["value"] == "25.6%" and p["note"].startswith(f"As of {FIN} close")   # dated historical context
    assert f". {breadth_now.UNAVAILABLE}" in p["note"]
    o = client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": []}).json()["present"]
    assert breadth_now.UNAVAILABLE in o["note"] and "Intraday" not in json.dumps(o)


def test_A_READING_FAULT_never_costs_the_answer(client, live, monkeypatch):
    monkeypatch.setattr(breadth_now, "_reader", lambda: (lambda u, m: (_ for _ in ()).throw(RuntimeError("x"))))
    p = ask(client)["present"]
    assert p["value"] == "25.6%" and breadth_now.UNAVAILABLE in p["note"]


# ═══ ⛔ isolation: a current value never reaches a model, history, naming or the logs ═════════════

def _leaks(x):
    blob = json.dumps(x, default=str, ensure_ascii=False)
    return [s for s in LIVE_LEAKS if s in blob]


def test_ISOLATION_history_replay_and_naming_never_carry_a_current_value(client, live):
    b = ask(client)
    assert "61.2%" in json.dumps(b)                                            # the member sees it …
    data = {"kind": "answered", "actions": ["breadth.show"], "local": True, "views": [b["present"]],
            "requests": [{**BASE, "mode": "value", "metrics": ["pct_above_50sma"]}]}
    rows = [{"role": "member", "text": "What % of stocks are above their 50-day?"},
            {"role": "outcome", "text": b["text"], "data": data}]
    hist = turn.history_messages(rows)
    assert not _leaks(hist)                                                    # … the model never does
    assert "the current reading" in json.dumps(hist)                           # dates/enums-only note
    seen = []

    def caller(**kw):
        seen.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text='{"title": "Breadth"}')],
                                     stop_reason="end_turn", usage=None)
    saved, turn._record_cost = turn._record_cost, (lambda r: 0.0)
    try:
        turn.name_conversation(rows, caller=caller)
    finally:
        turn._record_cost = saved
    assert seen and not _leaks(seen)


def test_ISOLATION_an_overview_row_is_noted_by_measure_names_only(client, live):
    data = {"kind": "answered", "actions": ["breadth.show"], "local": True,
            "requests": [{**BASE, "mode": "value", "metrics": []}]}
    note = turn.outcome_for_model({"role": "outcome", "text": "x 61.2%", "data": data})
    assert "pct_above_50sma, pct_above_200sma, net_new_high_low, adv_decline; on the current reading" in note
    assert not _leaks(note)


def test_ISOLATION_the_logs_carry_statuses_never_values(client, live, caplog):
    with caplog.at_level(logging.DEBUG):
        client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": []})
    assert "present-tense kinds=" in caplog.text
    assert not _leaks(caplog.text)


def test_LABEL_is_the_market_data_time_never_the_compute_time(client, live):
    live.payload = live_payload("2026-10-12T11:51:30-04:00", data_as_of="2026-10-12T11:49:10-04:00")
    p = ask(client)["present"]
    assert p["note"] == "Intraday · 11:49 AM ET"                                 # the snapshot's time, not 11:51


# ═══ the Breadth endpoints stay ops-only; the Agent reads the service IN-PROCESS only ═════════════

@pytest.mark.parametrize("path", ["/api/breadth-monitor/current?universe=us&metric=pct_above_50sma",
                                  "/api/breadth-monitor/pipeline"])
@pytest.mark.parametrize("secret,header", [
    ("s3cret-test", None), ("s3cret-test", "Bearer "), ("s3cret-test", "Bearer wrong"),
    ("", "Bearer "), ("", None),                                                # unset secret → closed for everyone
])
def test_ENDPOINTS_the_breadth_reading_routes_refuse_without_the_push_secret(monkeypatch, path, secret, header):
    from api.routers import breadth_monitor
    monkeypatch.setenv("PUSH_SECRET", secret)
    app = FastAPI()
    app.include_router(breadth_monitor.router)
    r = TestClient(app).get(path, headers={"Authorization": header} if header is not None else {})
    assert r.status_code == 401


def test_ENDPOINTS_the_agent_never_calls_them_over_http():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    files = [*(root / "api/services/uct_agent").glob("*.py"), root / "api/routers/uct_agent.py",
             *(root / "app/src/agent").rglob("*.js"), *(root / "app/src/agent").rglob("*.jsx")]
    hits = [str(f) for f in files if "breadth-monitor" in f.read_text(encoding="utf-8", errors="ignore")]
    assert hits == []
    src = (root / "api/services/uct_agent/breadth_now.py").read_text(encoding="utf-8")
    assert "from api.services import breadth_current" in src                   # in-process
    for client in ("requests", "httpx", "urllib", "aiohttp", "http.client"):
        assert f"import {client}" not in src and f"from {client}" not in src


def test_ENDPOINTS_the_agent_route_that_reads_it_is_admin_gated():
    """By object identity on the route's dependency tree (as test_exposed_routes_gated does)."""
    route = next(r for r in rx.router.routes if getattr(r, "path", None) == "/api/agent/breadth")

    def deps(d):
        for x in d.dependencies:
            yield x.call
            yield from deps(x)
    assert rx.require_admin_dark in set(deps(route.dependant))
