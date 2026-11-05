"""Wave 7 lane H (H3) — meaning search over a member's notes, DARK.

api/services/journal_two/note_semantic.py and its one hook in `GET /notes`.

  * ⛔⛔ DARK MEANS NOTHING MOVES: with NOTEBOOK_SEMANTIC_SEARCH_ENABLED unset, a
    spy on the OpenAI client (and on the provider class itself, and on every
    socket connect) records ZERO calls across index + search + sweep + the
    hook — and the index table is never even created.
  * ON, with the NO-OP provider: the table fills, and nothing leaves the process
    (the socket guard would fail the test on any connect).
  * Incremental by content hash; a trashed note leaves the index; an inserted
    answer is not the member's writing and is not indexed; member-scoped.
  * QUERY-SHAPE ROUTING (ruling D-H3): <=2 tokens, a quoted phrase, or a
    ticker-shaped token -> lexical only and `search()` is NEVER called.
  * THE PLAN RAIL: with the flag unset the `GET /notes` handler runs EXACTLY
    the statements `list_and_count_notes` runs -- byte-identical SQL, no extra
    statement -- which is lane I's plan rail's subject, untouched.
"""
from __future__ import annotations

import importlib
import os
import socket
import sqlite3
import tempfile

import pytest

from api.services.journal_two import note_semantic as ns

GATE = ns.SEMANTIC_GATE
U, OTHER = "u-sem", "u-other"


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


class _NoNetwork(Exception):
    pass


@pytest.fixture
def no_network(monkeypatch):
    """Any socket connect fails the test: 'nothing leaves the process', measured."""
    attempts = []

    def refuse(self, *a, **k):
        attempts.append(a)
        raise _NoNetwork(f"a socket connect was attempted: {a!r}")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    return attempts


@pytest.fixture
def vendor_spy(monkeypatch):
    """Every door to OpenAI's embeddings, counted: the client, the provider
    class, and the embeddings helper it would call."""
    calls = {"client": 0, "provider": 0, "embed_text": 0}
    from api.services import voice_openai, voice_embeddings_service as ves

    def client(*a, **k):
        calls["client"] += 1
        raise AssertionError("the OpenAI client was constructed")

    def embed_text(*a, **k):
        calls["embed_text"] += 1
        raise AssertionError("voice_embeddings_service.embed_text was called")

    real_init = ns.OpenAIEmbeddingProvider.__init__

    def provider_init(self, *a, **k):
        calls["provider"] += 1
        real_init(self)

    monkeypatch.setattr(voice_openai, "_get_client", client)
    monkeypatch.setattr(ves, "embed_text", embed_text)
    monkeypatch.setattr(ns.OpenAIEmbeddingProvider, "__init__", provider_init)
    return calls


@pytest.fixture
def on_noop(monkeypatch):
    monkeypatch.setenv(GATE, "1")
    monkeypatch.setenv("NOTEBOOK_SEMANTIC_PROVIDER", "noop")


@pytest.fixture(autouse=True)
def _no_cached_query_vectors():
    """Ruling D-H6 caches query vectors per (member, provider, query) for ten
    minutes; each test starts and ends without any."""
    ns.clear_query_cache()
    if hasattr(ns, "clear_pending_cache"):
        ns.clear_pending_cache()
    yield
    ns.clear_query_cache()
    if hasattr(ns, "clear_pending_cache"):
        ns.clear_pending_cache()


def P(t):
    return {"type": "paragraph", "content": [{"type": "text", "text": t}]}


def _note(user_id, title, *paras, extra=None):
    from api.services.journal_two import notes
    content = [P(t) for t in paras] + list(extra or [])
    return notes.create_note(user_id, {"title": title, "bodyJson": {"type": "doc", "content": content}})


def _rows(user_id=None):
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        if not c.execute("SELECT 1 FROM sqlite_master WHERE name='j2_note_embeddings'").fetchone():
            return None
        q = "SELECT user_id, note_id, block_id FROM j2_note_embeddings"
        return [tuple(r) for r in (c.execute(q + " WHERE user_id = ?", (user_id,)) if user_id else c.execute(q))]
    finally:
        c.close()


# ── dark ─────────────────────────────────────────────────────────────────────

