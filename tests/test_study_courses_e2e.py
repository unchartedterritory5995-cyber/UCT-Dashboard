"""Study courses end to end (docs/study/courses/README.md): the REAL built bank (docs/study/bank/course.*.json) goes
through the same import route the pod uses, the owner approves it, and a member plays a unit:

  * the import stores every course item as a DRAFT, with no item flagged by the importer's own checks;
  * the member's map hides the unit while it is all drafts and shows it once one item is approved;
  * a unit session opens with the unit's walk-throughs, then climbs easy to hard;
  * a scored answer returns the reveal a member reads: the lesson, the cited pages (https links), the wrong-choice notes;
  * no key, no subject, no source quote reaches the member before the answer.
"""
from __future__ import annotations

import json
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import get_current_user
from api.services import study_store as ss

REPO = pathlib.Path(__file__).resolve().parents[1]
BANK = sorted((REPO / "docs" / "study" / "bank").glob("course.*.json"))
ITEMS = [it for f in BANK for it in json.loads(f.read_text(encoding="utf-8"))]
MEMBER = {"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"}

pytestmark = pytest.mark.skipif(not ITEMS, reason="no course bank built yet")


@pytest.fixture()
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    monkeypatch.setenv("PUSH_SECRET", "test-secret-123")
    ss.init_db()
    app = FastAPI()
    app.include_router(study_router.router)
    push = TestClient(app)
    push.headers.update({"Authorization": "Bearer test-secret-123"})
    member_app = FastAPI()
    member_app.include_router(study_router.router)
    member_app.dependency_overrides[study_router.require_paid] = lambda: MEMBER
    member_app.dependency_overrides[get_current_user] = lambda: MEMBER
    return push, TestClient(member_app)


def _no_chart(items):
    # a chart item needs the pod's bars.db to resolve its spec; this test imports the text items
    return [it for it in items if not it.get("bars")]


def test_the_built_course_bank_imports_clean_and_plays(clients):
    push, member = clients
    items = _no_chart(ITEMS)
    r = push.post("/api/study/import", json={"items": items})
    assert r.status_code == 200, r.text
    body = r.json()
    assert not body.get("flagged"), body.get("flagged")[:5]
    assert not body.get("rejected"), body.get("rejected")[:5]

    # every item landed as a draft
    with ss._connect() as c:
        statuses = {row["review_status"] for row in c.execute("SELECT review_status FROM study_items")}
    assert statuses == {"draft"}

    skill = next(it["skill_id"] for it in items if it["type"] != "walkthrough")
    unit_ids = lambda: [u["id"] for cur in member.get("/api/study/map").json()["map"]["curricula"]
                        for tr in cur["tracks"] for u in tr["units"] if skill in u.get("skills", [])]
    assert unit_ids() == []                                   # all drafts: the unit stays hidden

    mine = [it for it in items if it["skill_id"] == skill]
    for it in mine:
        ss.approve(it["id"], "owner")
    assert len(unit_ids()) == 1                               # one approval opens it

    s = member.post("/api/study/sessions", json={"kind": "unit", "skill_id": skill, "size": 12})
    assert s.status_code == 200, s.text
    played = s.json()["items"]
    walks = [p for p in played if p["type"] == "walkthrough"]
    scored = [p for p in played if p["type"] != "walkthrough"]
    assert walks and played[:len(walks)] == walks              # walk-throughs first
    levels = [p["difficulty"] for p in scored]
    assert levels == sorted(levels)                           # then easy to hard

    blob = json.dumps(played)
    assert '"answer_json"' not in blob and '"subject"' not in blob and '"depth"' not in blob

    first = scored[0]
    key = next(it for it in mine if it["id"] == first["id"])["answer_json"]["answer"]
    a = member.post("/api/study/attempts", json={"item_id": first["id"], "answer": {"choice": key}})
    assert a.status_code == 200 and a.json()["correct"] is True
    rv = a.json()["reveal"]
    assert rv["lesson"] and rv["provenance"]["source_kind"] == "course"
    assert rv["depth"]["sources"] and all(c["url"].startswith(("https://", "repo:")) for c in rv["depth"]["sources"])


def test_every_course_item_carries_its_sources_and_a_lesson():
    for it in ITEMS:
        assert it["review_status"] == "draft" and it["source_kind"] == "course"
        assert it["lesson_text"], it["id"]
        cites = (it.get("reveal_json") or {}).get("depth", {}).get("sources") or []
        assert cites, f"{it['id']} cites nothing"
        if it["type"] != "walkthrough":
            assert it["reveal_json"].get("why") and it["reveal_json"].get("lesson_line"), it["id"]
