"""UCT Agent × Market Intelligence breadth slice 1 — the LOCAL-RESULT BOUNDARY, end to end.

The model may only PLAN `breadth.show` (validated args). UCT reads the figures from its own services
(market_intel.breadth_reads / breadth_answer, MI-owned) and shows them to the member; they must never
reach a model — not as history, context, recent outcome, a stored plan, a naming input, or anything else
(owner 2026-10-11, uct-mi-phase0/LOCAL-RESULT-BOUNDARY-CONTRACT.md).

These tests drive the REAL router (`/api/agent/turn`, `/record`, `/breadth`, `/conversations`) with a
SCRIPTED model, over the shared synthetic world (tests/market_intel_breadth_fixtures.py) in which every
breadth reading on the sentinel session is 73.4567 ("73.5%"). Every payload the scripted model receives —
system, messages, output schema, the background naming call — is captured and searched for the sentinel.
No real model, no network, no production data.
"""
from __future__ import annotations

import json
import pathlib
import re
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters
from api.services.market_intel import breadth_reads
from api.services.uct_agent import store, turn
from tests.market_intel_breadth_fixtures import synthetic_breadth_world

REPO = pathlib.Path(__file__).resolve().parents[1]
SENTINEL = 73.4567
SENTINEL_STRINGS = ("73.4567", "73.457", "73.46", "73.5")      # every rendering a leak could take
SESSION = "2026-10-09"
ADMIN = {"id": "b7e5a1c0-0000-4000-8000-0000000000a1", "plan": "pro", "role": "admin"}
MEMBER = {"id": "b7e5a1c0-0000-4000-8000-0000000000b2", "plan": "pro", "role": "member"}

_GOLDEN = json.loads((REPO / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))["capabilities"]
CAPS = [c for c in _GOLDEN if c["name"] in ("breadth.show", "stock.profile")]
CTX = {"surface": "charts",
       "breadth": [{"ref": "b1", "label": "UCT market breadth", "today_et": "2026-10-11",
                    "latest_finalized": {"us": SESSION, "nyse": SESSION, "nasdaq": SESSION}}],
       "stockData": [{"ref": "m1", "label": "UCT stock data"}]}
REQ = {"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"], "date": None,
       "compare_date": None, "start": None, "end": None}
BREADTH_OP = {"action": "breadth.show", "target": "b1", "args": REQ}
PROFILE_OP = {"action": "stock.profile", "target": "m1", "args": {"symbol": "NVDA"}}


def env(disposition, ops=(), reply="", question=None):
    return {"disposition": disposition, "reply": reply, "question": question, "ops": list(ops),
            "unsupported_category": None, "research": None}


def _resp(e):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(e))], stop_reason="end_turn",
                                 usage=types.SimpleNamespace(input_tokens=100, output_tokens=20))


class ScriptedModel:
    """Stands in for the model: returns the queued envelopes and CAPTURES every request it is sent."""
    def __init__(self):
        self.queue, self.calls = [], []

    def __call__(self, **kw):
        self.calls.append(kw)
        if kw.get("max_tokens") == 64:                       # the background naming call
            return _resp({"title": "Breadth check"})
        return _resp(self.queue.pop(0))


def leaked(payload) -> list[str]:
    blob = json.dumps(payload, default=str, ensure_ascii=False)
    return [s for s in SENTINEL_STRINGS if s in blob]


@pytest.fixture
def world(monkeypatch):
    # The fixture's own socket ban also blocks the LOOPBACK socketpair Windows asyncio needs inside
    # TestClient, so it is replaced by an equivalent guard that refuses every non-loopback connect.
    import socket
    state = synthetic_breadth_world(monkeypatch, sentinel=SENTINEL, session=SESSION, forbid_network=False)
    real_connect = socket.socket.connect

    def loopback_only(self, addr, *a, **k):
        host = addr[0] if isinstance(addr, tuple) else addr
        if host not in ("127.0.0.1", "::1", "localhost"):
            raise AssertionError(f"no network in breadth leak tests (tried {host})")
        return real_connect(self, addr, *a, **k)
    monkeypatch.setattr(socket.socket, "connect", loopback_only)
    monkeypatch.setattr(socket, "create_connection",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no network in breadth leak tests")))
    return state


@pytest.fixture
def model(monkeypatch):
    m = ScriptedModel()
    monkeypatch.setattr(turn, "_default_caller", m)
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.0)
    return m


def _client(monkeypatch, user):
    monkeypatch.setattr(rx, "_et_day", lambda: "2026-10-11")
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


@pytest.fixture
def client(monkeypatch):
    daily_counters.clear()
    store._reset_for_tests()
    yield _client(monkeypatch, ADMIN)
    daily_counters.clear()


