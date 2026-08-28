"""Briefings rails (2026-08-28): CRUD + member scoping + caps, the scheduled
pass (delivery, isolation, capture-log feed), the ask-box proposal shapes, and
the scheduler wiring pin in api/main.py."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
import api.services.ai_search_briefings as brief
import api.services.ai_search_member as mem
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)


def _client(user_id=1, role="user", plan="pro"):
    app = FastAPI()
    app.include_router(ai.router)
    who = {"id": user_id, "role": role, "plan": plan}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def _fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_SEARCH_MEMBER_DB_PATH", str(tmp_path / "member.db"))
    mem._reset_for_tests()
    brief._reset_for_tests()


def test_crud_scoping_caps_and_dup(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    out = brief.create("u1", "morning read on CRM", "CRM", "premarket")
    assert out["ok"]
    assert brief.list_briefings("u1")[0]["sym"] == "CRM"
    assert brief.list_briefings("u2") == []                       # member-scoped
    # duplicate refused
    assert not brief.create("u1", "morning read on CRM", "CRM", "premarket")["ok"]
    # cap (default 3 enabled)
    assert brief.create("u1", "second question here", None, "premarket")["ok"]
    assert brief.create("u1", "third question here", None, "postmarket")["ok"]
    r4 = brief.create("u1", "fourth question here", None, "premarket")
    assert not r4["ok"] and "capped" in r4["reason"]
    # pause frees a slot
    bid = brief.list_briefings("u1")[0]["briefing_id"]
    assert brief.set_enabled("u1", bid, False)["ok"]
    assert brief.create("u1", "fourth question here", None, "premarket")["ok"]
    # RESUME re-checks the cap (pause→create→resume was a free bypass)
    r = brief.set_enabled("u1", bid, True)
    assert not r["ok"] and "capped" in r["reason"]
    # cross-member toggle/delete refused
    assert brief.set_enabled("u2", bid, True)["ok"] is False
    assert brief.delete("u2", bid) is False
    assert brief.delete("u1", bid) is True
    # bad cadence refused
    assert not brief.create("u1", "another question", None, "midnight")["ok"]


def test_run_due_delivers_and_isolates_failures(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    import api.services.ai_search_log as ail
    ail._reset_for_tests()
    brief.create("u1", "bad briefing that raises", "BAD", "premarket")
    brief.create("u2", "morning read on **CRM** and [Nvidia]($NVDA)", "CRM", "premarket")
    brief.create("u3", "an evening one", "SPY", "postmarket")   # wrong cadence — skipped

    def fake_answer(q):
        if "raises" in q:
            raise RuntimeError("boom")
        return {"answer": "CRM **beat** — see [Salesforce]($CRM).",
                "citations": ["https://x"], "model": "sonar-pro", "_meta": {}}

    monkeypatch.setattr(brief, "_answer_briefing", fake_answer)
    monkeypatch.setattr(brief, "_member_is_paid", lambda uid: uid != "lapsed")
    brief.create("lapsed", "a churned member's briefing", "OLD", "premarket")
    delivered = []
    import api.services.watchlist_alert_service as was
    delivered_kw = []
    monkeypatch.setattr(was, "deliver_alert_payload",
                        lambda uid, sym, title, message, **kw:
                        (delivered.append((uid, sym, title, message)),
                         delivered_kw.append(kw)) and {} or {})
    out = brief.run_due("premarket")
    assert out == {"ok": True, "ran": 3, "delivered": 1}
    uid, sym, title, message = delivered[0]
    assert uid == "u2" and sym == "CRM" and title.startswith("Morning brief")
    # info severity = bell+email only, never the global admin Discord webhook
    assert delivered_kw[0].get("severity") == "info"
    # delivery text is PLAIN — link syntax and bold stripped
    assert "($CRM)" not in message and "**" not in message and "Salesforce" in message
    # statuses stamped honestly (list_briefings is member-scoped and carries
    # no user_id column — query per member)
    assert brief.list_briefings("u1")[0]["last_status"] == "error"
    assert brief.list_briefings("u2")[0]["last_status"] == "delivered"
    assert brief.list_briefings("u3")[0]["last_status"] is None
    # the lapsed member's briefing was skipped, honestly labeled, and free
    assert brief.list_briefings("lapsed")[0]["last_status"] == "skipped: unpaid"
    # the answer fed the de-identified capture log
    rows = ail._all_rows_for_test()
    assert len(rows) == 1 and rows[0]["endpoint"] == "briefing"


def test_endpoints_member_scoped_and_paid_gated(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    c1 = _client(user_id=1)
    r = c1.post("/api/ai-search/briefings",
                json={"query": "morning read on CRM", "sym": "CRM", "cadence": "premarket"})
    assert r.status_code == 200
    bid = brief.list_briefings("1")[0]["briefing_id"]
    assert c1.get("/api/ai-search/briefings").json()["briefings"][0]["sym"] == "CRM"
    c2 = _client(user_id=2)
    assert c2.get("/api/ai-search/briefings").json()["briefings"] == []
    assert c2.delete(f"/api/ai-search/briefings/{bid}").json()["ok"] is False
    assert c1.post(f"/api/ai-search/briefings/{bid}/toggle?enabled=false").json()["ok"] is True
    # toggle/delete deliberately work WITHOUT a paid plan (lapsed members must
    # be able to stop their own standing briefings)
    lapsed = _client(user_id=1, plan="free")
    assert lapsed.post(f"/api/ai-search/briefings/{bid}/toggle?enabled=false").json()["ok"] is True
    assert c1.delete(f"/api/ai-search/briefings/{bid}").json()["ok"] is True
    free = _client(user_id=3, plan="free")
    assert free.get("/api/ai-search/briefings").status_code == 402


def test_briefing_proposal_shapes():
    assert ai._briefing_proposal("brief me on CRM every morning", ["CRM"]) == {
        "kind": "briefing", "query": "brief me on CRM every morning",
        "sym": "CRM", "cadence": "premarket"}
    assert ai._briefing_proposal("brief me on NVDA each evening", ["NVDA"])["cadence"] == "postmarket"
    assert ai._briefing_proposal("daily briefing on the market please", [])["sym"] is None
    # 'brief' without a cadence is just an adjective
    assert ai._briefing_proposal("give me a brief overview of CRM", ["CRM"]) is None
    # cadence words without 'brief' propose nothing
    assert ai._briefing_proposal("what happens every morning at the open?", []) is None
    # 2026-08-28 review: an explicit alert verb is the STRONGER intent — it
    # outranks briefing phrasing in the combined resolver…
    p = ai._ask_proposal("brief me every morning and alert me when CRM breaks above 300", ["CRM"])
    assert p["kind"] == "price_alert"
    # …and adjectival 'brief' beside a cadence word can no longer eat an alert
    p2 = ai._ask_proposal("alert me daily if NVDA drops below 200, keep it brief", ["NVDA"])
    assert p2 and p2["kind"] == "price_alert" and p2["direction"] == "below"
    # verb-shaped briefing asks still propose briefings
    assert ai._ask_proposal("brief me on CRM every morning", ["CRM"])["kind"] == "briefing"


def test_scheduler_wiring_pinned_in_main():
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert 'id="ai_search_briefings_premarket"' in src
    assert 'id="ai_search_briefings_postmarket"' in src
    assert 'AI_SEARCH_BRIEFINGS_ENABLED' in src
    # control (non-vacuity): the probe can see a sibling job id it is NOT about
    assert 'id="earnings_preview_warm"' in src
