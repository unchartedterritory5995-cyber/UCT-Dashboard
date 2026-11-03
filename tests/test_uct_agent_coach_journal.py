"""Wave 3 W3-3 (w3-a, 2026-11-03) -- trade review foundations, server side: the `coachConsent` state key (validated,
flag-gated, owner-scoped), the descriptive review statistics (mirrored in the browser over ONE fixture), the
model-facing whitelist, and the rails: the model never sees a trade's prices; nothing under coach/ touches the
journal. Fake j2 rows only; no model, no network."""
from __future__ import annotations

import json
import re
import types
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services.uct_agent import coach, store, turn
from api.services.uct_agent.coach import review

REPO = Path(__file__).resolve().parents[1]
FX = json.loads((REPO / "app" / "src" / "agent" / "__fixtures__" / "coachJournalRows.json").read_text(encoding="utf-8"))
ME = {"id": "u-me", "plan": "pro", "role": "admin"}
OTHER = {"id": "u-other", "plan": "pro", "role": "admin"}


@pytest.fixture(autouse=True)
def _db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "agent.db"))
    store._reset_for_tests()
    yield
    store._reset_for_tests()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(coach.FLAG_ENV, "1")


@pytest.fixture
def off(monkeypatch):
    monkeypatch.delenv(coach.FLAG_ENV, raising=False)


@pytest.fixture
def client():
    def build(user):
        from api.middleware.auth_middleware import get_current_user_with_plan
        app = FastAPI()
        app.include_router(rx.router)
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
        return TestClient(app)
    return build


# ── the review statistics (the shared fixture) ──────────────────────────────────────────────────────────────────────

def test_stats_match_the_shared_fixture_both_windows():
    assert review.stats(FX["rows"], 10) == FX["expected_n10"]
    assert review.stats(FX["rows"], 3) == FX["expected_n3"]


def test_stats_are_value_free_and_rounded_half_up():
    s = review.stats(FX["rows"], 10)
    dumped = json.dumps(s)
    for forbidden in ("entryPrice", "exitPrice", "symbol", "AAA", "entryDate", "pnlDollar", "originalStop"):
        assert forbidden not in dumped
    assert s["winRatePct"] == 63                   # 62.5 -> 63 like Math.round, never banker's 62
    assert review.clamp_n(None) == review.DEFAULT_N and review.clamp_n(500) == review.MAX_N and review.clamp_n(0) == 1


def test_stats_without_r_fall_back_to_percent_and_handle_empty():
    rows = [{**r, "rMultiple": None} for r in FX["rows"]]
    s = review.stats(rows, 10)
    assert s["withR"] == 0 and s["avgR"] is None and s["largestWinR"] is None
    assert s["largestWinPct"] == 20.0 and s["largestLossPct"] == -5.0
    assert review.stats([], 10)["considered"] == 0
    assert review.review_text(review.stats([], 10)).startswith("Your journal has no trades")
    open_only = [r for r in FX["rows"] if not r["exitDate"]]
    assert "still open" in review.review_text(review.stats(open_only, 10))


def test_review_text_is_descriptive_and_passes_the_guard():
    from api.services.uct_agent.coach import guard
    s = review.stats(FX["rows"], 10)
    t = review.review_text(s)
    assert t.endswith(review.DESCRIPTIVE)
    assert "5 wins, 3 losses, 1 breakeven (win rate 63%)" in t
    assert "Average R +0.47R over the 8" in t and "largest loss -1.75R" in t
    assert "chased (2)" in t
    assert guard.check(t, json.dumps(s)) == []               # every figure is in the stats; no claim, no order
    assert not re.search(r"\bAAA\b|\$\d", t)


def test_model_view_whitelists_and_drops_everything_else():
    s = review.stats(FX["rows"], 10)
    mv = review.model_view({**s, "rows": FX["rows"], "symbols": ["AAA"], "entryPrice": 10.0, "mistakeTags": s["mistakeTags"] + [{"tag": 1, "count": "x"}]})
    assert set(mv) <= set(review.MODEL_KEYS)
    assert "rows" not in mv and "symbols" not in mv and "entryPrice" not in mv
    assert mv["mistakeTags"] == s["mistakeTags"]
    assert review.model_view("not a dict") is None and review.model_view({}) is None


# ── consent: validation, the state routes, the flag ─────────────────────────────────────────────────────────────────

def test_validate_consent_shape_and_server_clock():
    v = coach.validate_consent({"granted": True, "extra": "dropped"})
    assert v["granted"] is True and set(v) == {"granted", "at"} and v["at"].endswith("Z")
    assert coach.consent_state(v) == "granted" and coach.consent_state({"granted": False}) == "revoked"
    assert coach.consent_state(None) == "unknown"
    for bad in ({}, {"granted": "yes"}, {"granted": 1}, "true", None, []):
        with pytest.raises(ValueError):
            coach.validate_consent(bad)