def test_DARK_nothing_is_embedded_sent_or_even_created(db_path, monkeypatch, vendor_spy, no_network):
    monkeypatch.delenv(GATE, raising=False)
    monkeypatch.setenv("NOTEBOOK_SEMANTIC_PROVIDER", "openai")
    _note(U, "Selling winners early", "I sold NVDA into strength again.")
    assert ns.index_member(U) == {"skipped": "dark"}
    assert ns.search(U, "why did I sell winners early") == []
    assert ns.run_sweep() == {"skipped": "dark"}
    ns.sweep_job()
    rows = [{"id": "x"}]
    searched = []
    monkeypatch.setattr(ns, "search", lambda *a, **k: searched.append(a) or [])
    assert ns.append_meaning_hits(U, "why did I sell winners early", rows,
                                  total=1, offset=0, only_query=True) is rows
    assert searched == [], "the hook asked for meaning hits while dark"
    assert ns.get_provider() is None
    assert vendor_spy == {"client": 0, "provider": 0, "embed_text": 0}
    assert no_network == []
    assert _rows() is None, "the index table exists: something touched the database while dark"


@pytest.mark.parametrize("raw", ["0", "false", "off", "", "flase", "enabled"])
def test_every_off_value_and_every_typo_is_dark(monkeypatch, raw):
    monkeypatch.setenv(GATE, raw)
    assert ns.semantic_enabled() is False
    assert ns.get_provider() is None


def test_the_gate_is_read_per_call_never_captured(monkeypatch):
    monkeypatch.delenv(GATE, raising=False)
    assert ns.semantic_enabled() is False
    monkeypatch.setenv(GATE, "1")
    assert ns.semantic_enabled() is True
    src = open(ns.__file__, encoding="utf-8").read().split("\n")
    # Tests shard M-7: both spellings (a module-level `os.getenv(...)` passed the
    # `os.environ`-only scan), and a CONTROL that the scan saw a read at all --
    # a scan that finds nothing proves nothing.
    reads = [(i, line) for i, line in enumerate(src) if "os.environ" in line or "getenv" in line]
    assert reads, "non-vacuity: the scan saw no environment read in note_semantic.py"
    for i, line in reads:
        assert line.startswith((" ", "\t")), f"note_semantic.py:{i + 1} reads the env at import"


# ── on, with the no-op provider ──────────────────────────────────────────────

def test_ON_with_the_NOOP_provider_the_table_fills_and_nothing_leaves(db_path, on_noop, vendor_spy, no_network):
    n = _note(U, "Selling winners early", "I sold NVDA into strength again.", "Next time trail the stop.")
    r = ns.index_member(U)
    assert r["indexed"] == 1 and r["embedded"] == 3            # title + two blocks
    got = _rows(U)
    assert len(got) == 3 and {row[1] for row in got} == {n["id"]}
    assert vendor_spy == {"client": 0, "provider": 0, "embed_text": 0}
    assert no_network == []


def test_the_OpenAI_provider_is_the_default_and_uses_the_shared_client(db_path, monkeypatch):
    """The existing client (`voice_openai._get_client`), one request for the
    batch (fix round 1, review I-2 -- the per-block `embed_text` loop is gone;
    `test_note_semantic_sweep_lock.py` rails the batching itself)."""
    monkeypatch.setenv(GATE, "1")
    monkeypatch.delenv("NOTEBOOK_SEMANTIC_PROVIDER", raising=False)
    p = ns.get_provider()
    assert isinstance(p, ns.OpenAIEmbeddingProvider)
    from types import SimpleNamespace
    from api.services import voice_openai
    sent = []

    def create(*, model, input):
        sent.append(list(input))
        return SimpleNamespace(data=[SimpleNamespace(index=i, embedding=[0.5, 0.5])
                                     for i in range(len(input))])

    monkeypatch.setattr(voice_openai, "_get_client",
                        lambda: SimpleNamespace(embeddings=SimpleNamespace(create=create)))
    assert p.embed(["a", "b"]) == [[0.5, 0.5], [0.5, 0.5]]
    assert sent == [["a", "b"]]


