"""Wave 7 lane H, fix round 1 -- review I-1 (and M-5): meaning search on
`GET /notes` is BOUNDED and FAILS OPEN.

⚰️ THE DEFECT. `search()` fetched every vector the member had and scored each
in pure Python on the web pod's one shared anyio pool (0.106-0.124 ms per
block: 5.3-6.2 s at 50k blocks, 127 MB at 20k); the query embedding rode the
shared client's 120 s ceiling; and nothing caught a vendor failure, so an
OpenAI 429 or outage turned every 3+-token Notebook search into a 500.

THE RULES, each railed here:
  * the scan covers only notes that could still be APPENDED -- active (not
    trashed, not archived), not already on the lexical page -- newest first,
    at most `MAX_SEARCH_BLOCKS` blocks;
  * the query embed carries its own short ceiling (`query_embed_timeout()`,
    default 2 s, no retries);
  * ANY failure serves the lexical page unchanged, logs ONE line naming the
    failure's class (never the query), and pauses meaning search so an outage
    costs one wait a minute, not one per keystroke;
  * M-5: appended rows never take the page past the `limit` it asked for.
"""
from __future__ import annotations

import importlib
import logging
import os
import tempfile
from types import SimpleNamespace

import pytest

from api.services.journal_two import note_semantic as ns

GATE = ns.SEMANTIC_GATE
U = "u-bounds"
NL = "why did I cut my winners early"          # a SEMANTIC-shaped query


@pytest.fixture(autouse=True)
def _unpaused():
    # ...and no query vector left over from another test (ruling D-H6's cache:
    # a provider stand-in with the no-op's name would otherwise HIT a vector
    # another test cached and never reach the failure it exists to raise).
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
    monkeypatch.setenv(GATE, "1")
    monkeypatch.setenv("NOTEBOOK_SEMANTIC_PROVIDER", "noop")
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def P(t):
    return {"type": "paragraph", "content": [{"type": "text", "text": t}]}


def _note(title, *paras):
    from api.services.journal_two import notes
    return notes.create_note(U, {"title": title, "bodyJson": {
        "type": "doc", "content": [P(t) for t in paras]}})


def _sql(stmt, *params):
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        c.execute(stmt, params)
        c.commit()
    finally:
        c.close()


def _spy_scored(monkeypatch):
    """Every block `search` actually scored: its note id, one entry per block."""
    scored: list[list[str]] = []
    real = ns._score

    def spy(qv, note_ids, mat):
        assert mat is not None and len(mat) == len(note_ids)
        scored.append(list(note_ids))
        return real(qv, note_ids, mat)

    monkeypatch.setattr(ns, "_score", spy)
    return scored


# ── the bound ────────────────────────────────────────────────────────────────

def test_the_scan_is_CAPPED_per_member_and_takes_the_NEWEST_notes(db_path, monkeypatch):
    made = [_note(f"Winners note {i}", f"I cut winners early, entry {i}.", f"Fear again, day {i}.")
            for i in range(10)]
    ns.index_member(U)
    for i, n in enumerate(made):
        _sql("UPDATE j2_notes SET updated_at = ? WHERE id = ?", f"2026-01-{i + 1:02d}T00:00:00Z", n["id"])
    monkeypatch.setattr(ns, "MAX_SEARCH_BLOCKS", 5)
    scored = _spy_scored(monkeypatch)
    ns.search(U, NL)
    assert scored and len(scored[0]) == 5, f"scored {len(scored[0]) if scored else 0} blocks past a cap of 5"
    assert set(scored[0]) <= {made[9]["id"], made[8]["id"]}, "the cap must keep the NEWEST notes"


def test_the_scan_never_reads_a_note_that_cannot_be_appended(db_path, monkeypatch):
    """Trashed and archived notes (their vectors linger until the next sweep)
    and the notes already on the lexical page are never scored."""
    from api.services.journal_two import notes
    on_page = _note("On the page", "I cut winners early.")
    trashed = _note("Trashed", "I cut winners early too.")
    archived = _note("Archived", "Cut winners early, again.")
    free = _note("Free", "I sold into strength, fearful.")
    ns.index_member(U)
    notes.delete_note(U, trashed["id"])
    _sql("UPDATE j2_notes SET archived_at = '2026-09-25T00:00:00Z' WHERE id = ?", archived["id"])
    scored = _spy_scored(monkeypatch)
    ns.search(U, NL, exclude_note_ids={on_page["id"]})
    assert scored, "non-vacuity: nothing was scored at all"
    assert set(scored[0]) == {free["id"]}


