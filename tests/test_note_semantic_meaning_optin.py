"""Wave 7 whole-branch fix round — ruling D-H9: the meaning append is OPT-IN by
request (`meaning=1`).

⚰️ THE DEFECT (the frontend fix round's concern 5). Armed, `GET /notes`
appended meaning rows to ANY 3+ word query, whoever asked. Only FolderSidebar's
search box renders them with a reason line (D-H8); the [[ picker,
AddPositionModal, ThesisSection and Model Book's UPB call the same endpoint and
would show unlabelled rows that match no word the member typed -- and every one
of those requests would spend a vendor embed.

THE RULE. The handler appends only when the request carries `meaning=1`.
Without it the answer is exactly the lexical page and the semantic module is
never reached, armed or not; with it, the gate still decides (unset = no
append at all), and ruling D-H6's bounds still apply. The search box is the one
caller that asks (its hook adds the parameter -- the frontend half, railed in
FolderSidebar.test.jsx and useJ2Notes.meaningOptIn.test.jsx).
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import note_semantic as ns

GATE = ns.SEMANTIC_GATE
U = "u-optin"
NL = "why did I cut my winners early"


@pytest.fixture(autouse=True)
def _fresh():
    ns._paused_until = 0.0
    ns.clear_query_cache()
    yield
    ns._paused_until = 0.0
    ns.clear_query_cache()


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    monkeypatch.setenv("NOTEBOOK_SEMANTIC_PROVIDER", "noop")
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def client(db_path):
    from api.routers import journal_two
    fa = FastAPI()
    fa.include_router(journal_two.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": U, "role": "member"}
    return TestClient(fa)


def P(t):
    return {"type": "paragraph", "content": [{"type": "text", "text": t}]}


def _library(monkeypatch):
    from api.services.journal_two import notes
    monkeypatch.setenv(GATE, "1")
    lexical = notes.create_note(U, {"title": "Winners diary", "bodyJson": {
        "type": "doc", "content": [P("why did I cut my winners early today")]}})
    meaning = notes.create_note(U, {"title": "Selling into strength", "bodyJson": {
        "type": "doc", "content": [P("I cut winners early out of fear again")]}})
    ns.index_member(U)
    return lexical, meaning


def _spy_hook(monkeypatch):
    calls = []
    real = ns.append_meaning_hits

    def spy(*a, **k):
        calls.append(a)
        return real(*a, **k)

    monkeypatch.setattr(ns, "append_meaning_hits", spy)
    return calls


def test_ARMED_without_meaning_1_the_semantic_path_is_never_reached(client, monkeypatch):
    lexical, _ = _library(monkeypatch)
    calls = _spy_hook(monkeypatch)
    embeds = []
    monkeypatch.setattr(ns, "_query_vector", lambda *a, **k: embeds.append(a))
    body = client.get("/api/j2/notes", params={"q": NL}).json()
    assert [n["id"] for n in body["notes"]] == [lexical["id"]]
    assert not any(n.get("matchKind") == "meaning" for n in body["notes"])
    assert calls == [] and embeds == [], "a request that did not ask reached the meaning search"


def test_ARMED_with_meaning_1_the_rows_are_appended(client, monkeypatch):
    lexical, meaning = _library(monkeypatch)
    calls = _spy_hook(monkeypatch)
    body = client.get("/api/j2/notes", params={"q": NL, "meaning": "1"}).json()
    assert [n["id"] for n in body["notes"]] == [lexical["id"], meaning["id"]]
    assert body["notes"][1]["matchKind"] == "meaning"
    assert len(calls) == 1


def test_DARK_with_meaning_1_is_still_exactly_lexical(client, monkeypatch):
    lexical, _ = _library(monkeypatch)
    monkeypatch.delenv(GATE, raising=False)
    embeds = []
    monkeypatch.setattr(ns, "_query_vector", lambda *a, **k: embeds.append(a))
    body = client.get("/api/j2/notes", params={"q": NL, "meaning": "1"}).json()
    assert [n["id"] for n in body["notes"]] == [lexical["id"]] and embeds == []


@pytest.mark.parametrize("value", ["0", "false"])
def test_an_explicit_NO_is_no(client, monkeypatch, value):
    _library(monkeypatch)
    calls = _spy_hook(monkeypatch)
    client.get("/api/j2/notes", params={"q": NL, "meaning": value})
    assert calls == []


def test_the_D_H6_bounds_still_apply_to_an_opted_in_request(client, monkeypatch):
    from api.services import daily_counters as dc
    lexical, _ = _library(monkeypatch)
    monkeypatch.setattr(ns, "_et_day", lambda: "2026-09-25")
    dc.take("2026-09-25", [dc.Charge(ns.SCOPE_QUERY_EMBED, U, ns.QUERY_EMBEDS_PER_MEMBER_PER_DAY)])
    body = client.get("/api/j2/notes", params={"q": NL, "meaning": "1"}).json()
    assert [n["id"] for n in body["notes"]] == [lexical["id"]]
