"""Wave 13 lane 13G-1 -- a call-transcript passage saved into a note as a citable excerpt
(`api/services/journal_two/transcript_capture.py`, `api/routers/notebook_research_capture.py`).

What each section proves:
  * THE GATE: every transcript route answers the one 404 while
    `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED` is off, signed in or not; a paid plan is required.
  * HELD ONLY: quarters and turns come from the FMP transcript cache and the stored index; a
    quarter UCT does not hold refuses honestly, and the index file is never created to find out.
  * THE CITATION: the saved excerpt cites its SOURCE (FMP transcript, the symbol and quarter),
    its DATE (the call date, or a label saying it is not stored) and its POSITION (the speaker
    turn as the page, char offsets and a quote anchor into that turn); the node is in the note;
    the stored words are the source's own characters.
  * THE QUOTE IS ON THE TURN: a passage not on the named turn is refused and nothing is written.
  * REUSE: the excerpt is the ordinary Wave J row -- listed with the note's excerpts, a thesis
    evidence candidate, captured-source (never PDF) kind, purged with the account.
  * NO ALPHAVANTAGE, NO FETCH: the import graph never reaches AlphaVantage (with a CONTROL that
    the walk finds it where it is reachable), and a runtime trap on every AlphaVantage door and
    on the FMP fetchers stays untripped through quarters, read and save.
"""
from __future__ import annotations

import ast
import importlib
import json
import os
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

ROOT = Path(__file__).resolve().parents[1]
FLAG = "NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED"
A, B = "user-tc-a", "user-tc-b"
PAID = {"plan": "pro"}
FREE = {"plan": "free"}

#: Every door to AlphaVantage, the transcript route with its AlphaVantage fallback, and the
#: recap generator (which warms through AlphaVantage transcripts).
FORBIDDEN_MODULES = {
    "api.services.alphavantage_client",
    "api.services.av_transcripts",
    "api.services.call_recap",
    "api.services.call_recap_warmer",
    "api.routers.earnings_intel",
    "api.routers.earnings",
}
MODEL_MODULES = {"anthropic", "openai", "api.services.journal_two.writing_help",
                 "api.services.journal_two.note_ask"}

# A real-shaped FMP content blob: line-anchored speaker turns (fmp_transcripts._segment rung 1).
CONTENT = (
    "Operator: Good afternoon. Welcome to the NVIDIA second quarter call.\n"
    "Colette Kress: Revenue was a record, up 56% year over year. Data center revenue grew\n"
    "sequentially, and gross margin was 72.4%.\n"
    "Jensen Huang: Blackwell demand is extraordinary. We are sold out through next year.\n"
    "Analyst One: Can you talk about supply?\n"
    "Jensen Huang: Supply is improving every quarter.\n"
)


# ── fixtures ────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid, email in ((A, "a@example.com"), (B, "b@example.com")):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, email, "x", uid, "member"))
    conn.commit()
    conn.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _clean_cache():
    from api.services.fmp_transcripts import cache
    cache.delete_prefix("fmp_transcript_")
    yield
    cache.delete_prefix("fmp_transcript_")


@pytest.fixture
def index_db(monkeypatch, tmp_path):
    """Point the stored transcript index at a temp file (absent until a test writes it)."""
    from api.services import transcript_index
    path = tmp_path / "transcript_index.db"
    monkeypatch.setattr(transcript_index, "DB_PATH", str(path))
    monkeypatch.setattr(transcript_index, "_INITED", False)
    return path


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


