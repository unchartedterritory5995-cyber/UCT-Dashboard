"""UCT Agent — response presentation & conversation persistence (2026-10-12).

The member-facing VIEW of an answer (app/src/agent/present.js) is saved with the conversation so it
survives navigation and reload — in the row's DATA, the member's channel. These tests pin:
  · the breadth view is built from MI's read result with MI's own formatting (values unchanged);
  · TWO CHANNELS: a saved view is never read into a model request (history replay, naming), for a
    local-only breadth row AND for an ordinary answer row;
  · the store never cuts a row's JSON: oversized display data is dropped, the keys the history door
    reads (kind / actions / local / requests) always survive;
  · a mixed breadth + feed-news plan is not told "the news was not looked up".
Scripted model only — no model call, no network, no production data.
"""
from __future__ import annotations

import json
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters
from api.services.market_intel import breadth_answer, breadth_reads
from api.services.uct_agent import breadth_present, store, turn
from tests.market_intel_breadth_fixtures import synthetic_breadth_world

SENTINEL = 73.4567
LEAKS = ("73.4567", "73.457", "73.46", "73.5")
SESSION = "2026-10-09"
ADMIN = {"id": "c0ffee00-0000-4000-8000-0000000000a1", "plan": "pro", "role": "admin"}
BASE = {"universe": "us", "date": None, "compare_date": None, "start": None, "end": None}


def leaked(x) -> list[str]:
    blob = json.dumps(x, default=str, ensure_ascii=False)
    return [s for s in LEAKS if s in blob]


@pytest.fixture
def world(monkeypatch):
    return synthetic_breadth_world(monkeypatch, sentinel=SENTINEL, session=SESSION, forbid_network=True)


def _view(req):
    res = breadth_reads.read(req)
    return breadth_present.view_of(res, breadth_answer.answer(res))


# ═══ 1. the breadth view: MI's values, MI's formatting, the smallest shape ═══════════════════════════

def test_VIEW_a_single_value_is_one_figure_with_its_session(world):
    v = _view({**BASE, "mode": "value", "metrics": ["pct_above_50sma"]})
    assert v == {"kind": "value", "value": "73.5%", "label": "US · % of Stocks Above 50-Day MA", "note": "As of 2026-10-09 close"}


def test_VIEW_several_measures_are_labelled_figures(world):
    v = _view({**BASE, "mode": "value", "metrics": ["pct_above_50sma", "new_52w_highs"]})
    assert v["kind"] == "metrics" and [i["label"] for i in v["items"]] == ["% of Stocks Above 50-Day MA", "New 52-Week Highs"]
    assert v["items"][0]["value"] == "73.5%" and v["note"] == "As of 2026-10-09 close"


def test_VIEW_a_comparison_is_two_dated_values_and_the_change(world):
    v = _view({**BASE, "mode": "compare", "metrics": ["pct_above_50sma"], "compare_date": "2026-09-09"})
    # chronological (ACCEPTANCE 2026-10-12): earlier, then latest, then the change LATER − EARLIER
    assert v["kind"] == "comparison" and [i["label"] for i in v["items"]] == ["Earlier", "Latest close", "Change"]
    assert v["items"][1] == {"label": "Latest close", "value": "73.5%", "note": "2026-10-09"}
    m = breadth_reads.read({**BASE, "mode": "compare", "metrics": ["pct_above_50sma"], "compare_date": "2026-09-09"})["metrics"][0]
    mi = breadth_answer.fmt_change(m["unit"], m["change"])                                    # MI's own number
    assert v["items"][2]["value"] == (mi if mi.startswith("+") else "−" + mi[1:])


def test_VIEW_a_range_is_first_last_low_high_average(world):
    v = _view({**BASE, "mode": "series", "metrics": ["pct_above_50sma"], "start": "2026-09-01"})
    assert v["kind"] == "range" and [i["label"] for i in v["items"]] == ["First", "Last", "Change", "Low", "High", "Average"]
    assert "finalized sessions" in v["note"]