def test_a_block_from_ANOTHER_provider_is_skipped_never_compared(db_path, monkeypatch):
    """Mid provider-switch the index holds two widths. The newest block sets the
    width (the sweep revisits newest first); an older block of another width is
    skipped, not forced into the matrix, and the search still answers."""
    old = _note("Older", "I cut winners early out of fear.")
    new = _note("Newer", "I cut my winners early again.")
    ns.index_member(U)
    _sql("UPDATE j2_notes SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ?", old["id"])
    _sql("UPDATE j2_notes SET updated_at = '2026-02-01T00:00:00Z' WHERE id = ?", new["id"])
    _sql("UPDATE j2_note_embeddings SET vector = ? WHERE note_id = ?", ns._encode([1.0, 0.0, 0.0]), old["id"])
    scored = _spy_scored(monkeypatch)
    hits = ns.search(U, NL)
    assert scored and set(scored[0]) == {new["id"]}
    assert [h["note_id"] for h in hits] == [new["id"]]


def test_the_candidate_read_STOPS_at_its_limit_instead_of_sorting_every_vector(db_path):
    """The bound is only a bound if SQLite honours it early: the plan must walk
    the member's live notes newest-first on an index and never sort in a temp
    B-tree (which reads EVERY candidate's vector before the LIMIT applies --
    1,337 ms vs 30 ms at 50k stored blocks). Plans are chosen from the schema,
    not the row count, so this small database answers for the large one."""
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        ns.ensure_semantic_schema(c)
        plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + ns._CANDIDATES_SQL, (U, "[]", 10))]
    finally:
        c.close()
    assert plan, "non-vacuity: EXPLAIN returned nothing"
    assert not any("TEMP B-TREE" in step for step in plan), plan
    assert plan[0].startswith("SEARCH n USING"), f"the walk must start from the member's notes: {plan}"


def test_the_query_embed_carries_the_SHORT_timeout_and_no_retries(db_path, monkeypatch):
    _note("Winners", "I cut my winners early out of fear.")
    ns.index_member(U)                                   # 256-dim vectors, noop provider
    monkeypatch.delenv("NOTEBOOK_SEMANTIC_PROVIDER", raising=False)   # the default: OpenAI
    from api.services import voice_openai
    options = []

    class Client:
        def with_options(self, **kw):
            options.append(kw)
            return self

        embeddings = SimpleNamespace(create=lambda *, model, input: SimpleNamespace(
            data=[SimpleNamespace(index=0, embedding=[1.0] * 256)]))

    monkeypatch.setattr(voice_openai, "_get_client", lambda: Client())
    ns.search(U, NL)
    assert options == [{"timeout": ns.QUERY_EMBED_TIMEOUT_S, "max_retries": 0}]
    assert ns.QUERY_EMBED_TIMEOUT_S == 2.0, "the stated ceiling moved; say why in the ruling"
    monkeypatch.setenv("NOTEBOOK_SEMANTIC_QUERY_TIMEOUT_SECS", "0.5")
    ns.clear_query_cache()          # the same query again would be a cache hit (D-H6)
    ns.search(U, NL)
    assert options[-1] == {"timeout": 0.5, "max_retries": 0}


# ── failing open ─────────────────────────────────────────────────────────────

def _failing_provider(exc):
    class Failing(ns.NoOpEmbeddingProvider):
        def embed(self, texts, *, timeout=None):
            raise exc
    return Failing()


def _vendor_errors():
    import httpx
    import openai
    req = httpx.Request("POST", "https://api.openai.com/v1/embeddings")
    return [
        pytest.param(openai.APITimeoutError(request=req), id="APITimeoutError"),
        pytest.param(openai.APIConnectionError(request=req), id="APIConnectionError"),
        pytest.param(TimeoutError("read timed out"), id="TimeoutError"),
        pytest.param(RuntimeError("OPENAI_API_KEY is not set"), id="RuntimeError"),
    ]


@pytest.mark.parametrize("exc", _vendor_errors())
def test_a_vendor_failure_serves_the_lexical_page_UNCHANGED(db_path, monkeypatch, exc):
    lexical = _note("Winners diary", "why did I cut my winners early today")
    _note("Selling into strength", "I cut winners early out of fear again")
    ns.index_member(U)
    monkeypatch.setattr(ns, "get_provider", lambda: _failing_provider(exc))
    rows = [{"id": lexical["id"], "title": "Winners diary"}]
    out = ns.append_meaning_hits(U, NL, rows, total=1, offset=0, only_query=True)
    assert out is rows


def test_a_DATABASE_failure_on_the_meaning_read_also_fails_open(db_path, monkeypatch):
    import sqlite3

    def boom(*a, **k):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(ns, "search", boom)
    rows = [{"id": "a"}]
    assert ns.append_meaning_hits(U, NL, rows, total=1, offset=0, only_query=True) is rows


