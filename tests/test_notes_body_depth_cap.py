"""⛔⛔ NO DOOR STORES A NOTE THE ROUTES CANNOT SERVE BACK — wave 10, lane 10C (H14).

Measured 2026-09-26 through the real router (docs/notebook/evidence/wave10-10c/
deep-nesting-probe-output.txt): a note whose body nests 24 bullet levels deep was
STORED by POST, which then answered 500, and every later GET answered 500 -- the
member could never open it again. FastAPI's response serialiser has a depth
ceiling; `notes.MAX_BODY_DEPTH` is that ceiling, measured, and every body door
(`_validate_body_json`) refuses a deeper body with one sentence.

What this pins, each through the REAL router:
  * a body AT the cap is created AND READ BACK -- so a cap above the serialiser's
    real ceiling goes red here instead of shipping unreadable notes;
  * a body one level past it is refused 400 with the sentence, and nothing is stored;
  * a PUT that would deepen a note past it is refused, and the stored note is untouched;
  * an import of such a note lands in "Needs attention", its sibling still created;
  * an ordinary deep outline (20 bullet levels) is still accepted and readable.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import notes as svc
from api.services.journal_two.db import ensure_schema

CAP = svc.MAX_BODY_DEPTH
SENTENCE = svc.TOO_DEEP_BODY_DETAIL


def depth(o) -> int:
    best, stack = 0, [(o, 1)]
    while stack:
        x, d = stack.pop()
        if isinstance(x, (dict, list)):
            best = max(best, d)
            kids = x.values() if isinstance(x, dict) else x
            stack.extend((v, d + 1) for v in kids)
    return best


def body_of_depth(target: int) -> dict:
    """A doc whose JSON depth is exactly `target`: nested blockquotes (2 levels each)
    around a leaf paragraph. doc(1) > content(2) > para(3) > content(4) > text(5) is
    depth 5; a link mark with attrs on the text adds three (marks 6 > mark 7 >
    attrs 8), so an ODD target uses the plain leaf and an EVEN one the linked leaf."""
    plain = {"type": "paragraph", "content": [{"type": "text", "text": "deepest words"}]}
    linked = {"type": "paragraph", "content": [{"type": "text", "text": "deepest words",
                                                "marks": [{"type": "link", "attrs": {"href": "https://x.test"}}]}]}
    node = plain if target % 2 else linked
    n = (target - depth({"type": "doc", "content": [node]})) // 2
    for _ in range(n):
        node = {"type": "blockquote", "content": [node]}
    doc = {"type": "doc", "content": [node]}
    assert depth(doc) == target, (depth(doc), target)
    return doc


def bullets(levels: int) -> dict:
    node = {"type": "paragraph", "content": [{"type": "text", "text": "outline leaf"}]}
    for _ in range(levels):
        node = {"type": "bulletList", "content": [{"type": "listItem", "content": [node]}]}
    return {"type": "doc", "content": [node]}


@pytest.fixture
def client(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.routers import journal_two as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-depth", "role": "member"}
    yield TestClient(fa, raise_server_exceptions=False)
    fa.dependency_overrides.clear()
    os.unlink(tmp.name)


def test_the_body_builder_really_builds_the_depth_it_names():
    for d in (CAP - 1, CAP, CAP + 1):
        assert depth(body_of_depth(d)) == d


def test_a_body_AT_the_cap_is_created_and_READ_BACK_through_the_real_router(client):
    """⛔ The load-bearing rail: a cap above the serialiser's ceiling would store a
    note that 500s on read. Here that is a red test, not a member's lost note."""
    r = client.post("/api/j2/notes", json={"title": "at cap", "bodyJson": body_of_depth(CAP)})
    assert r.status_code == 200, r.text
    g = client.get(f"/api/j2/notes/{r.json()['note']['id']}")
    assert g.status_code == 200, "a note stored AT the cap must be readable -- the cap is above the ceiling"
    assert "deepest words" in g.json()["note"]["bodyPlain"]


def test_one_level_past_the_cap_is_refused_with_the_sentence_and_nothing_is_stored(client):
    r = client.post("/api/j2/notes", json={"title": "past cap", "bodyJson": body_of_depth(CAP + 1)})
    assert r.status_code == 400
    assert r.json()["detail"] == SENTENCE
    listed = client.get("/api/j2/notes").json()
    assert not [n for n in listed.get("notes", []) if n.get("title") == "past cap"]


def test_the_24_level_outline_that_used_to_become_unopenable_is_refused_not_stored(client):
    r = client.post("/api/j2/notes", json={"title": "b24", "bodyJson": bullets(24)})
    assert r.status_code == 400 and r.json()["detail"] == SENTENCE


def test_an_ordinary_deep_outline_is_still_accepted_and_readable(client):
    r = client.post("/api/j2/notes", json={"title": "b20", "bodyJson": bullets(20)})
    assert r.status_code == 200, r.text
    assert client.get(f"/api/j2/notes/{r.json()['note']['id']}").status_code == 200


def test_a_PUT_past_the_cap_is_refused_and_the_stored_note_is_untouched(client):
    n = client.post("/api/j2/notes", json={"title": "grow", "bodyJson": bullets(5)}).json()["note"]
    r = client.put(f"/api/j2/notes/{n['id']}", json={"bodyJson": body_of_depth(CAP + 1),
                                                     "baseUpdatedAt": n["updatedAt"]})
    assert r.status_code == 400 and r.json()["detail"] == SENTENCE
    g = client.get(f"/api/j2/notes/{n['id']}")
    assert g.status_code == 200 and g.json()["note"]["updatedAt"] == n["updatedAt"]


def test_import_puts_a_too_deep_note_in_needs_attention_and_keeps_its_sibling():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    out = svc.import_confirm("u-imp", {"source": "roam", "notes": [
        {"importKey": "deep", "title": "Deep outline", "bodyJson": bullets(30), "tags": []},
        {"importKey": "ok", "title": "Shallow", "bodyJson": bullets(3), "tags": []},
    ]}, conn=c)
    assert [f["importKey"] for f in out["failed"]] == ["deep"]
    assert out["failed"][0]["error"] == SENTENCE
    assert [i["importKey"] for i in out["created"]] == ["ok"]
    c.close()
