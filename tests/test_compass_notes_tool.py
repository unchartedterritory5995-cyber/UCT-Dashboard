"""Wave 7 lane H (H4) — Compass `search_my_notes`, TEXT CHAT ONLY, DARK.

api/services/journal_two/coach_chat_tools.py: one chat-native entry in TOOLS
that runs `ask_retrieval.retrieve(user_id, query, limit=8)` and projects each
hit through `ask_service.public_source` down to a title, a snippet of at most
400 characters and the note id.

  * ⛔⛔ DARK MEANS ABSENT: with COMPASS_NOTES_TOOL_ENABLED unset the tool is not
    in the registry the model is handed (`coach_chat._build_anthropic_tools_param`),
    `in` / `get` / `[]` all answer "no such tool", and the executor refuses even
    when reached directly — retrieval is never called.
  * ⛔ READ PER CALL: the gate is flipped between two calls in ONE process, with
    no reload, and both the registry and the executor follow it each time.
  * MEMBER-SCOPED: member A never sees member B's note, with the same words in
    both.
  * NEVER A BODY: a result carries exactly five keys and the snippet is <= 400
    characters even when the note is far longer.
  * VOICE IS NOT BUILT (ruling D-H4): neither voice registry names it.
"""
from __future__ import annotations

import importlib
import os
import tempfile
import uuid
from pathlib import Path

import pytest

from api.services.journal_two import coach_chat_tools as cct

GATE = cct.NOTES_TOOL_GATE
A, B = "u-notes-a", "u-notes-b"
REPO = Path(__file__).resolve().parents[1]


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    try:
        os.unlink(tmp.name)
    except OSError:
        pass


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