def test_incremental_unchanged_notes_cost_nothing_and_an_edit_reembeds_only_what_moved(db_path, on_noop):
    from api.services.journal_two import notes
    n = _note(U, "Plan", "Alpha paragraph.", "Beta paragraph.")
    ns.index_member(U)
    again = ns.index_member(U)
    assert again["unchanged"] == 1 and again["embedded"] == 0
    notes.update_note(U, n["id"], {"bodyJson": {"type": "doc", "content": [
        P("Alpha paragraph."), P("Gamma paragraph.")]}})
    third = ns.index_member(U)
    assert third["embedded"] == 1, "only the changed block is re-embedded"
    assert third["reused"] == 2                                   # title + Alpha
    texts_left = {row[2] for row in _rows(U)}
    assert len(texts_left) == 3                                  # Beta's row is gone


def test_a_trashed_note_leaves_the_index(db_path, on_noop):
    from api.services.journal_two import notes
    keep = _note(U, "Keep", "kept words here")
    gone = _note(U, "Gone", "trashed words here")
    ns.index_member(U)
    notes.delete_note(U, gone["id"])
    r = ns.index_member(U)
    assert r["dropped"] >= 1
    assert {row[1] for row in _rows(U)} == {keep["id"]}


def test_an_inserted_answer_is_not_the_members_writing_and_is_not_indexed(db_path, on_noop):
    answer = {"type": "askInsert", "attrs": {"action": "rewrite", "model": "m"},
              "content": [P("Compass wrote this paragraph.")]}
    _note(U, "Mine", "My own paragraph.", extra=[answer])
    ns.index_member(U)
    blocks = ns.note_blocks("Mine", {"type": "doc", "content": [P("My own paragraph."), answer]})
    assert [b["text"] for b in blocks] == ["Mine", "My own paragraph."]
    assert len(_rows(U)) == 2


def test_a_provider_switch_reembeds_instead_of_mixing_two_vector_spaces(db_path, on_noop, monkeypatch):
    """With NO edit to the note (fix round 1): the revision marker names the
    provider, so a switch revisits every note by itself. ⚰️ This test used to
    force the revisit by hand, which hid that the sweep never would -- the
    note stayed on the old provider's vectors, unreadable by the new one."""
    _note(U, "Plan", "Alpha paragraph.")
    ns.index_member(U)

    class Other(ns.NoOpEmbeddingProvider):
        name = "noop:other"

    r = ns.index_member(U, provider=Other())
    assert r["embedded"] == 2 and r["reused"] == 0
    assert ns.index_member(U, provider=Other())["unchanged"] == 1     # and then it settles


def test_search_is_member_scoped_and_ranked(db_path, on_noop):
    mine = _note(U, "Cutting winners", "I sold my winners too early out of fear.")
    _note(U, "Earnings calendar", "AMD reports Tuesday after the close.")
    theirs = _note(OTHER, "Cutting winners", "I sold my winners too early out of fear.")
    ns.index_member(U)
    ns.index_member(OTHER)
    hits = ns.search(U, "sold winners too early fear")
    assert hits and hits[0]["note_id"] == mine["id"]
    assert theirs["id"] not in {h["note_id"] for h in hits}


# ── query-shape routing (ruling D-H3) ────────────────────────────────────────

@pytest.mark.parametrize("q,shape", [
    ("", ns.LEXICAL),
    ("breakout", ns.LEXICAL),
    ("failed breakout", ns.LEXICAL),                         # <= 2 tokens
    ('"failed breakout" lessons learned', ns.LEXICAL),       # a quoted phrase
    ("“failed breakout” lessons learned", ns.LEXICAL),
    ("why did I sell $NVDA early", ns.LEXICAL),               # cashtag
    ("why did I sell NVDA early", ns.LEXICAL),                # ticker-shaped
    ("notes about BRK.B dividend", ns.LEXICAL),
    ("why did I cut my winners early", ns.SEMANTIC),         # 'I' alone is not a ticker
    ("what went wrong with my entries", ns.SEMANTIC),
])
def test_query_shape(q, shape):
    assert ns.query_shape(q) == shape


def _spy_search(monkeypatch):
    calls = []
    real = ns.search

    def spy(*a, **k):
        calls.append(a)
        return real(*a, **k)

    monkeypatch.setattr(ns, "search", spy)
    return calls