@pytest.fixture
def app(db_path):
    from api.routers import notebook_research_capture as r
    fa = FastAPI()
    fa.include_router(r.transcripts_router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def as_user(app, user_id: str, plan: dict = PAID) -> None:
    user = {"id": user_id, "role": "member", **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _note(user_id: str, title: str = "NVDA thesis") -> str:
    from api.services.journal_two import notes
    return notes.create_note(user_id, {"title": title, "ticker": "NVDA"})["id"]


def _store(sym="NVDA", year=2026, q=2, date="2026-08-27", content=CONTENT):
    from api.services import transcript_index
    transcript_index.put(sym, year, q, date, content)


def _cache(sym="NVDA", year=2026, q=2, content=CONTENT):
    from api.services import fmp_transcripts
    fmp_transcripts.cache.set(f"fmp_transcript_{sym}_{year}_{q}", {
        "symbol": sym, "quarter": f"{year}Q{q}", "segments": fmp_transcripts._segment(content),
        "resolved": False}, ttl=600)


def _rows(sql, args=()):
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


def _save(client, note_id, *, turn=2, passage="gross margin was 72.4%", quarter="2026Q2", **extra):
    return client.post("/api/j2/research-capture/transcripts/save", json={
        "noteId": note_id, "symbol": "NVDA", "quarter": quarter, "turn": turn,
        "passage": passage, **extra})


# ── the gate ────────────────────────────────────────────────────────────────────────────

ROUTES = [("get", "/api/j2/research-capture/transcripts/NVDA/quarters"),
          ("get", "/api/j2/research-capture/transcripts/NVDA/2026Q2"),
          ("post", "/api/j2/research-capture/transcripts/save")]


@pytest.mark.parametrize("method,path", ROUTES)
def test_every_route_is_404_while_the_gate_is_off_signed_in_or_not(client, app, monkeypatch, method, path):
    monkeypatch.delenv(FLAG, raising=False)
    assert getattr(client, method)(path, **({"json": {}} if method == "post" else {})).status_code == 404
    as_user(app, A)
    assert getattr(client, method)(path, **({"json": {}} if method == "post" else {})).status_code == 404


def test_CONTROL_the_same_route_answers_once_the_gate_is_on(client, app, gate_on, index_db):
    as_user(app, A)
    assert client.get(ROUTES[0][1]).status_code == 200


def test_a_free_plan_is_refused(client, app, gate_on, index_db):
    as_user(app, A, FREE)
    assert client.get(ROUTES[0][1]).status_code == 402


# ── held only ───────────────────────────────────────────────────────────────────────────

def test_quarters_union_the_cache_and_the_store_newest_first(client, app, gate_on, index_db):
    _store(year=2026, q=1, date="2026-05-28")
    _cache(year=2026, q=2)
    as_user(app, A)
    body = client.get("/api/j2/research-capture/transcripts/NVDA/quarters").json()
    assert [(x["quarter"], x["held"], x["callDate"]) for x in body["quarters"]] == [
        ("2026Q2", "cache", None), ("2026Q1", "store", "2026-05-28")]


def test_a_quarter_not_held_refuses_honestly_and_the_index_is_never_created(client, app, gate_on, index_db):
    as_user(app, A)
    r = client.get("/api/j2/research-capture/transcripts/NVDA/2026Q2")
    assert r.status_code == 404 and "does not hold" in r.json()["detail"]
    assert not index_db.exists()
    r = _save(client, _note(A))
    assert r.status_code == 404 and "does not hold" in r.json()["detail"]
    assert _rows("SELECT * FROM j2_note_excerpts") == []


def test_turns_are_numbered_like_the_calendar_panel_and_keep_the_speaker(client, app, gate_on, index_db):
    _store()
    as_user(app, A)
    t = client.get("/api/j2/research-capture/transcripts/NVDA/2026Q2").json()
    assert t["held"] == "store" and t["callDate"] == "2026-08-27" and t["source"] == "FMP transcript"
    from api.services import fmp_transcripts
    segs = fmp_transcripts._segment(CONTENT)
    assert [x["turn"] for x in t["turns"]] == list(range(1, len(segs) + 1))
    assert [x["speaker"] for x in t["turns"]] == [s["speaker"] for s in segs]
    assert t["turns"][1]["text"].startswith("Colette Kress: Revenue was a record")


def test_the_cache_key_is_the_one_the_fmp_service_writes(monkeypatch, index_db):
    """Proved by MOVING THE SOURCE: the cache is filled THROUGH `fmp_transcripts.get_transcript`
    (its fetch stubbed) and read back through this module."""
    from api.services import fmp_transcripts
    from api.services.journal_two import transcript_capture as tc
    monkeypatch.setattr(fmp_transcripts, "_fetch", lambda s, y, q: {"content": CONTENT})
    assert fmp_transcripts.get_transcript("NVDA", "2026Q2") is not None
    t = tc.read_transcript("NVDA", "2026Q2")
    assert t is not None and t["held"] == "cache" and len(t["turns"]) == 5


# ── the citation ────────────────────────────────────────────────────────────────────────

def test_the_saved_excerpt_cites_source_date_and_position(client, app, gate_on, index_db):
    _store()
    note_id = _note(A)
    as_user(app, A)
    r = _save(client, note_id, annotation="margin held up")
    assert r.status_code == 200, r.text
    body = r.json()
    ex = body["excerpt"]
    # SOURCE and DATE are in the cited document's name; POSITION is the page (= the turn).
    assert ex["documentName"] == "NVDA earnings call FY2026 Q2 · 2026-08-27 · FMP transcript"
    assert ex["pageNumber"] == 2 and body["turn"] == 2 and body["speaker"] == "Colette Kress"
    assert ex["capturedText"] == "gross margin was 72.4%"
    page = _rows("SELECT text FROM j2_note_document_pages")[0]["text"]
    assert page[ex["charStart"]:ex["charEnd"]] == ex["capturedText"]
    assert page.endswith(ex["quotePrefix"] + ex["capturedText"] + (ex["quoteSuffix"] or ""))
    assert ex["annotation"] == "margin held up"
    assert ex["sourceKind"] == "web"          # a captured source: never the PDF viewer
    # The node is in the note, and the note's revision came back for the client to land.
    from api.services.journal_two import notes, note_excerpts
    n = notes.get_note(A, note_id)
    assert {"type": "documentExcerpt", "attrs": {"excerptId": ex["id"]}} in n["bodyJson"]["content"]
    assert body["note"] == {"id": note_id, "updatedAt": n["updatedAt"]}
    listed = note_excerpts.list_note_excerpts(A, note_id)
    assert [(e["id"], e["documentName"], e["pageNumber"]) for e in listed] == [
        (ex["id"], ex["documentName"], 2)]


def test_a_call_date_not_held_is_labelled_never_invented(client, app, gate_on, index_db):
    _cache()          # the cache carries no call date
    as_user(app, A)
    ex = _save(client, _note(A)).json()["excerpt"]
    assert ex["documentName"] == "NVDA earnings call FY2026 Q2 · call date not stored · FMP transcript"


def test_whitespace_is_forgiven_and_the_stored_words_are_the_sources(client, app, gate_on, index_db):
    _store()
    as_user(app, A)
    r = _save(client, _note(A), passage="Data   center revenue grew sequentially,")
    assert r.status_code == 200, r.text
    # The member's spacing was forgiven; what is stored is the transcript's own characters,
    # line break included -- never the client's copy of them.
    assert r.json()["excerpt"]["capturedText"] == "Data center revenue grew\nsequentially,"


def test_a_passage_that_is_not_on_the_turn_is_refused_and_nothing_is_written(client, app, gate_on, index_db):
    _store()
    note_id = _note(A)
    as_user(app, A)
    for passage, turn in (("gross margin was 75.0%", 2),            # altered
                          ("Blackwell demand is extraordinary.", 2),  # a real quote, wrong turn
                          ("GROSS MARGIN WAS 72.4%", 2)):             # case is part of a quote
        r = _save(client, note_id, passage=passage, turn=turn)
        assert r.status_code == 422, (passage, r.text)
    assert _rows("SELECT * FROM j2_note_excerpts") == []
    assert _rows("SELECT * FROM j2_note_documents") == []


def test_saving_the_same_passage_twice_is_one_excerpt(client, app, gate_on, index_db):
    _store()
    note_id = _note(A)
    as_user(app, A)
    first = _save(client, note_id).json()
    again = _save(client, note_id).json()
    assert again["deduped"] is True and again["excerpt"]["id"] == first["excerpt"]["id"]
    second_turn = _save(client, note_id, turn=3, passage="We are sold out through next year.").json()
    assert second_turn["document"]["id"] == first["document"]["id"]     # one document per quarter
    assert len(_rows("SELECT * FROM j2_note_documents")) == 1
    assert [r["page_number"] for r in _rows("SELECT page_number FROM j2_note_document_pages ORDER BY 1")] == [2, 3]
    from api.services.journal_two import notes
    body = notes.get_note(A, note_id)["bodyJson"]["content"]
    assert sum(1 for n in body if n.get("type") == "documentExcerpt") == 2


def test_a_locked_note_refuses_and_leaves_nothing_behind(client, app, gate_on, index_db):
    _store()
    note_id = _note(A)
    from api.services import auth_db
    c = auth_db.get_connection()
    c.execute("UPDATE j2_notes SET locked = 1 WHERE id = ?", (note_id,))
    c.commit()
    c.close()
    as_user(app, A)
    r = _save(client, note_id)
    assert r.status_code == 423, r.text
    assert _rows("SELECT * FROM j2_note_excerpts") == []
    assert _rows("SELECT * FROM j2_note_document_pages") == []
    assert _rows("SELECT * FROM j2_note_documents") == []


def test_another_members_note_is_not_found(client, app, gate_on, index_db):
    _store()
    theirs = _note(B)
    as_user(app, A)
    r = _save(client, theirs)
    assert r.status_code == 404
    assert _rows("SELECT * FROM j2_note_excerpts") == []


def test_the_excerpt_is_a_thesis_evidence_candidate(client, app, gate_on, index_db):
    _store()
    note_id = _note(A)
    as_user(app, A)
    ex = _save(client, note_id).json()["excerpt"]
    from api.services.journal_two import evidence_candidates
    cands = evidence_candidates.list_candidates(A, note_id)
    assert any(c.get("targetId") == ex["id"] or c.get("id") == ex["id"] for c in cands), cands


def test_the_account_purge_takes_the_transcript_excerpt(client, app, gate_on, index_db):
    _store()
    note_id = _note(A)
    keep = _note(B)
    as_user(app, A)
    assert _save(client, note_id).status_code == 200
    as_user(app, B)
    assert _save(client, keep).status_code == 200
    from api.services import auth_db
    from api.services.journal_two import account_purge
    c = auth_db.get_connection()
    try:
        report = account_purge.purge_user_data(A, c)
        assert report["ok"] is True, report
    finally:
        c.close()
    for table in ("j2_note_excerpts", "j2_note_documents", "j2_note_document_pages"):
        assert {r["user_id"] for r in _rows(f"SELECT user_id FROM {table}")} == {B}, table


# ── no AlphaVantage, no fetch ───────────────────────────────────────────────────────────

def _module_path(mod: str) -> Path | None:
    p = ROOT / (mod.replace(".", "/") + ".py")
    if p.exists():
        return p
    p = ROOT / mod.replace(".", "/") / "__init__.py"
    return p if p.exists() else None


def _imports_of(mod: str) -> set[str]:
    """Every module `mod` imports, at module level OR inside a function -- an AST walk."""
    path = _module_path(mod)
    if not path:
        return set()
    tree = ast.parse(path.read_text(encoding="utf-8"))
    pkg = mod if path.name == "__init__.py" else mod.rsplit(".", 1)[0]
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                out.add(a.name)
        elif isinstance(n, ast.ImportFrom):
            base = n.module or ""
            if n.level:
                parts = pkg.split(".")[: len(pkg.split(".")) - (n.level - 1)]
                base = ".".join(parts + ([base] if base else []))
            out.add(base)
            for a in n.names:
                if _module_path(f"{base}.{a.name}"):
                    out.add(f"{base}.{a.name}")
    return out


def _reach(start: list[str]) -> set[str]:
    seen: set[str] = set()
    stack = list(start)
    while stack:
        m = stack.pop()
        if m in seen:
            continue
        seen.add(m)
        stack.extend(x for x in _imports_of(m) if x.startswith("api") and _module_path(x))
    return seen


CAPTURE_MODULES = ["api.services.journal_two.transcript_capture", "api.routers.notebook_research_capture"]


def test_the_import_graph_never_reaches_alphavantage():
    reached = _reach(CAPTURE_MODULES)
    # non-vacuity: the walk follows function-level imports into what the module reuses
    assert {"api.services.fmp_transcripts", "api.services.transcript_index",
            "api.services.journal_two.note_excerpts", "api.services.journal_two.notes",
            "api.services.journal_two.web_capture"} <= reached
    assert not reached & FORBIDDEN_MODULES, sorted(reached & FORBIDDEN_MODULES)


def test_CONTROL_the_walk_finds_alphavantage_where_it_is_reachable():
    reached = _reach(["api.routers.earnings_intel"])
    assert {"api.services.av_transcripts", "api.services.alphavantage_client"} <= reached


def test_the_capture_modules_import_no_model_client_directly():
    for mod in CAPTURE_MODULES:
        assert not _imports_of(mod) & MODEL_MODULES


def test_nothing_is_fetched_at_runtime_through_quarters_read_and_save(client, app, gate_on, index_db, monkeypatch):
    """Every AlphaVantage door AND the FMP fetchers are trapped; quarters, read and save run
    both with nothing held (the path where a fetching reader would reach out) and with a
    stored transcript."""
    tripped: list[str] = []

    def trap(name):
        def _t(*a, **k):
            tripped.append(name)
            raise AssertionError(f"{name} was reached")
        return _t

    from api.services import alphavantage_client, av_transcripts, fmp_transcripts
    for name in ("av_get", "av_get_status", "av_take_token"):
        monkeypatch.setattr(alphavantage_client, name, trap(f"alphavantage_client.{name}"))
    monkeypatch.setattr(av_transcripts, "get_transcript", trap("av_transcripts.get_transcript"))
    for name in ("get_transcript", "list_quarters", "_fetch", "_available"):
        monkeypatch.setattr(fmp_transcripts, name, trap(f"fmp_transcripts.{name}"))
    import requests
    real_request = requests.Session.request

    def guarded(self, method, url, *a, **k):
        tripped.append(f"HTTP {url}")
        raise AssertionError("an HTTP request was made")
    monkeypatch.setattr(requests.Session, "request", guarded)

    note_id = _note(A)
    as_user(app, A)
    client.get("/api/j2/research-capture/transcripts/NVDA/quarters")
    client.get("/api/j2/research-capture/transcripts/NVDA/2026Q2")
    _save(client, note_id)
    _store()
    client.get("/api/j2/research-capture/transcripts/NVDA/quarters")
    client.get("/api/j2/research-capture/transcripts/NVDA/2026Q2")
    assert _save(client, note_id).status_code == 200
    assert tripped == []
    monkeypatch.setattr(requests.Session, "request", real_request)


def test_CONTROL_the_trap_fires_when_a_fetching_reader_is_called(monkeypatch):
    """The runtime rail can fail: the fetching reader, called, trips the same trap."""
    tripped = []
    from api.services import fmp_transcripts
    monkeypatch.setattr(fmp_transcripts, "_fetch", lambda *a, **k: tripped.append("fetch") or None)
    monkeypatch.setattr(fmp_transcripts, "list_quarters", lambda t: [{"year": 2026, "q": 2}])
    fmp_transcripts.get_transcript("ZZZZ", "2026Q2")
    assert tripped == ["fetch"]