def _note(user_id: str, title: str, *paras: str):
    from api.services.journal_two import notes
    content = [{"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paras]
    return notes.create_note(user_id, {"title": title,
                                       "bodyJson": {"type": "doc", "content": content}})


def _model_tool_names() -> set[str]:
    from api.services.journal_two import coach_chat
    return {t["name"] for t in coach_chat._build_anthropic_tools_param()}


def _call(user_id: str, query: str) -> dict:
    # Straight to the executor, bypassing the registry: the tool's OWN gate is
    # what this exercises.
    return cct._exec_search_my_notes(user_id=user_id, account_id="acct",
                                     args={"query": query}, conn=None)


# ── dark ─────────────────────────────────────────────────────────────────────

def test_DARK_the_tool_is_absent_from_the_registry_the_model_sees(monkeypatch):
    monkeypatch.delenv(GATE, raising=False)
    names = _model_tool_names()
    # Non-vacuity: the registry the model sees is not empty, and a tool that is
    # always there IS there -- so "absent" below is a finding, not an empty list.
    assert "get_trader_profile" in names
    assert "search_my_notes" not in names
    assert "search_my_notes" not in cct.TOOLS
    assert cct.TOOLS.get("search_my_notes") is None
    assert "search_my_notes" not in set(cct.TOOLS.keys())
    assert "search_my_notes" not in {s["name"] for s in cct.TOOLS.values()}
    assert "search_my_notes" not in dict(cct.TOOLS.items())
    with pytest.raises(KeyError):
        cct.TOOLS["search_my_notes"]


def test_DARK_the_executor_refuses_and_never_retrieves(monkeypatch):
    monkeypatch.delenv(GATE, raising=False)
    from api.services.journal_two import ask_retrieval
    calls = []
    monkeypatch.setattr(ask_retrieval, "retrieve",
                        lambda *a, **k: calls.append((a, k)) or {"evidence": []})
    out = _call(A, "anything at all")
    assert out == {"ok": False, "error": "Searching your notes isn't available right now."}
    assert calls == []


@pytest.mark.parametrize("raw", ["", "0", "false", "off", "no", "   ", "enabled"])
def test_DARK_only_an_on_value_turns_it_on(monkeypatch, raw):
    monkeypatch.setenv(GATE, raw)
    assert cct.notes_tool_enabled() is False
    assert "search_my_notes" not in _model_tool_names()


# ── read per call ────────────────────────────────────────────────────────────

def test_the_gate_is_read_PER_CALL_flipped_between_two_calls_in_one_process(monkeypatch):
    from api.services.journal_two import ask_retrieval
    monkeypatch.setattr(ask_retrieval, "retrieve",
                        lambda *a, **k: {"evidence": [], "no_answer": True})
    monkeypatch.delenv(GATE, raising=False)
    assert "search_my_notes" not in _model_tool_names()
    assert _call(A, "q")["ok"] is False

    monkeypatch.setenv(GATE, "1")
    assert "search_my_notes" in _model_tool_names()
    assert "search_my_notes" in cct.TOOLS
    assert cct.TOOLS["search_my_notes"]["executor"] is cct._exec_search_my_notes
    assert _call(A, "q")["ok"] is True

    monkeypatch.setenv(GATE, "0")
    assert "search_my_notes" not in _model_tool_names()
    assert _call(A, "q")["ok"] is False


def test_the_registry_keeps_behaving_like_the_dict_its_callers_use(monkeypatch):
    """Existing callers do `expected - TOOLS.keys()`, `TOOLS[name]`, iterate
    `.values()`; a gated registry must answer all of those consistently."""
    monkeypatch.setenv(GATE, "1")
    on_keys = set(cct.TOOLS.keys())
    assert "search_my_notes" in on_keys
    assert len(cct.TOOLS) == len(on_keys) == len(list(iter(cct.TOOLS)))
    monkeypatch.delenv(GATE, raising=False)
    off_keys = set(cct.TOOLS.keys())
    assert on_keys - off_keys == {"search_my_notes"}
    assert len(cct.TOOLS) == len(on_keys) - 1
    assert {"get_trader_profile"} - cct.TOOLS.keys() == set()
    assert cct.TOOLS["get_trader_profile"]["name"] == "get_trader_profile"


# ── the retrieval contract ───────────────────────────────────────────────────

def test_it_calls_retrieve_with_limit_8_and_never_hands_it_the_chat_connection(monkeypatch):
    monkeypatch.setenv(GATE, "1")
    from api.services.journal_two import ask_retrieval
    seen = []

    def spy(user_id, query, **kw):
        seen.append((user_id, query, kw))
        return {"evidence": [], "no_answer": True}

    monkeypatch.setattr(ask_retrieval, "retrieve", spy)
    sentinel = object()
    out = cct._exec_search_my_notes(user_id=A, account_id="acct",
                                    args={"query": "  margin pressure  "}, conn=sentinel)
    assert seen == [(A, "margin pressure", {"limit": 8})]
    assert out["ok"] is True and out["results"] == [] and out["no_answer"] is True


def test_the_projection_caps_the_snippet_and_drops_everything_else(monkeypatch):
    """The real retriever already returns a located passage, so a real corpus
    cannot show the cap doing anything (measured: a projection that skipped
    it stayed green on the real-schema test). An evidence item carrying a long
    text, a payload and a location is the only way to see what the tool
    passes through -- and it must pass through five keys and 400 characters."""
    monkeypatch.setenv(GATE, "1")
    from api.services.journal_two import ask_retrieval
    item = {"source_type": "note", "source_id": "n1", "label": "Trade review",
            "text": "x" * 2000, "navigation": {"kind": "note", "note_id": "n1"},
            "location": {"from": 1, "to": 2}, "payload": {"body": "THE WHOLE BODY"},
            "citation_validity": "valid", "stance": None}
    monkeypatch.setattr(ask_retrieval, "retrieve",
                        lambda *a, **k: {"evidence": [item] * 12, "no_answer": False})
    out = _call(A, "review")
    assert out["ok"] is True and out["count"] == 8 == len(out["results"])
    for n, r in enumerate(out["results"], 1):
        assert r == {"n": n, "title": "Trade review", "snippet": "x" * 400,
                     "note_id": "n1", "type": "note"}


def test_an_empty_query_is_refused_without_retrieving(monkeypatch):
    monkeypatch.setenv(GATE, "1")
    from api.services.journal_two import ask_retrieval
    calls = []
    monkeypatch.setattr(ask_retrieval, "retrieve",
                        lambda *a, **k: calls.append(1) or {"evidence": []})
    for args in ({}, {"query": ""}, {"query": "   "}, None):
        out = cct._exec_search_my_notes(user_id=A, account_id="acct", args=args, conn=None)
        assert out["ok"] is False and out["error"]
    assert calls == []


# ── member scope + projection (real retrieval over a real schema) ────────────

def test_member_A_never_sees_member_B_s_note(db_path, monkeypatch):
    monkeypatch.setenv(GATE, "1")
    tok = _tok()
    a = _note(A, "A's plan", f"The {tok} setup is what I keep missing.")
    b = _note(B, "B's plan", f"The {tok} setup is what I keep missing too.")

    got_a = _call(A, tok)
    got_b = _call(B, tok)
    # Non-vacuity: each member's search DOES find something -- so the absence of
    # the other member's note is a scoping result, not an empty search.
    ids_a = {r["note_id"] for r in got_a["results"]}
    ids_b = {r["note_id"] for r in got_b["results"]}
    assert a["id"] in ids_a, got_a
    assert b["id"] in ids_b, got_b
    assert b["id"] not in ids_a
    assert a["id"] not in ids_b


def test_a_result_is_a_title_a_short_snippet_and_an_id_never_a_body(db_path, monkeypatch):
    monkeypatch.setenv(GATE, "1")
    tok = _tok()
    long_para = (f"{tok} " + "the entry was early and the stop was too tight. " * 40).strip()
    assert len(long_para) > 1200
    n = _note(A, "A long review of one trade", long_para, f"Second paragraph about {tok}.")

    got = _call(A, tok)
    assert got["ok"] is True and got["results"], got
    hit = next(r for r in got["results"] if r["note_id"] == n["id"])
    assert set(hit) == {"n", "title", "snippet", "note_id", "type"}
    assert hit["title"]
    assert 0 < len(hit["snippet"]) <= 400
    for r in got["results"]:
        assert len(r["snippet"]) <= 400
        assert long_para not in r["snippet"]


# ── voice is deliberately not built (ruling D-H4) ────────────────────────────

def test_VOICE_does_not_register_it_and_the_docstring_says_why():
    impls = (REPO / "api" / "services" / "voice_tool_impls.py").read_text(encoding="utf-8")
    agents = (REPO / "api" / "services" / "voice_agents.py").read_text(encoding="utf-8")
    # Non-vacuity: these ARE the voice registries -- a tool both surfaces carry
    # is named in them.
    assert "find_patterns_on_ticker" in impls
    assert "find_patterns_on_ticker" in agents
    assert "search_my_notes" not in impls
    assert "search_my_notes" not in agents
    doc = cct._exec_search_my_notes.__doc__ or ""
    assert "D-H4" in doc and "voice" in doc.lower()