@pytest.mark.parametrize("req,says", [
    ({**BASE, "mode": "value", "metrics": ["pct_above_50sma"], "date": "2026-10-12"}, "after the latest finalized session"),
    ({**BASE, "mode": "value", "metrics": ["pct_above_50sma"], "date": "2026-01-02"}, "before this breadth history begins"),
    ({**BASE, "mode": "value", "metrics": ["made_up"]}, "isn't available here"),
])
def test_VIEW_a_refusal_says_the_specific_reason(world, req, says):
    v = _view(req)
    assert v["kind"] == "error" and says in v["text"] and not leaked(v)


def test_VIEW_the_route_returns_the_view_and_survives_a_view_failure(world, monkeypatch):
    daily_counters.clear()
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: ADMIN
    c = TestClient(app)
    req = {**BASE, "mode": "value", "metrics": ["pct_above_50sma"]}
    assert c.post("/api/agent/breadth", json=req).json()["present"]["value"] == "73.5%"
    monkeypatch.setattr(breadth_present, "view_of", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    b = c.post("/api/agent/breadth", json=req).json()
    assert b["present"] is None and "73.5%" in b["text"]                       # the answer still arrives


# ═══ 2. TWO CHANNELS: a saved view is the member's, never the model's ═══════════════════════════════

VIEW = {"kind": "value", "value": "73.5%", "label": "US · % above 50-day", "v": 1,
        "details": {"text": "US · % Above 50-Day: 73.4567 …", "table": {"columns": [{"key": "v", "label": "V"}], "rows": [{"v": "73.5%"}]}}}


@pytest.mark.parametrize("data,text", [
    # an ordinary (non-local) answer row: its TEXT is replayed as before; its saved view never is
    ({"kind": "answered", "actions": ["stock.profile"], "views": [VIEW]}, "NVDA — Nvidia Corp. Market cap $4.6T"),
    # a local-only breadth row: a fixed note; neither its text nor its view
    ({"kind": "answered", "actions": ["breadth.show"], "local": True, "views": [VIEW],
      "requests": [{**BASE, "mode": "value", "metrics": ["pct_above_50sma"]}]}, "US · % Above 50-Day: 73.5% on 2026-10-09."),
])
def test_CHANNELS_a_saved_view_never_enters_history_replay(data, text):
    rows = [{"role": "member", "text": "q"}, {"role": "outcome", "text": text, "data": data}]
    assert not leaked(turn.history_messages(rows))


def test_CHANNELS_naming_never_reads_a_saved_view():
    seen = []

    def caller(**kw):
        seen.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text='{"title": "Breadth"}')],
                                     stop_reason="end_turn", usage=None)
    turns = [{"role": "member", "text": "breadth?"},
             {"role": "agent", "text": "", "data": {"envelope": {"disposition": "apply", "ops": [{"action": "breadth.show"}]}}},
             {"role": "outcome", "text": "US · 73.5%", "data": {"kind": "answered", "actions": ["breadth.show"], "local": True, "views": [VIEW]}}]
    monkey = turn._record_cost
    turn._record_cost = lambda r: 0.0
    try:
        turn.name_conversation(turns, caller=caller)
    finally:
        turn._record_cost = monkey
    assert seen and not leaked(seen)


# ═══ 3. the store never cuts a row's JSON ═══════════════════════════════════════════════════════════

def test_STORE_an_oversized_view_is_dropped_never_cut_and_the_door_keys_survive():
    big = {"kind": "answered", "actions": ["breadth.show"], "local": True,
           "requests": [{**BASE, "mode": "value", "metrics": ["pct_above_50sma"]}],
           "views": [{"kind": "table", "table": {"columns": [{"key": "a", "label": "A"}], "rows": [{"a": "x" * 200}] * 200}}]}
    out = json.loads(store._data_json(big))                                  # valid JSON — never cut
    assert out["kind"] == "answered" and out["actions"] == ["breadth.show"] and out["local"] is True
    assert out["requests"] == big["requests"] and "views" not in out and out["trimmed"] is True
    assert turn.is_local_row({"role": "outcome", "data": out})               # the door still sees it