def test_consent_route_round_trips_grant_and_revoke_owner_scoped(on, client):
    cid = store.create_conversation(ME["id"], "coach me")
    c = client(ME)
    assert c.get(f"/api/agent/conversations/{cid}/state/coachConsent").json()["value"] is None
    r = c.put(f"/api/agent/conversations/{cid}/state/coachConsent", json={"value": {"granted": True}})
    assert r.status_code == 200 and r.json()["value"]["granted"] is True
    got = c.get(f"/api/agent/conversations/{cid}/state/coachConsent").json()
    assert got["value"]["granted"] is True and got["value"]["at"]
    # the clear revoke
    r = c.put(f"/api/agent/conversations/{cid}/state/coachConsent", json={"value": {"granted": False}})
    assert r.json()["value"]["granted"] is False
    # a bad shape is a 400, never stored
    assert c.put(f"/api/agent/conversations/{cid}/state/coachConsent", json={"value": {"granted": "yes"}}).status_code == 400
    assert c.get(f"/api/agent/conversations/{cid}/state/coachConsent").json()["value"]["granted"] is False
    # another member: 404 both ways
    assert client(OTHER).get(f"/api/agent/conversations/{cid}/state/coachConsent").status_code == 404
    assert client(OTHER).put(f"/api/agent/conversations/{cid}/state/coachConsent", json={"value": {"granted": True}}).status_code == 404


def test_consent_key_does_not_exist_while_the_flag_is_off(off, client):
    cid = store.create_conversation(ME["id"], "coach me")
    c = client(ME)
    assert c.get(f"/api/agent/conversations/{cid}/state/coachConsent").status_code == 404
    assert c.put(f"/api/agent/conversations/{cid}/state/coachConsent", json={"value": {"granted": True}}).status_code == 404
    assert store.get_state(ME["id"], cid, "coachConsent") is None


def test_last_screen_route_is_unchanged_by_the_new_key(on, client, monkeypatch):
    from api.services.uct_agent.scan import refine
    monkeypatch.setattr(refine, "validate_last_screen", lambda v: {"ok": v})
    cid = store.create_conversation(ME["id"], "scan")
    r = client(ME).put(f"/api/agent/conversations/{cid}/state/lastScreen", json={"value": {"spec": {}}})
    assert r.status_code == 200 and r.json()["value"] == {"ok": {"spec": {}}}
    assert client(ME).put(f"/api/agent/conversations/{cid}/state/nope", json={"value": 1}).status_code == 404


# ── the model never sees a trade: sanitize_context on a coach turn ──────────────────────────────────────────────────

CAPS = [{"name": "journal.reviewTrades", "domain": "journal", "target": "coach", "summary": "Review.", "hints": None,
         "risk": "local", "reversible": True, "query": True,
         "args": {"type": "object", "properties": {"count": {"type": ["integer", "null"]}}, "required": ["count"], "additionalProperties": False}}]


def _ctx(entry):
    return {"charts": [{"ref": "c1", "label": "Chart (NVDA)", "symbol": "NVDA"}], "coach": [{"ref": "k1", "label": "Trading coach", **entry}]}


def test_sanitize_context_keeps_counts_and_stats_only():
    s = review.stats(FX["rows"], 10)
    ctx = _ctx({"consent": "granted", "review": {**s, "rows": FX["rows"], "trades": FX["rows"]}, "concept": "x" * 5000,
                "observation": "o", "secret": "no", "conceptId": "drawdown"})
    out = coach.sanitize_context(ctx)
    e = out["coach"][0]
    assert set(e) == {"ref", "label", "conceptId", "concept", "observation", "consent", "review"}
    assert e["review"] == review.model_view(s) and len(e["concept"]) == coach.MAX_CONCEPT_CHARS
    assert "AAA" not in json.dumps(out) and "entryPrice" not in json.dumps(out)
    # without consent the review is dropped whatever the browser sent
    assert "review" not in coach.sanitize_context(_ctx({"consent": "unknown", "review": s}))["coach"][0]
    assert "review" not in coach.sanitize_context(_ctx({"consent": "revoked", "review": s}))["coach"][0]
    assert coach.sanitize_context({"charts": []}) == {"charts": []}


def test_coach_turn_sends_the_model_the_sanitised_entry(on):
    seen = {}

    def caller(**kw):
        seen["user"] = kw["messages"][-1]["content"]
        e = {"disposition": "answer", "reply": "Your win rate of 63% describes the sample; it may not hold. What was your plan on the losses?",
             "question": None, "ops": [], "unsupported_category": None, "research": None}
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(e))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    s = review.stats(FX["rows"], 10)
    ctx = _ctx({"consent": "granted", "review": {**s, "rows": FX["rows"]}})
    out = turn.run_turn(message="what do you see in my trades?", context=ctx, history=[], capabilities=CAPS, caller=caller)
    assert '"winRatePct":63' in seen["user"].replace(" ", "") or '"winRatePct": 63' in seen["user"]
    assert "AAA" not in seen["user"] and "entryPrice" not in seen["user"] and "10.0" not in seen["user"]
    assert out["usage"]["coach_guard"] == []            # 63 is in the review input: traceable


# ── rails ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_nothing_under_coach_touches_the_journal():
    """The server coach package never imports journal_two nor names a j2 route: the browser reads trades through the
    existing route, and the only journal WRITE anywhere in the coach is journal.proposeNote's POST /api/j2/notes
    (railed in app/src/agent/agentCoachJournal.test.jsx)."""
    pkg = REPO / "api" / "services" / "uct_agent" / "coach"
    for f in pkg.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        code = "\n".join(l for l in text.splitlines() if not l.strip().startswith("#"))
        assert "journal_two" not in code.replace("app/src/agent/coach/", ""), f.name
        assert not re.search(r"['\"]/api/j2/", code), f.name
    assert "coachConsent" in store.STATE_KEYS