def _turn(client, message, cid=None, **extra):
    r = client.post("/api/agent/turn", json={"conversationId": cid, "message": message, "context": CTX,
                                             "capabilities": CAPS, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _execute_locally(client, cid, ops, *, member=None, outcome_data=None):
    """What the browser does with a plan's queries (useAgent.execute): answer each, show it, record it."""
    texts = []
    for o in ops:
        if o["action"] == "breadth.show":
            r = client.post("/api/agent/breadth", json=o["args"])
            assert r.status_code == 200
            texts.append(r.json()["text"])
        else:
            texts.append("NVDA — Nvidia Corp. Price $191.40. (profile answered from UCT's own data)")
    local = [o for o in ops if o["action"] == "breadth.show"]
    data = outcome_data if outcome_data is not None else {
        "kind": "answered", "actions": [o["action"] for o in ops],
        **({"local": True, "requests": [o["args"] for o in local]} if local else {})}
    r = client.post("/api/agent/record", json={"conversationId": cid, "member": member, "outcome": "\n\n".join(texts),
                                               "outcomeData": data})
    assert r.status_code == 200
    return "\n\n".join(texts)


# ═══ 1. the route: admin-only, read-only, answers locally ═══════════════════════════════════════════

def test_ROUTE_admin_only_like_every_agent_route(world, monkeypatch):
    daily_counters.clear()
    assert _client(monkeypatch, MEMBER).post("/api/agent/breadth", json=REQ).status_code == 403
    assert _client(monkeypatch, MEMBER).get("/api/agent/breadth/dates").status_code == 403
    monkeypatch.setattr(rx, "is_paid_user", lambda u: False)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {**ADMIN, "plan": "free"}
    assert TestClient(app).post("/api/agent/breadth", json=REQ).status_code == 402


def test_ROUTE_answers_the_member_with_the_real_figure(client, world):
    r = client.post("/api/agent/breadth", json=REQ)
    assert r.status_code == 200
    b = r.json()
    assert b["status"] == "ok" and "73.5%" in b["text"] and SESSION in b["text"]      # the member sees it
    assert b["table"]["rows"][0]["value"] == "73.5%"
    assert set(b) == {"status", "text", "table"}                                     # nothing else rides along


def test_ROUTE_refuses_by_reason_and_bounds_the_body(client, world):
    assert client.post("/api/agent/breadth", json={**REQ, "from": "2026-01-01"}).json()["status"] == "refused"
    assert client.post("/api/agent/breadth", json={**REQ, "universe": "uct"}).json()["status"] == "refused"
    unk = client.post("/api/agent/breadth", json={**REQ, "metrics": ["made_up"]}).json()
    assert unk["status"] == "refused" and unk["table"] is None
    assert client.post("/api/agent/breadth", json={**REQ, "metrics": ["x" * 3000]}).status_code == 400


def test_DATES_route_carries_dates_only(client, world):
    d = client.get("/api/agent/breadth/dates").json()
    assert d == {"today_et": "2026-10-11", "latest_finalized": {"us": SESSION, "nyse": SESSION, "nasdaq": SESSION}}
    assert not leaked(d)


# ═══ 2. the browser mirror stays in step with the MI module ═════════════════════════════════════════

def _js(path):
    return (REPO / path).read_text(encoding="utf-8")


def test_MIRROR_metrics_universes_and_guide_match_market_intel():
    js = _js("app/src/agent/capabilities/breadth.js")
    metrics = re.findall(r"'([a-z0-9_]+)'", js[js.index("BREADTH_METRICS = ["):js.index("]", js.index("BREADTH_METRICS = ["))])
    assert tuple(metrics) == breadth_reads.SLICE1_METRICS
    unis = re.findall(r"'([a-z]+)'", js[js.index("BREADTH_UNIVERSES = ["):js.index("]", js.index("BREADTH_UNIVERSES = ["))])
    assert tuple(unis) == breadth_reads.SLICE1_UNIVERSES
    g = js[js.index("METRIC_GUIDE = ("):js.index("\n)", js.index("METRIC_GUIDE = ("))]
    assert "".join(re.findall(r"'((?:[^'\\]|\\.)*)'", g)) == breadth_reads.METRIC_GUIDE


def test_MIRROR_the_servers_local_only_set_is_every_localOnly_capability():
    found = set()
    for f in (REPO / "app/src/agent/capabilities").glob("*.js"):
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"name: '([a-zA-Z]+\.[a-zA-Z]+)'", src):
            nxt = src.find("registerCapability(", m.end())
            if "localOnly: true" in src[m.end(): nxt if nxt != -1 else len(src)]:
                found.add(m.group(1))
    assert found == set(turn.LOCAL_ONLY_ACTIONS) == {"breadth.show"}


# ═══ 3. the one door: what a stored row may say to a model ══════════════════════════════════════════

ANSWER_TEXT = "US · % Above 50-Day: 73.5% on 2026-10-09. Prior session 2026-10-08: 61.0%."


@pytest.mark.parametrize("data", [
    {"kind": "answered", "actions": ["breadth.show"], "local": True, "requests": [REQ]},
    {"kind": "answered", "actions": ["breadth.show"]},                                  # no local flag: the NAME decides
    {"kind": "answered", "actions": ["stock.profile", "breadth.show"], "local": True, "requests": [REQ]},   # mixed
    {"kind": "answered", "actions": ["stock.profile"], "local": True},                  # local flag, no breadth action
    {"kind": "refused", "actions": ["breadth.show"]},
    {"kind": "clarify-arg", "actions": ["breadth.show"]},
    None, "garbled", ["breadth.show"], {"kind": "answered", "actions": "breadth.show"},
    {"kind": "answered", "actions": [None, 3]},
])
def test_DOOR_a_local_or_unreadable_outcome_never_passes_its_text(data):
    out = turn.outcome_for_model({"role": "outcome", "text": ANSWER_TEXT, "data": data})
    assert not leaked(out) and "73.5" not in out and ANSWER_TEXT not in out


@pytest.mark.parametrize("data", [None, "garbled", ["breadth.show"], {"kind": "answered", "actions": "breadth.show"},
                                  {"kind": "answered", "actions": [None, 3]}])
def test_DOOR_an_unreadable_row_is_replaced_by_the_fixed_line_fail_closed(data):
    row = {"role": "outcome", "text": ANSWER_TEXT, "data": data}
    assert turn.is_local_row(row) is True
    assert turn.outcome_for_model(row) == turn.UNREADABLE_OUTCOME


def test_DOOR_the_note_keeps_what_was_ASKED_validated_args_only():
    bad = {**REQ, "metrics": ["pct_above_50sma"], "date": "73.4567"}              # a value smuggled as a date
    out = turn.outcome_for_model({"role": "outcome", "text": ANSWER_TEXT,
                                  "data": {"kind": "answered", "actions": ["breadth.show"], "local": True,
                                           "requests": [REQ, bad, "nope", {"x": 1}]}})
    assert out.startswith(turn.LOCAL_RESULT_NOTE)
    assert "US: pct_above_50sma; on the latest finalized session" in out
    assert not leaked(out)


def test_DOOR_ordinary_outcomes_are_unchanged():
    t = {"role": "outcome", "text": "Switched timeframe to 15", "data": {"kind": "applied", "actions": ["chart.setTimeframe"]}}
    assert turn.outcome_for_model(t) == "[UCT executed] Switched timeframe to 15"
    p = {"role": "outcome", "text": "Proposed: delete Momentum", "data": {"kind": "proposed", "actions": ["watchlist.delete"]}}
    assert turn.outcome_for_model(p).startswith("[UCT proposed")


def test_DOOR_a_local_plans_agent_row_is_left_out_even_if_stored_with_text():
    rows = [{"role": "member", "text": "breadth?"},
            {"role": "agent", "text": "It was 73.5% on Friday", "data": {"envelope": env("apply", [BREADTH_OP])}},
            {"role": "agent", "text": "garbled 73.5", "data": {"envelope": "not an envelope"}}]
    assert not leaked(turn.history_messages(rows))


def test_PLAN_reply_is_blanked_for_a_local_lookup():
    out = turn.sanitize_envelope(env("apply", [BREADTH_OP], reply="Breadth was 73.5% on Friday."), {"b1"})
    assert out["ops"] == [BREADTH_OP] and out["reply"] == ""
    # a plan without a local-only op keeps a disclosing reply
    out2 = turn.sanitize_envelope(env("apply", [PROFILE_OP], reply="Using UCT's stock data."), {"m1"})
    assert out2["reply"] == "Using UCT's stock data."


# ═══ 4. the joint multi-turn leak test (real router, scripted model, captured payloads) ════════════

def _assert_no_leak(model, cid, client):
    assert model.calls, "the scripted model was never called"
    for i, kw in enumerate(model.calls):
        assert not leaked(kw), f"model call {i} ({'naming' if kw.get('max_tokens') == 64 else 'turn'}) carried {leaked(kw)}"
    conv = client.get(f"/api/agent/conversations/{cid}").json()
    agent_rows = [t for t in conv["turns"] if t.get("role") == "agent"]
    assert agent_rows, "no stored model plan was inspected"
    for t in agent_rows:
        assert not leaked(t.get("text")) and not leaked(t.get("data")), "a stored model plan carries the figure"
    for t in store.get_turns(ADMIN["id"], cid):
        if t["role"] == "agent":
            assert not leaked(t), "the stored agent row carries the figure"


def test_LEAK_two_turns_success_then_follow_up(client, world, model):
    model.queue = [env("apply", [BREADTH_OP], reply="On it — breadth was about 73.5% Friday."),   # an INVENTED figure too
                   env("answer", reply="Ask me for any date and I'll look it up.")]
    t1 = _turn(client, "What % of US stocks are above their 50-day?")
    cid = t1["conversationId"]
    assert t1["envelope"]["reply"] == "" and t1["envelope"]["ops"] == [BREADTH_OP]
    shown = _execute_locally(client, cid, t1["envelope"]["ops"])
    assert "73.5%" in shown                                                       # the member saw the real figure
    _turn(client, "And how does that compare with a month earlier?", cid,
          recentOutcome=shown, pending=None)                                      # a client that sends it anyway
    _assert_no_leak(model, cid, client)
    turn2 = model.calls[-1] if model.calls[-1].get("max_tokens") != 64 else model.calls[-2]
    msgs = json.dumps(turn2["messages"], ensure_ascii=False)
    assert "pct_above_50sma" in msgs and "never given to you" in msgs              # the history stays usable
    assert "recent_outcome" not in msgs
    # the member's own stored history keeps the factual answer (not censored for the member)
    conv = json.dumps(client.get(f"/api/agent/conversations/{cid}").json(), ensure_ascii=False)
    assert "73.5%" in conv


def test_LEAK_naming_input_never_sees_the_figure(client, world, model):
    model.queue = [env("apply", [BREADTH_OP])]
    t1 = _turn(client, "breadth today?")
    _execute_locally(client, t1["conversationId"], t1["envelope"]["ops"])
    naming = [kw for kw in model.calls if kw.get("max_tokens") == 64]
    assert naming, "the background naming call did not run"
    turn.name_conversation(store.get_turns(ADMIN["id"], t1["conversationId"]), caller=model)   # a later naming too
    assert not any(leaked(kw) for kw in model.calls if kw.get("max_tokens") == 64)


@pytest.mark.parametrize("variant", ["refusal", "clarify", "mixed", "local-flag-only", "no-data", "garbled-actions"])
def test_LEAK_variants_then_a_follow_up(client, world, model, variant):
    model.queue = [env("apply", [BREADTH_OP, PROFILE_OP] if variant == "mixed" else [BREADTH_OP]),
                   env("answer", reply="OK.")]
    t1 = _turn(client, "US breadth on the 50-day, and NVDA's profile")
    cid = t1["conversationId"]
    ops = t1["envelope"]["ops"]
    text = f"{ANSWER_TEXT} (variant {variant})"
    if variant == "mixed":
        _execute_locally(client, cid, ops)
    elif variant in ("refusal", "clarify"):
        kind = "refused" if variant == "refusal" else "clarify-arg"
        client.post("/api/agent/record", json={"conversationId": cid, "outcome": text,
                                               "outcomeData": {"kind": kind, "actions": ["breadth.show"]}})
    elif variant == "local-flag-only":
        client.post("/api/agent/record", json={"conversationId": cid, "outcome": text,
                                               "outcomeData": {"kind": "answered", "actions": ["stock.profile"], "local": True}})
    elif variant == "no-data":
        client.post("/api/agent/record", json={"conversationId": cid, "outcome": text})
    else:                                                                          # a row the server cannot read
        store.add_turn(ADMIN["id"], cid, "outcome", text, {"kind": "answered", "actions": "breadth.show"})
    _turn(client, "thanks — anything else worth knowing?", cid)
    _assert_no_leak(model, cid, client)


def test_LEAK_the_member_may_type_a_figure_and_it_is_not_censored(client, world, model):
    model.queue = [env("apply", [BREADTH_OP]), env("answer", reply="That is above its range midpoint.")]
    t1 = _turn(client, "% of US stocks above the 50-day?")
    _execute_locally(client, t1["conversationId"], t1["envelope"]["ops"])
    _turn(client, "Is 73.5% high for that measure?", t1["conversationId"])
    turn2 = [kw for kw in model.calls if kw.get("max_tokens") != 64][-1]
    member_text = [m["content"] for m in turn2["messages"] if m["role"] == "user"][-1]
    assert "Is 73.5% high for that measure?" in member_text                       # the member's own words pass
    # …and nothing UCT RETRIEVED rides along with them: the only 73.5 is inside the member's sentence
    blob = json.dumps(turn2, ensure_ascii=False).replace("Is 73.5% high for that measure?", "")
    assert not leaked(blob)
