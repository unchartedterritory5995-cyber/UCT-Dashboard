"""Wave 7 lane H, fix round 1 -- review M-11: a SHARED note keeps an accepted
writing-help block's provenance (`action`, `model`), so the public page labels
it "Compass · Rewrite · <model> · 09:41" exactly as the owner's editor does.

It held by construction -- `note_shares._reduce_ask_citations` rewrites only
`askCitation` chips -- and nothing pinned it, while the brief names shares
explicitly. This is the server half; SharedNotePage.writingHelp.test.jsx is
the page half (the label rendered on the public page).
"""
from __future__ import annotations

import copy
import importlib
import os
import tempfile

import pytest

from api.services.journal_two import note_shares

U = "u-share"
WH_ATTRS = {"insertedAt": "2026-09-25T09:41:00", "scope": "selection",
            "question": "Rewrite — shorter", "action": "rewrite", "model": "claude-sonnet-5"}


def _body():
    chip = {"type": "askCitation", "attrs": {"n": 1, "label": "Private note", "claim": "secret"}}
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "My own words."}]},
        {"type": "askInsert", "attrs": dict(WH_ATTRS), "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "A tighter version. "}, chip]}]},
    ]}


def _find(node, kind):
    if isinstance(node, dict):
        if node.get("type") == kind:
            return node
        for child in node.get("content") or []:
            hit = _find(child, kind)
            if hit is not None:
                return hit
    return None


def test_the_share_reducer_keeps_every_writing_help_attr_and_still_reduces_the_chip():
    out = note_shares._reduce_ask_citations(copy.deepcopy(_body()))
    assert _find(out, "askInsert")["attrs"] == WH_ATTRS
    assert _find(out, "askCitation")["attrs"] == {"n": 1}          # control: the reducer ran


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def test_the_PUBLIC_payload_carries_the_writing_help_provenance(db_path):
    from api.services.journal_two import notes
    note = notes.create_note(U, {"title": "Shared", "bodyJson": _body()})
    share = note_shares.create_share(U, note["id"])
    public = note_shares.resolve_share(share["token"])
    assert _find(public["bodyJson"], "askInsert")["attrs"] == WH_ATTRS
    assert _find(public["bodyJson"], "askCitation")["attrs"] == {"n": 1}