def test_the_REAL_handler_answers_with_the_lexical_notes_when_the_vendor_is_down(db_path, monkeypatch):
    """Never a 500: the route itself, provider failing."""
    import openai
    import httpx
    from api.routers import journal_two as router
    lexical = _note("Winners diary", "why did I cut my winners early today")
    _note("Selling into strength", "I cut winners early out of fear again")
    ns.index_member(U)
    err = openai.APITimeoutError(request=httpx.Request("POST", "https://api.openai.com/v1/embeddings"))
    monkeypatch.setattr(ns, "get_provider", lambda: _failing_provider(err))
    body = router.list_notes_endpoint(
        folder_id=None, tag=None, ticker=None, q=NL, embed_symbol=None,
        embed_widget=None, sort="updated", limit=100, offset=0, deleted=False,
        dateFrom=None, dateTo=None, sector=None, theme=None, savedViewId=None,
        propertyFilter=None, propertySort=None, meaning=True, user={"id": U})
    assert [n["id"] for n in body["notes"]] == [lexical["id"]]
    assert body["total"] == 1


def test_a_failure_logs_ONCE_without_the_query_and_PAUSES_meaning_search(db_path, monkeypatch, caplog):
    _note("Winners diary", "why did I cut my winners early today")
    ns.index_member(U)
    clock = [1000.0]
    monkeypatch.setattr(ns, "_now", lambda: clock[0])
    calls = []

    def failing_search(*a, **k):
        calls.append(1)
        raise TimeoutError("vendor slow")

    monkeypatch.setattr(ns, "search", failing_search)
    rows = [{"id": "x"}]
    caplog.set_level(logging.WARNING, logger=ns.log.name)
    for _ in range(5):                                     # a member typing through an outage
        assert ns.append_meaning_hits(U, NL, rows, total=1, offset=0, only_query=True) is rows
    warnings = [r for r in caplog.records if r.name == ns.log.name]
    assert len(calls) == 1, f"{len(calls)} vendor attempts inside one pause window"
    assert len(warnings) == 1, f"{len(warnings)} log lines for one outage"
    msg = warnings[0].getMessage()
    assert "TimeoutError" in msg
    assert "winners" not in msg.lower() and "vendor slow" not in msg, "member or provider text in the log"
    clock[0] += ns.PAUSE_AFTER_FAILURE_S + 1                # the window passes
    ns.append_meaning_hits(U, NL, rows, total=1, offset=0, only_query=True)
    assert len(calls) == 2, "meaning search never came back after the pause"


def test_two_requests_that_fail_INSIDE_one_window_log_once(monkeypatch, caplog):
    """Both were already past the pause check when the vendor failed (two
    members typing at once): the second failure extends the pause and says
    nothing -- the `already` branch the sequential rail above cannot reach."""
    monkeypatch.setattr(ns, "_now", lambda: 5000.0)
    caplog.set_level(logging.WARNING, logger=ns.log.name)
    ns._fail_open(TimeoutError())
    ns._fail_open(TimeoutError())
    assert len([r for r in caplog.records if r.name == ns.log.name]) == 1
    assert ns.meaning_paused()


def test_CONTROL_healthy_meaning_search_still_appends(db_path):
    """Non-vacuity for everything above: with a working provider the same
    setup DOES append, so 'unchanged' above is the fallback, not a no-op."""
    lexical = _note("Winners diary", "why did I cut my winners early today")
    meaning = _note("Selling into strength", "I cut winners early out of fear again")
    ns.index_member(U)
    rows = [{"id": lexical["id"], "title": "Winners diary"}]
    out = ns.append_meaning_hits(U, NL, rows, total=1, offset=0, only_query=True)
    assert [r["id"] for r in out] == [lexical["id"], meaning["id"]]


# ── M-5: never past the page size ────────────────────────────────────────────

def test_meaning_hits_never_take_the_page_past_its_limit(db_path, monkeypatch):
    lexical = _note("Winners diary", "why did I cut my winners early today")
    for i in range(4):
        _note(f"Selling {i}", f"I cut winners early out of fear, time {i}")
    ns.index_member(U)
    rows = [{"id": lexical["id"]}]
    assert len(ns.append_meaning_hits(U, NL, rows, total=1, offset=0, only_query=True, limit=3)) == 3
    called = []
    monkeypatch.setattr(ns, "search", lambda *a, **k: called.append(1) or [])
    assert ns.append_meaning_hits(U, NL, rows, total=1, offset=0, only_query=True, limit=1) is rows
    assert called == [], "a full page still asked the vendor"


def test_the_HANDLER_passes_its_limit_to_the_hook(db_path):
    from api.routers import journal_two as router
    _note("Winners diary", "why did I cut my winners early today")
    for i in range(4):
        _note(f"Selling {i}", f"I cut winners early out of fear, time {i}")
    ns.index_member(U)
    body = router.list_notes_endpoint(
        folder_id=None, tag=None, ticker=None, q=NL, embed_symbol=None,
        embed_widget=None, sort="updated", limit=2, offset=0, deleted=False,
        dateFrom=None, dateTo=None, sector=None, theme=None, savedViewId=None,
        propertyFilter=None, propertySort=None, meaning=True, user={"id": U})
    assert len(body["notes"]) == 2
    assert body["notes"][1].get("matchKind") == "meaning"      # non-vacuity: it did append