def test_a_TICKER_query_never_calls_search(db_path, on_noop, monkeypatch):
    calls = _spy_search(monkeypatch)
    rows = []
    for q in ("why did I sell NVDA early", "why did I sell $NVDA early", "NVDA", '"sold early" again today'):
        assert ns.append_meaning_hits(U, q, rows, total=0, offset=0, only_query=True) is rows
    assert calls == []


def test_another_filter_a_later_page_or_a_multi_page_answer_leaves_the_page_untouched(db_path, on_noop, monkeypatch):
    calls = _spy_search(monkeypatch)
    q = "why did I cut my winners early"
    rows = [{"id": "a"}]
    assert ns.append_meaning_hits(U, q, rows, total=1, offset=0, only_query=False) is rows
    assert ns.append_meaning_hits(U, q, rows, total=1, offset=100, only_query=True) is rows
    assert ns.append_meaning_hits(U, q, rows, total=250, offset=0, only_query=True) is rows
    assert calls == []


def test_meaning_hits_are_APPENDED_after_the_lexical_list_and_deduped(db_path, on_noop):
    lexical = _note(U, "Winners diary", "why did I cut my winners early today")
    meaning = _note(U, "Selling into strength", "I cut winners early out of fear again")
    ns.index_member(U)
    rows = [{"id": lexical["id"], "title": "Winners diary"}]
    out = ns.append_meaning_hits(U, "why did I cut my winners early", rows,
                                 total=1, offset=0, only_query=True)
    assert out[0] is rows[0]                                  # lexical first, untouched
    ids = [r["id"] for r in out]
    assert ids.count(lexical["id"]) == 1                      # deduped
    assert meaning["id"] in ids
    appended = out[1:]
    assert appended and all(r["matchKind"] == "meaning" for r in appended)
    assert "bodyJson" not in appended[0]                      # the list projection, never a body


# ── the plan rail: GET /notes with the flag unset ─────────────────────────────

class Recorder:
    def __init__(self, conn, log):
        self._conn = conn
        self._log = log

    def execute(self, sql, params=()):
        self._log.append((sql, tuple(params)))
        return self._conn.execute(sql, params)

    def executemany(self, sql, seq):
        self._log.append((sql, "many"))
        return self._conn.executemany(sql, seq)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _record_handler(monkeypatch, **params):
    """Run the REAL `GET /notes` handler, recording every statement on every
    connection the notes service or the semantic module opens."""
    from api.routers import journal_two as router
    from api.services.journal_two import notes
    from api.services.auth_db import get_connection as real
    log: list = []
    monkeypatch.setattr(notes, "get_connection", lambda: Recorder(real(), log))
    monkeypatch.setattr(ns, "get_connection", lambda: Recorder(real(), log))
    # meaning=True: the search box's request (ruling D-H9) -- every rail here is
    # about what the hook does when it IS asked; the opt-in has its own file.
    body = router.list_notes_endpoint(
        folder_id=None, tag=None, ticker=None, q=params.get("q"), embed_symbol=None,
        embed_widget=None, sort="updated", limit=100, offset=0, deleted=False,
        dateFrom=None, dateTo=None, sector=None, theme=None, savedViewId=None,
        propertyFilter=None, propertySort=None, meaning=True, user={"id": U})
    return body, log


def _record_direct(monkeypatch, q):
    from api.services.journal_two import notes
    from api.services.auth_db import get_connection as real
    log: list = []
    monkeypatch.setattr(notes, "get_connection", lambda: Recorder(real(), log))
    notes.list_and_count_notes(U, folder_id=None, tag=None, ticker=None, q=q,
                               embed_symbol=None, embed_widget=None, sort="updated",
                               limit=100, offset=0, deleted=False, date_from=None,
                               date_to=None, symbol_in=None, property_filter=None,
                               property_sort=None, property_filter_strict=True)
    return log


@pytest.mark.parametrize("q", ["why did I cut my winners early", "NVDA", None])
def test_PLAN_RAIL_flag_unset_the_handler_runs_exactly_lane_Is_statements(db_path, monkeypatch, q):
    monkeypatch.delenv(GATE, raising=False)
    _note(U, "Winners diary", "why did I cut my winners early today")
    _, handler = _record_handler(monkeypatch, q=q)
    direct = _record_direct(monkeypatch, q)
    assert handler, "non-vacuity: the handler ran no statement at all"
    assert [s for s, _ in handler] == [s for s, _ in direct]          # byte-identical SQL
    assert [p for _, p in handler] == [p for _, p in direct]
    assert not any("j2_note_embeddings" in s for s, _ in handler)


