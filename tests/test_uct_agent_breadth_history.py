"""UCT Agent — breadth.history: historical breadth SEARCH (owner project 2026-10-12).

Production failure: "What percent of US stocks are above the 200sma?" → a correct reading; then "When
was the last time that was below 10%?" → "no access to historical breadth data … scroll the chart".

Pinned here, through the REAL admin-only route and Market Intelligence's REAL breadth_events (Slice 2
condition core over breadth_reads.sealed_series — the series the charts draw), on MI's synthetic world:
  · every find returns the member's view; refusals are specific; no module → an honest refusal;
  · the search's value on a date IS the chart series' value on that date (one source of truth);
  · the production conversation's model path: the follow-up plans breadth.history, never research;
  · ⛔ isolation: no searched date or value reaches a model request, replayed history, naming or logs.
Synthetic values only; no model call, no network.
"""
from __future__ import annotations

import json
import logging
import sys
import types

import pytest

from api.routers import uct_agent as rx
from api.services import breadth_symbols as bs
from api.services import daily_counters
from api.services.market_intel import breadth_events as be
from api.services.uct_agent import breadth_history_present as bhp
from api.services.uct_agent import store, turn
from tests.market_intel_breadth_fixtures import synthetic_breadth_world
from tests.test_uct_agent_breadth import ADMIN, MEMBER, ScriptedModel, _client, env

SESSION = "2026-10-09"
BASE = {"universe": "us", "metric": "pct_above_200sma", "start": None, "end": None, "aggregation": "daily"}
_GOLDEN = json.loads(open("app/src/agent/contract/manifest.golden.json", encoding="utf-8").read())["capabilities"]
CAPS = [c for c in _GOLDEN if c["name"] in ("breadth.show", "breadth.history")]
CTX = {"surface": "charts", "breadth": [{"ref": "b1", "label": "UCT market breadth", "today_et": "2026-10-12",
                                        "latest_finalized": {"us": SESSION, "nyse": SESSION, "nasdaq": SESSION}}]}
SHOW_REQ = {"mode": "value", "universe": "us", "metrics": ["pct_above_200sma"], "date": None, "compare_date": None,
            "start": None, "end": None, "basis": None}


@pytest.fixture
def world(monkeypatch):
    return synthetic_breadth_world(monkeypatch, sentinel=25.6, session=SESSION, forbid_network=True)


@pytest.fixture
def client(monkeypatch):
    daily_counters.clear()
    store._reset_for_tests()
    yield _client(monkeypatch, ADMIN)
    daily_counters.clear()


def search(client, **kw):
    r = client.post("/api/agent/breadth/history", json={**BASE, **kw})
    assert r.status_code == 200, r.text
    return r.json()


# ═══ the route: admin-only, every find, honest refusals ═════════════════════════════════════════════

def test_ROUTE_admin_only_like_every_agent_route(world, monkeypatch):
    daily_counters.clear()
    assert _client(monkeypatch, MEMBER).post("/api/agent/breadth/history", json={**BASE, "op": "below", "level": 30, "find": "last"}).status_code == 403
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(rx.router)
    assert TestClient(app).post("/api/agent/breadth/history", json={}).status_code in (401, 403)


def test_ROUTE_last_is_a_dated_card_with_the_reading_and_coverage(client, world):
    b = search(client, op="below", level=30, find="last")
    p = b["present"]
    assert p["kind"] == "value" and p["value"] == SESSION
    assert p["label"] == "US · % of Stocks Above 200-Day MA · Last below 30.0%"
    assert p["note"].startswith("Reading 25.6% that session.")
    assert p["source"].startswith("Finalized daily closes, 2026-06-01 – 2026-10-09")
    assert b["status"] == "ok" and SESSION in b["text"]


