"""⛔⛔ A NOTE THE EDITOR CANNOT BUILD IS NEVER CREATED — wave 10, lane 10C.

Found by the wave-5 walk (OPEN-ITEMS "POST /api/j2/notes accepts a body the editor
cannot build"): `POST /api/j2/notes` stored a body with an EMPTY text node, which
ProseMirror refuses to build ("Empty text nodes are not allowed"). The editor's
content guard then LOCKED the note and told the member it held "content from a
newer version of the app" -- false: the note was merely malformed.

The server half pinned here: the create door (and the import door, whose
"Needs attention" list shows the same sentence) refuses such a body with a 400
and ONE sentence, and still accepts everything ProseMirror can build -- a blank
note, a node with no content, a deeply nested body, and an unknown TYPE (that is
the newer-schema case, owned by `notebook_schema`, not by this check).

⛔ The malformation list mirrors ProseMirror's own throws in `Node.fromJSON`,
`Fragment.fromJSON`, `Mark.fromJSON` and the text-node constructor -- nothing
more, so the check can never refuse a body the editor would open.
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

SENTENCE = svc.UNBUILDABLE_BODY_DETAIL


def _p(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _t(text, **extra):
    return {"type": "text", "text": text, **extra}


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


UNBUILDABLE = {
    "empty text node": _doc(_p(_t(""))),
    "text node whose text is not a string": _doc(_p({"type": "text", "text": 5})),
    "text node with no text key": _doc(_p({"type": "text"})),
    "content that is not a list": _doc({"type": "paragraph", "content": {"type": "text", "text": "x"}}),
    "marks that are not a list": _doc(_p(_t("x", marks={"type": "bold"}))),
    "a mark that is not an object": _doc(_p(_t("x", marks=["bold"]))),
    "a node that is not an object": _doc("paragraph"),
    "an empty text node deep inside a list": _doc({"type": "bulletList", "content": [
        {"type": "listItem", "content": [_p(_t("ok")), _p(_t(""))]}]}),
    # ⛔ Fix round 1: JAVASCRIPT truthiness. `{}` is falsy in Python and was skipped;
    # in JS it is truthy, not an array, and ProseMirror throws. Every verdict from here
    # down was checked against prosemirror-model's own `Node.fromJSON` (2026-09-26,
    # wave10-10C-report.md, "Fix round 1").
    "the document's content is an empty object": {"type": "doc", "content": {}},
    "a node's content is an empty object": _doc({"type": "paragraph", "content": {}}),
    "marks that are an empty object": _doc(_p(_t("x", marks={}))),
    "a node with no type": _doc({"content": [_t("x")]}),
    "a node whose type is null": _doc({"type": None}),
    "a node whose type is empty": _doc({"type": ""}),
    "a node whose type is a number": _doc({"type": 5}),
    "an empty-object node": _doc({}),
    "a mark with no type": _doc(_p(_t("x", marks=[{"attrs": {}}]))),
    "an empty-object mark": _doc(_p(_t("x", marks=[{}]))),
}


def _deep(depth: int) -> dict:
    node = _p(_t("bottom"))
    for _ in range(depth):
        node = {"type": "blockquote", "content": [node]}
    return _doc(node)


BUILDABLE = {
    "a blank note": _doc(),
    "no body at all": None,
    "an ordinary paragraph with a mark": _doc(_p(_t("NVDA reclaimed the 20 EMA", marks=[{"type": "bold"}]))),
    "an empty paragraph (no content key)": _doc({"type": "paragraph"}),
    "content: null": _doc({"type": "paragraph", "content": None}),
    # ⚠️ 10, not 3,000: the check itself is iterative, but downstream code is not.
    # Measured 2026-09-26 (wave-10 10C report, H14 finding): FastAPI's response
    # serialiser refuses a body nested 24 list levels deep ("Circular reference
    # detected (depth exceeded)") -- POST stores the row and answers 500, and GET
    # answers 500 for good -- and `extract_plain_text` recurses past ~1,000. Both
    # pre-existing and not this rail's subject.
    "a nested body": _deep(10),
    # ⛔ NOT this check's business: an unknown TYPE is the newer-schema case.
    "an unknown node type": _doc({"type": "waveElevenWidget"}),
    # JS-falsy content and marks build (Fragment.empty / no marks) -- nothing more is refused.
    "an empty marks list": _doc(_p(_t("x", marks=[]))),
    "marks: null": _doc(_p(_t("x", marks=None))),
    "an empty content list": _doc({"type": "paragraph", "content": []}),
    "content: false": _doc({"type": "paragraph", "content": False}),
    "content: 0": _doc({"type": "paragraph", "content": 0}),
}


# A LIST type is a name to JavaScript: `schema.nodes[["paragraph"]]` looks the key up by
# its string form, and `["text"] == "text"` is true. ProseMirror builds all of these, so
# the check must not refuse them. Asserted on the check itself: what the REST of the
# create pipeline makes of a list-typed node is not this rail's subject.
LIST_TYPED = {
    "a node typed as a one-element list": (_doc({"type": ["paragraph"], "content": [_t("x")]}), None),
    "a text node typed as ['text']": (_doc(_p({"type": ["text"], "text": "x"})), None),
    "a text node typed as [['text']]": (_doc(_p({"type": [["text"]], "text": "x"})), None),
    "a mark typed as a one-element list": (_doc(_p(_t("x", marks=[{"type": ["bold"]}]))), None),
    "an EMPTY text node typed as ['text']": (_doc(_p({"type": ["text"], "text": ""})), "a text node is empty"),
}


@pytest.mark.parametrize("case", sorted(LIST_TYPED))
def test_a_list_type_is_read_the_way_javascript_reads_it(case):
    body, want = LIST_TYPED[case]
    assert svc._body_build_problem(body) == want, case


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def client(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-build", "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


@pytest.mark.parametrize("case", sorted(UNBUILDABLE))
def test_POST_refuses_a_body_the_editor_cannot_build_with_ONE_sentence(client, case):
    r = client.post("/api/j2/notes", json={"title": "walk seed", "bodyJson": UNBUILDABLE[case]})
    assert r.status_code == 400, f"{case}: {r.status_code} {r.text}"
    assert r.json()["detail"] == SENTENCE
    # ⛔ And nothing was stored: a refused create leaves no half-note behind.
    listed = client.get("/api/j2/notes").json()
    rows = listed.get("notes", listed if isinstance(listed, list) else [])
    assert not [n for n in rows if n.get("title") == "walk seed"], f"{case}: a refused note was stored"


@pytest.mark.parametrize("case", sorted(BUILDABLE))
def test_POST_still_accepts_every_body_the_editor_can_build(client, case):
    payload = {"title": case}
    if BUILDABLE[case] is not None:
        payload["bodyJson"] = BUILDABLE[case]
    r = client.post("/api/j2/notes", json=payload)
    assert r.status_code == 200, f"{case}: {r.status_code} {r.text}"


def test_the_sentence_says_what_is_wrong_and_what_to_do_and_is_not_the_newer_version_one():
    from api.services.journal_two.notebook_schema import REFUSAL_DETAIL
    assert SENTENCE != REFUSAL_DETAIL, "the malformed case must not claim a newer version of the app"
    assert "newer version" not in SENTENCE
    assert "empty or malformed" in SENTENCE and "try again" in SENTENCE


def test_import_puts_an_unbuildable_note_in_needs_attention_and_keeps_its_sibling():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    out = svc.import_confirm("u-imp", {"source": "generic", "notes": [
        {"importKey": "bad", "title": "Bad", "bodyJson": UNBUILDABLE["empty text node"], "tags": []},
        {"importKey": "good", "title": "Good", "bodyJson": _doc(_p(_t("kept"))), "tags": []},
    ]}, conn=c)
    assert [f["importKey"] for f in out["failed"]] == ["bad"]
    assert out["failed"][0]["error"] == SENTENCE
    assert [i["importKey"] for i in out["created"]] == ["good"], "the healthy sibling must still be created"
    titles = [r["title"] for r in c.execute("SELECT title FROM j2_notes")]
    c.close()
    assert titles == ["Good"]


def test_the_personal_api_door_reports_the_sentence_not_a_500(monkeypatch):
    """The personal API creates through `create_note` too; its existing mapping
    turns the refusal into a 400 carrying the sentence (not a 500)."""
    from api.services.journal_two import note_personal_api as papi

    def refuse(user_id, payload):  # exactly what create_note raises for such a body
        raise svc.NoteValidationError(SENTENCE)
    monkeypatch.setattr(svc, "create_note", refuse)
    with pytest.raises(papi.PersonalApiError) as ei:
        papi.create_note_from_markdown("u", title="t", markdown="hello")
    assert ei.value.status == 400
    assert SENTENCE in ei.value.message
