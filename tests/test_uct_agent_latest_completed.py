"""UCT Agent — the NEWEST COMPLETED breadth session when no current reading exists (2026-10-13 incident).

At 10:20 ET on 2026-10-13, ~11 minutes after a web restart, no current reading existed (boot grace + a cold
state build) and the Agent answered "% of US stocks above the 50-day" with the Oct 9 FINALIZED close while
Oct 12's completed (provisional) close existed. Breadth's contract now supplies `latest_completed`
({session, status, value, label}); the Agent shows it, labelled as exactly that and never as now.

Here the Breadth reading is stubbed with contract-shaped responses (Breadth's own `choose()` is covered
in tests/test_breadth_live_restart.py and, end to end, in test_uct_agent_breadth_current.py); MI's
finalized close is the synthetic world's (FIN, standing in for Oct 9). Pinned:
  · current intraday → still the preferred answer;
  · not current + latest_completed → its value, session, status and label exactly as supplied, plus the
    not-current sentence — never "Intraday", "now" or "live"; US:A50 and NASDAQ:A50 (the incident), and
    every universe × 50/200-day;
  · "% below" complements the completed close too; the card keeps its Open chart target;
  · absent / malformed / older / same-session-finalized → the finalized fallback, as before;
  · NH/NL (finalized-only tier) is never shown from a provisional session.
Synthetic values only; no network, no model.
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import breadth_symbols as bs
from api.services.uct_agent import breadth_now
from tests.test_uct_agent_breadth_current import ADMIN, BASE, FIN, world  # noqa: F401

FIN_VALUE = "25.6%"                     # the synthetic world's finalized close (every measure)
OCT12 = {"session": "2026-10-12", "status": "provisional", "value": 61.75, "label": "Provisional close · Oct 12"}


def reading_of(**over):
    """A contract-shaped breadth_current.reading() response: by default NOT current (post-restart)."""
    base = {"ok": False, "current": False, "stale_reason": "live breadth unavailable (boot grace)",
            "accuracy_tier": "validated", "latest_completed": dict(OCT12)}
    base.update(over)
    return lambda universe, metric: dict(base)


@pytest.fixture
def client(world, monkeypatch):
    monkeypatch.setenv("AGENT_BREADTH_CURRENT", "1")
    # the registry's own symbols; every one treated as published (production publishes us, nyse, nasdaq)
    monkeypatch.setattr(bs, "resolve", lambda sym, published_only=True: {"symbol": sym} if sym else None)
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[rx.require_admin_dark] = lambda: ADMIN
    return TestClient(app)


def ask(client, **kw):
    return client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": ["pct_above_50sma"], "side": None, **kw}).json()


def use(monkeypatch, reader):
    monkeypatch.setattr(breadth_now, "_reader", lambda: reader)


NOT_NOW = ("Intraday", "intraday", "right now:", "breadth now", " live ", "Live reading", "today")


def said_now(b) -> bool:
    shown = json.dumps(b.get("present"))
    return any(w in shown for w in NOT_NOW if w != "today") or "breadth now:" in (b.get("text") or "")


# ═══ the incident ═════════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("universe, label", [("us", "US"), ("nasdaq", "Nasdaq")])
def test_INCIDENT_oct13_the_newest_completed_session_not_an_older_finalized_close(client, monkeypatch, universe, label):
    use(monkeypatch, reading_of())
    b = ask(client, universe=universe)
    p = b["present"]
    assert p["value"] == "61.8%"                                              # Oct 12's close, formatted by MI
    assert p["value"] != FIN_VALUE                                            # not the older finalized close
    assert p["note"] == f"Provisional close · Oct 12. {breadth_now.NOT_CURRENT}"
    assert p["label"].endswith("% of Stocks Above 50-Day MA")                 # the same measure identity
    assert not said_now(b)
    assert "latest completed session" in b["text"] and FIN in b["text"]      # the finalized close stays as context
    assert b["chart"]["symbol"] == bs.symbol_for(universe, "pct_above_50sma").upper()   # Open chart: its exact series


@pytest.mark.parametrize("universe", ["us", "nyse", "nasdaq"])
@pytest.mark.parametrize("metric", ["pct_above_50sma", "pct_above_200sma"])
def test_EVERY_universe_and_period(client, monkeypatch, universe, metric):
    use(monkeypatch, reading_of())
    p = ask(client, universe=universe, metrics=[metric])["present"]
    assert p["value"] == "61.8%" and p["note"].startswith("Provisional close · Oct 12.")
    assert ("200-Day" if "200" in metric else "50-Day") in p["label"]


def test_A_FINALIZED_latest_completed_newer_than_MI_is_shown_as_finalized(client, monkeypatch):
    use(monkeypatch, reading_of(latest_completed={"session": "2026-10-09", "status": "finalized", "value": 30.0,
                                                  "label": "Finalized close · Oct 9"}))
    p = ask(client)["present"]
    assert p["value"] == "30.0%" and p["note"] == f"Finalized close · Oct 9. {breadth_now.NOT_CURRENT}"


# ═══ current data still wins ══════════════════════════════════════════════════════════════════════

def test_CURRENT_intraday_is_still_preferred(client, monkeypatch):
    use(monkeypatch, reading_of(ok=True, current=True, status="intraday", session="2026-10-13", value=40.04,
                                label="Intraday · 10:31 AM ET"))
    p = ask(client)["present"]
    assert p == {"kind": "value", "value": "40.0%", "label": "US · % of Stocks Above 50-Day MA", "note": "Intraday · 10:31 AM ET"}


def test_CURRENT_but_not_displayable_never_takes_latest_completed(client, monkeypatch):
    """The contract: `latest_completed` only when `current` is False. A current reading the Agent can't show
    (a finalized close for another session than MI read) keeps the finalized fallback, as before."""
    use(monkeypatch, reading_of(ok=True, current=True, status="finalized", session="2026-10-12", value=40.0,
                                label="Finalized close · Oct 12"))
    p = ask(client)["present"]
    assert p["value"] == FIN_VALUE and breadth_now.UNAVAILABLE in p["note"]


# ═══ "% below" ════════════════════════════════════════════════════════════════════════════════════

def test_BELOW_complements_the_completed_close(client, monkeypatch):
    use(monkeypatch, reading_of(latest_completed={**OCT12, "value": 26.2}))
    p = ask(client, side="below")["present"]
    assert p["value"] == "73.8%" and p["label"] == "US · % of Stocks At or Below 50-Day MA"
    assert p["note"].startswith("Provisional close · Oct 12.")


# ═══ backward compatible / defensive ══════════════════════════════════════════════════════════════

@pytest.mark.parametrize("lc", [
    None,                                                                     # an older Breadth: no field
    {**OCT12, "status": "intraday"},                                          # never "completed"
    {**OCT12, "value": "61.75"},                                              # not a number
    {**OCT12, "value": True},
    {**OCT12, "session": "Oct 12"},                                           # not a date
    {**OCT12, "label": "  "},
    {**OCT12, "session": "2026-10-01"},                                       # older than the finalized close
    {"session": FIN, "status": "finalized", "value": 25.6, "label": "Finalized close · Oct 8"},   # the same close
])
def test_ABSENT_or_UNUSABLE_latest_completed_is_the_finalized_fallback_as_before(client, monkeypatch, lc):
    use(monkeypatch, reading_of(latest_completed=lc))
    p = ask(client)["present"]
    assert p["value"] == FIN_VALUE
    assert p["note"].startswith(f"As of {FIN} close") and breadth_now.UNAVAILABLE in p["note"]


def test_NHNL_finalized_only_tier_never_takes_a_provisional_session(client, monkeypatch):
    use(monkeypatch, reading_of(accuracy_tier="finalized_only"))
    p = ask(client, metrics=["net_new_high_low"])["present"]
    assert "Provisional" not in p["note"] and p["note"].startswith("Finalized close")


def test_OVERVIEW_each_measure_its_completed_session_and_one_not_current_note(client, monkeypatch):
    use(monkeypatch, reading_of())
    b = client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": ["pct_above_50sma", "pct_above_200sma"]}).json()
    p = b["present"]
    assert p["kind"] == "metrics"
    assert all(i["note"] == "Provisional close · Oct 12" for i in p["items"])
    assert breadth_now.NOT_CURRENT in p["note"]
    assert not said_now(b)


def test_LOGS_say_the_kind_never_a_value(client, monkeypatch, caplog):
    use(monkeypatch, reading_of())
    with caplog.at_level("INFO"):
        ask(client)
    line = [r.getMessage() for r in caplog.records if "present-tense kinds=" in r.getMessage()][0]
    assert "latest_completed" in line and "61.75" not in line and "61.8" not in line