@pytest.mark.parametrize("kw,kind,check", [
    ({"op": "crosses_above", "level": 50, "find": "last"}, "value", lambda p: "crossed above 50.0%" in p["label"]),
    ({"op": "below", "level": 30, "find": "count"}, "metrics", lambda p: [i["label"] for i in p["items"]] == ["Sessions below 30.0%", "Separate stretches"]),
    ({"op": "crosses_below", "level": 40, "find": "count"}, "metrics", lambda p: p["items"][0]["label"] == "Times it crossed below 40.0%"),
    ({"op": "below", "level": 30, "find": "last_episode"}, "metrics", lambda p: [i["label"] for i in p["items"]] == ["From", "To", "Sessions", "Range"]),
    ({"op": "below", "level": 30, "find": "longest"}, "metrics", lambda p: "Longest stretch below 30.0%" in p["title"]),
    ({"op": "below", "level": 30, "find": "episodes"}, "table", lambda p: [c["label"] for c in p["table"]["columns"]] == ["From", "To", "Sessions", "Range"]),
    ({"op": "below", "level": 1, "find": "last"}, "text", lambda p: "never" in p["text"]),
    ({"op": "below", "level": 30, "find": "last", "start": "2026-07-01", "end": "2026-07-31"}, None, lambda p: "2026-07-01 – 2026-07-31" in (p.get("source") or p.get("note") or "")),
])
def test_ROUTE_every_find_has_a_view(client, world, kw, kind, check):
    p = search(client, **kw)["present"]
    if kind:
        assert p["kind"] == kind
    assert check(p)


def test_VIEW_provenance_fits_the_card_and_the_full_caveats_stay_in_details(client, world):
    for kw in ({"op": "below", "level": 30, "find": "last"}, {"op": "below", "level": 30, "find": "count"},
               {"op": "below", "level": 30, "find": "last_episode"}, {"op": "below", "level": 1, "find": "last"}):
        b = search(client, **kw)
        line = b["present"].get("source") or b["present"].get("note")
        assert len(line) <= 160, line                                          # cards show ≤ 160 characters
        assert "missing session" in line                                       # the synthetic world has a gap
        assert "break a stretch" in b["text"]                                  # MI's full caveat, under Details


@pytest.mark.parametrize("kw,says", [
    ({"op": "below", "level": 150, "find": "last"}, "isn't a possible value"),
    ({"op": "crosses_below", "level": 20, "find": "episodes"}, None),
    ({"op": "below", "level": 20, "find": "last", "aggregation": "weekly"}, None),
    ({"op": "below", "level": 20, "find": "last", "universe": "uct"}, None),
])
def test_ROUTE_refusals_are_specific_errors_never_values(client, world, kw, says):
    b = search(client, **kw)
    assert b["status"] != "ok" and b["present"]["kind"] == "error"
    if says:
        assert says in b["present"]["text"]


def test_ROUTE_without_the_MI_module_is_an_honest_refusal(client, world, monkeypatch):
    import api.services.market_intel as mi_pkg
    monkeypatch.setitem(sys.modules, "api.services.market_intel.breadth_events", None)
    monkeypatch.delattr(mi_pkg, "breadth_events", raising=False)
    b = search(client, op="below", level=30, find="last")
    assert b["status"] == "unavailable" and "isn't available yet" in b["text"] and b["present"] is None


# ═══ one source of truth: the search's value on a date is the chart series' value ═══════════════════

def test_SAME_VALUES_as_the_chart_series(client, world):
    res = be.run({**BASE, "op": "below", "level": 30, "find": "last"})
    chart = {b["t"]: b["c"] for b in bs.build_breadth_bars(bs.symbol_for("us", "pct_above_200sma"), "D", 8000)["bars"]}
    assert res["event"]["value"] == chart[res["event"]["date"]]


# ═══ the production conversation — the model path (wording the fast path does not take) ═══════════════

def _history_after_a_reading():
    return [{"role": "member", "text": "What percent of US stocks are above the 200sma?"},
            {"role": "outcome", "text": "US · % Above 200-Day: 25.6%",
             "data": {"kind": "answered", "actions": ["breadth.show"], "local": True, "requests": [SHOW_REQ]}}]