def test_PLAN_RAIL_CONTROL_flag_on_a_natural_language_query_adds_only_bounded_reads(db_path, monkeypatch, on_noop):
    """⭐ CONTROL: the recorder SEES the semantic statements when they run, so
    the flag-off equality above is not an instrument that cannot see them."""
    _note(U, "Winners diary", "why did I cut my winners early today")
    ns.index_member(U)
    body, handler = _record_handler(monkeypatch, q="why did I cut my winners early")
    direct = _record_direct(monkeypatch, "why did I cut my winners early")
    extra = handler[len(direct):]
    assert [s for s, _ in handler[:len(direct)]] == [s for s, _ in direct]   # lexical first, unchanged
    assert any("j2_note_embeddings" in s for s, _ in extra)
    # ⛔ never a second whole-library pass: every extra read is the member's
    # vectors or a by-id fetch of the hits
    for s, _ in extra:
        assert ("j2_note_embeddings" in s) or (" id IN (" in s) or s.lstrip().upper().startswith("CREATE"), s


def _record_handler_with(monkeypatch, **overrides):
    from api.routers import journal_two as router
    from api.services.journal_two import notes
    from api.services.auth_db import get_connection as real
    log: list = []
    monkeypatch.setattr(notes, "get_connection", lambda: Recorder(real(), log))
    monkeypatch.setattr(ns, "get_connection", lambda: Recorder(real(), log))
    kw = dict(folder_id=None, tag=None, ticker=None, q="why did I cut my winners early",
              embed_symbol=None, embed_widget=None, sort="updated", limit=100, offset=0,
              deleted=False, dateFrom=None, dateTo=None, sector=None, theme=None,
              savedViewId=None, propertyFilter=None, propertySort=None, meaning=True,
              user={"id": U})
    kw.update(overrides)
    body = router.list_notes_endpoint(**kw)
    return body, log


@pytest.mark.parametrize("override", [
    {"folder_id": "f1"}, {"tag": "setups"}, {"ticker": "AMD"}, {"deleted": True},
    {"dateFrom": "2026-01-01"}, {"dateTo": "2026-12-31"}, {"embed_symbol": "AMD"},
    {"embed_widget": "chart"}, {"folder_id": "__archived__"},
])
def test_the_hook_never_appends_under_ANOTHER_filter(db_path, monkeypatch, on_noop, override):
    """A meaning hit is a note-id LIST: under any other filter it would bypass
    that filter, so the handler must pass `only_query=False` for every one."""
    _note(U, "Winners diary", "why did I cut my winners early today")
    ns.index_member(U)
    _, log = _record_handler_with(monkeypatch, **override)
    assert not any("j2_note_embeddings" in s for s, _ in log), override


def test_the_hook_CONTROL_with_no_other_filter_it_does_append(db_path, monkeypatch, on_noop):
    _note(U, "Winners diary", "why did I cut my winners early today")
    ns.index_member(U)
    _, log = _record_handler_with(monkeypatch)
    assert any("j2_note_embeddings" in s for s, _ in log)


@pytest.mark.parametrize("kind", ["sector", "theme", "saved_view", "property_filter"])
def test_the_hook_never_appends_under_a_SECTOR_THEME_SAVED_VIEW_or_PROPERTY_FILTER(
        db_path, monkeypatch, on_noop, kind):
    """Review M-1 (fix round 1): the three filters the rail above did not
    cover. Each reaches the hook's refusal ON ITS OWN, so for a filtered page
    the meaning candidate set is empty: a sector or theme resolves to
    `symbol_in == []` (falsy, but not None), and a saved view whose spec holds
    no property filter is refused by `savedViewId` alone."""
    import json
    _note(U, "Winners diary", "why did I cut my winners early today")
    _note(U, "Selling into strength", "I cut winners early out of fear again")
    ns.index_member(U)
    if kind == "sector":
        override = {"sector": "Technology"}
    elif kind == "theme":
        override = {"theme": "AI Infrastructure"}
    elif kind == "saved_view":
        from api.services.journal_two import note_properties
        override = {"savedViewId": note_properties.create_saved_view(U, "Everything", "list", {})["id"]}
    else:
        override = {"propertyFilter": json.dumps(
            [{"propertyId": "builtin:thesis_status", "op": "is_empty"}])}
    body, log = _record_handler_with(monkeypatch, **override)
    assert not any("j2_note_embeddings" in s for s, _ in log), kind
    assert not any(r.get("matchKind") == "meaning" for r in body["notes"]), kind