def test_STORE_a_normal_row_is_unchanged():
    d = {"kind": "applied", "actions": ["chart.setTimeframe"], "lines": ["Switched timeframe to 15"]}
    assert json.loads(store._data_json(d)) == d and store._data_json(None) is None


def test_STORE_round_trip_the_member_gets_the_view_back(monkeypatch):
    store._reset_for_tests()
    cid = store.create_conversation(ADMIN["id"], "q")
    store.add_turn(ADMIN["id"], cid, "outcome", "NVDA — Nvidia", {"kind": "answered", "actions": ["stock.profile"], "views": [VIEW]})
    t = store.get_turns(ADMIN["id"], cid)[-1]
    assert t["data"]["views"][0]["value"] == "73.5%"                          # restored for the member


# ═══ 4. mixed: breadth + feed news is never told "the news was not looked up" ═══════════════════════

_GOLDEN = json.loads((__import__("pathlib").Path(__file__).resolve().parents[1]
                      / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))["capabilities"]
CAPS = [c for c in _GOLDEN if c["name"] in ("breadth.show", "news.latest")]
CTX = {"surface": "charts", "breadth": [{"ref": "b1", "label": "UCT market breadth"}], "news": [{"ref": "n1", "label": "UCT news"}],
       "stockData": [{"ref": "n1", "label": "UCT stock data"}]}
BOP = {"action": "breadth.show", "target": "b1", "args": {**BASE, "mode": "value", "metrics": ["pct_above_50sma"]}}


def _news_op():
    cap = next(c for c in CAPS if c["name"] == "news.latest")
    target = "n1"
    return {"action": "news.latest", "target": target,
            "args": {k: ("NVDA" if k == "symbol" else None) for k in cap["args"]["properties"]}}


def _run(envs, msg, monkeypatch):
    q = list(envs)

    def caller(**kw):
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(q.pop(0)))],
                                     stop_reason="end_turn", usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)
    monkeypatch.setattr(turn, "_research", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no research")))
    return turn.run_turn(message=msg, context=CTX, history=[], capabilities=CAPS, caller=caller)["envelope"]


def _env(ops, reply=""):
    return {"disposition": "apply", "reply": reply, "question": None, "ops": ops, "unsupported_category": None, "research": None}


def test_MIXED_breadth_plus_FEED_news_is_not_told_the_news_was_not_looked_up(monkeypatch):
    e = _run([_env([BOP, _news_op()])], "breadth today and the latest NVDA news", monkeypatch)
    assert [o["action"] for o in e["ops"]] == ["breadth.show", "news.latest"]
    assert e["reply"] == "" and "local_notice" not in e                       # the feed answers the news part


def test_MIXED_breadth_plus_feed_news_plus_why_still_says_it_was_not_explained(monkeypatch):
    e = _run([_env([BOP, _news_op()])], "breadth today, the latest NVDA news, and why is breadth weak?", monkeypatch)
    assert e["reply"] == turn.LOCAL_EXPLAIN_NOT_DONE


def test_MIXED_breadth_plus_news_with_NO_news_op_still_discloses_no_web_search(monkeypatch):
    e = _run([_env([BOP])], "breadth today and the latest NVDA news", monkeypatch)
    assert e["reply"] == turn.LOCAL_NEWS_NOT_DONE and "no web search was run" in e["reply"]


def test_STORE_an_oversized_row_round_trips_readable_through_add_turn():
    store._reset_for_tests()
    cid = store.create_conversation(ADMIN["id"], "q")
    big = {"kind": "answered", "actions": ["breadth.show"], "local": True,
           "views": [{"kind": "table", "table": {"columns": [{"key": "a", "label": "A"}], "rows": [{"a": "x" * 200}] * 200}}]}
    store.add_turn(ADMIN["id"], cid, "outcome", "US · 73.5%", big)
    t = store.get_turns(ADMIN["id"], cid)[-1]
    assert isinstance(t["data"], dict) and t["data"]["kind"] == "answered" and t["data"]["local"] is True
    assert turn.outcome_for_model(t) != turn.UNREADABLE_OUTCOME and not leaked(turn.outcome_for_model(t))