def test_FOLLOWUP_the_model_plans_breadth_history_and_no_web_search_runs(monkeypatch):
    searched = []
    monkeypatch.setattr(turn, "_research", lambda q, r: searched.append(q) or {"answer": "x", "citations": ["https://x"]})
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.0)
    op = {"action": "breadth.history", "target": "b1", "args": {**BASE, "op": "below", "level": 10, "find": "last"}}
    m = ScriptedModel()
    m.queue = [{**env("apply", [op]), "research": {"query": "when was % above 200 dma below 10", "recency": "any"}}]
    out = turn.run_turn(message="hmm, and when did that last dip under 10 percent?", context=CTX,
                        history=_history_after_a_reading(), capabilities=CAPS, caller=m)
    assert out["envelope"]["ops"] == [op] and searched == []
    assert out["usage"]["research_calls"] == 0


def test_FOLLOWUP_a_words_only_reply_is_never_web_researched_after_a_breadth_answer(monkeypatch):
    searched = []
    monkeypatch.setattr(turn, "_research", lambda q, r: searched.append(q) or {"answer": "x", "citations": ["https://x"]})
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.0)
    m = ScriptedModel()
    m.queue = [{**env("answer", reply="Checking."), "research": {"query": "breadth below 10 percent history", "recency": "any"}}]
    out = turn.run_turn(message="When was the last time that was below 10%?", context=CTX,
                        history=_history_after_a_reading(), capabilities=CAPS, caller=m)
    assert searched == [] and out["usage"]["breadth_research_blocked"] is True


def test_PROMPT_the_breadth_rule_covers_history_and_forbids_the_refusal():
    sp = turn.system_prompt(CAPS)
    assert turn.BREADTH_RULE in sp
    assert "breadth.history" in turn.BREADTH_RULE and "never say UCT lacks historical breadth" in turn.BREADTH_RULE
    assert "never tell the member to scroll a chart" in turn.BREADTH_RULE


# ═══ ⛔ isolation ═══════════════════════════════════════════════════════════════════════════════════

def _leaks(x, res):
    blob = json.dumps(x, default=str, ensure_ascii=False)
    ev = res.get("event") or {}
    return [s for s in (str(ev.get("date")), f"{ev.get('value')}", "25.6") if s and s != "None" and s in blob]


def test_ISOLATION_history_replay_and_naming_never_carry_a_searched_date_or_value(client, world):
    args = {**BASE, "op": "below", "level": 30, "find": "last"}
    res = be.run(args)
    b = search(client, **{k: v for k, v in args.items() if k not in BASE or BASE[k] != v})
    rows = [*_history_after_a_reading(), {"role": "member", "text": "When was the last time that was below 30%?"},
            {"role": "outcome", "text": b["text"],
             "data": {"kind": "answered", "actions": ["breadth.history"], "local": True, "views": [b["present"]], "requests": [args]}}]
    hist = turn.history_messages(rows)
    assert not _leaks(hist, res)
    assert "breadth history" in json.dumps(hist)                              # MI's value-free note
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
    assert seen and not _leaks(seen, res)


def test_ISOLATION_the_route_logs_a_status_never_a_value(client, world, caplog):
    res = be.run({**BASE, "op": "below", "level": 30, "find": "last"})
    with caplog.at_level(logging.DEBUG):
        search(client, op="below", level=30, find="last")
    assert "breadth history status=ok" in caplog.text and not _leaks(caplog.text, res)


def test_ISOLATION_breadth_history_is_local_only_on_the_server():
    assert "breadth.history" in turn.LOCAL_ONLY_ACTIONS
    note = turn.outcome_for_model({"role": "outcome", "text": "x 2026-10-09 25.6%",
                                   "data": {"kind": "answered", "actions": ["breadth.history"],
                                            "requests": [{**BASE, "op": "below", "level": 30, "find": "last"}]}})
    assert "2026-10-09" not in note and "25.6" not in note and "breadth history" in note