def test_PLAN_RAIL_flag_on_a_TICKER_query_is_still_exactly_lexical(db_path, monkeypatch, on_noop):
    _note(U, "NVDA plan", "NVDA breakout plan")
    ns.index_member(U)
    _, handler = _record_handler(monkeypatch, q="why sell NVDA now")
    direct = _record_direct(monkeypatch, "why sell NVDA now")
    # Fix round 1 (review finding 5): a search that found nothing by meaning also reads the
    # bounded, cached waiting count -- whatever the query's shape. That read is the ONLY addition:
    # no vector is read and nothing is embedded for a ticker query.
    waiting = [s for s, _ in handler if "COUNT(*) FROM (SELECT 1 FROM j2_notes" in s
               or s.lstrip().upper().startswith("CREATE")]
    assert len([s for s in waiting if "COUNT(*)" in s]) == 1
    assert [s for s, _ in handler if s not in waiting] == [s for s, _ in direct]
    assert not any("vector" in s for s, _ in handler)


# ── the account leaves, its vectors leave with it ────────────────────────────

def test_account_deletion_purges_the_members_vectors_and_only_theirs(db_path, on_noop):
    from api.services.auth_db import get_connection
    from api.services.journal_two import account_purge
    _note(U, "Mine", "my words")
    _note(OTHER, "Theirs", "their words")
    ns.index_member(U)
    ns.index_member(OTHER)
    assert _rows(U) and _rows(OTHER)
    c = get_connection()
    try:
        report = account_purge.purge_user_data(U, c)
    finally:
        c.close()
    assert report["ok"], report["errors"]
    assert report["rows_deleted"].get("j2_note_embeddings", 0) >= 2
    assert _rows(U) == []
    assert _rows(OTHER), "another member's vectors were purged"


# ── Audit 2026-11-05, spec S4 (B18): the meaning search says what it is still waiting for ──────
#
# "Meaning search returns nothing after 35 minutes" gave the member no status at all. The index
# fills on a 15-minute sweep (api/main.py, `notebook_semantic_sweep`), so a new note is not in
# it yet; the search now SAYS so, with the count of the member's notes still waiting.

def test_pending_count_is_the_live_notes_not_yet_indexed(db_path, on_noop, monkeypatch):
    from api.services.journal_two import notes
    monkeypatch.setattr(ns, "PENDING_CACHE_TTL_S", 0)   # every read fresh in this rail
    a = _note(U, "First", "one two three")
    assert ns.pending_count(U) == 1
    ns.index_member(U)
    assert ns.pending_count(U) == 0
    _note(U, "Second", "four five six")
    gone = _note(U, "Third", "seven eight nine")
    notes.delete_note(U, gone["id"])
    assert ns.pending_count(U) == 1                     # a trashed note is not waiting
    notes.update_note(U, a["id"], {"bodyJson": {"type": "doc", "content": [P("edited words")]}})
    assert ns.pending_count(U) == 2                     # an edit waits for the next sweep
    assert ns.pending_count("someone-else") == 0


def test_pending_count_is_None_while_dark(db_path, monkeypatch):
    monkeypatch.delenv(GATE, raising=False)
    _note(U, "First", "one two three")
    assert ns.pending_count(U) is None


def test_a_meaning_search_with_no_meaning_hit_reports_what_is_waiting(db_path, on_noop, monkeypatch):
    _note(U, "Tight flag", "price coiled under resistance for weeks")
    body, _ = _record_handler(monkeypatch, q="consolidation pattern breakout setup")
    assert not [r for r in body["notes"] if r.get("matchKind") == "meaning"]
    assert body["meaningPending"] == 1


def test_B18_the_audits_own_two_word_query_gets_the_waiting_count(db_path, on_noop, monkeypatch):
    """Fix round 1 (review finding 5): "consolidation pattern" is two tokens, so `query_shape` says
    LEXICAL and the first cut never counted -- the B18 report verbatim. The count does not depend on
    the query's shape: it is sent whenever meaning search was asked for and found nothing."""
    _note(U, "Tight flag", "price coiled under resistance for weeks")
    body, _ = _record_handler(monkeypatch, q="consolidation pattern")
    assert body["meaningPending"] == 1


def test_a_one_word_query_gets_it_too(db_path, on_noop, monkeypatch):
    _note(U, "Tight flag", "price coiled under resistance for weeks")
    body, _ = _record_handler(monkeypatch, q="flag")
    assert body["meaningPending"] == 1


def test_no_query_no_waiting_count(db_path, on_noop, monkeypatch):
    _note(U, "Tight flag", "price coiled under resistance for weeks")
    body, _ = _record_handler(monkeypatch, q=None)
    assert "meaningPending" not in body


def test_pending_count_is_cached_per_member_and_bounded(db_path, on_noop, monkeypatch):
    """Fix round 1 (review finding 18): one count per member a minute, never a library-wide query on
    every debounced keystroke; and the count stops at PENDING_COUNT_CAP."""
    ns.clear_pending_cache()
    _note(U, "One", "words one")
    assert ns.pending_count(U) == 1
    _note(U, "Two", "words two")
    assert ns.pending_count(U) == 1                     # cached
    ns.clear_pending_cache()
    assert ns.pending_count(U) == 2
    monkeypatch.setattr(ns, "PENDING_COUNT_CAP", 1)
    ns.clear_pending_cache()
    assert ns.pending_count(U) == 1                     # capped


def test_R2_2_a_zero_is_cached_briefly_and_a_count_for_the_full_minute(db_path, on_noop, monkeypatch):
    """Fix round 3 (re-review 2, R2-2): a 0 is cached, but only for PENDING_ZERO_TTL_S (10 s) -- an
    empty search does not re-count every keystroke, and a note written a moment later still shows up
    within seconds (the B18 moment). A non-zero count keeps the full minute."""
    clock = {"t": 1000.0}
    monkeypatch.setattr(ns, "_now", lambda: clock["t"])
    ns.clear_pending_cache()
    _note(U, "One", "words one")
    ns.index_member(U)
    assert ns.pending_count(U) == 0
    _note(U, "Two", "words two")                        # just written
    clock["t"] += 5
    assert ns.pending_count(U) == 0                     # the 0 is still cached at 5 s
    clock["t"] += ns.PENDING_ZERO_TTL_S
    assert ns.pending_count(U) == 1                     # past 10 s: counted again
    _note(U, "Three", "words three")
    clock["t"] += ns.PENDING_ZERO_TTL_S + 1
    assert ns.pending_count(U) == 1                     # a non-zero count keeps its minute
    clock["t"] += ns.PENDING_CACHE_TTL_S
    assert ns.pending_count(U) == 2
    assert ns.PENDING_ZERO_TTL_S == 10


def test_N4_the_cap_is_said_as_a_floor(db_path, on_noop, monkeypatch):
    """At the cap the panel must not claim an exact number: the router marks it."""
    monkeypatch.setattr(ns, "PENDING_COUNT_CAP", 2)
    ns.clear_pending_cache()
    for i in range(3):
        _note(U, f"N{i}", "words")
    assert ns.pending_count(U) == 2
    assert ns.pending_count_capped(2) is True
    assert ns.pending_count_capped(1) is False
    body, _ = _record_handler(monkeypatch, q="consolidation pattern")
    assert body["meaningPending"] == 2 and body["meaningPendingCapped"] is True


def test_N4_the_count_reads_no_grouped_scan_of_every_embedding(db_path, on_noop, monkeypatch):
    """The LIMIT bounds the work: the read is a per-note existence probe, never a GROUP BY over all
    of the member's embeddings."""
    ns.clear_pending_cache()
    _note(U, "One", "words one")
    _, log = _record_handler(monkeypatch, q="consolidation pattern")
    counts = [s for s, _ in log if "COUNT(*) FROM (SELECT 1 FROM j2_notes" in s]
    assert len(counts) == 1
    assert "GROUP BY" not in counts[0] and "NOT EXISTS" in counts[0]
