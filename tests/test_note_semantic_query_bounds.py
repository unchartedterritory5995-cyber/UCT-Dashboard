"""Wave 7 whole-branch fix round — ruling D-H6: the armed meaning search's QUERY
embed has per-member bounds (backend review I-1).

⚰️ THE DEFECT. Armed, every `GET /notes` with a 3+ word query made one
synchronous OpenAI embed (`note_semantic.search`), bounded only by the 2 s
timeout and a FAILURE-triggered 60 s pause: the one wave-7 vendor path with no
per-member, per-day or concurrency limit and no cache. Each call holds one of
the web pod's shared pool workers (the 524 outage class) and spends the shared
OpenAI key's rate limit (Whisper, Realtime voice, the brain KB).

THE THREE BOUNDS, each railed here and each FAILING OPEN TO THE LEXICAL PAGE
(the member's search always answers; only the meaning append is skipped):
  (a) at most ONE query embed in flight per member -- a second concurrent
      query-shaped request answers the lexical page without calling the vendor;
  (b) a query-vector cache, bounded (256 entries, 10 minutes): re-typing or
      paging costs no second embed. Keyed by (member, provider, normalised
      query) -- the member is in the key on purpose (see the report's ruling):
      a cache shared across members would let one member time whether another
      searched the same words in the last ten minutes;
  (c) a per-member DAILY count on the durable counter of D-H5b
      (`daily_counters`, 200/day): past it, the lexical page alone. A cache hit
      is not an embed and is not counted.
"""
from __future__ import annotations

import importlib
import os
import tempfile
import threading

import pytest

from api.services.journal_two import note_semantic as ns

GATE = ns.SEMANTIC_GATE
U, V = "u-qb", "u-qb-other"
NL = "why did I cut my winners early"
DAY = "2026-09-25"


@pytest.fixture(autouse=True)
def _fresh_bounds(monkeypatch):
    ns._paused_until = 0.0
    ns.clear_query_cache()
    monkeypatch.setattr(ns, "_et_day", lambda: DAY)
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


def _note(user_id, title, *paras):
    from api.services.journal_two import notes
    return notes.create_note(user_id, {"title": title, "bodyJson": {
        "type": "doc", "content": [P(t) for t in paras]}})


class Counting(ns.NoOpEmbeddingProvider):
    """The no-op provider, counting every vendor-shaped call."""

    def __init__(self, gate: threading.Event | None = None, entered: threading.Event | None = None):
        self.calls: list[list[str]] = []
        self._gate = gate
        self._entered = entered

    def embed(self, texts, *, timeout=None):
        self.calls.append(list(texts))
        if self._entered is not None:
            self._entered.set()
        if self._gate is not None:
            assert self._gate.wait(timeout=10), "the test never released the embed"
        return super().embed(texts, timeout=timeout)


def _library(user_id=U):
    lexical = _note(user_id, "Winners diary", "why did I cut my winners early today")
    meaning = _note(user_id, "Selling into strength", "I cut winners early out of fear again")
    ns.index_member(user_id)
    return [{"id": lexical["id"], "title": "Winners diary"}], meaning


def _append(user_id, rows, q=NL):
    return ns.append_meaning_hits(user_id, q, rows, total=len(rows), offset=0, only_query=True)


# ── (a) one embed in flight per member ───────────────────────────────────────

def test_a_SECOND_concurrent_query_from_the_same_member_gets_the_lexical_page(db_path, monkeypatch):
    rows, meaning = _library()
    release, entered = threading.Event(), threading.Event()
    provider = Counting(gate=release, entered=entered)
    monkeypatch.setattr(ns, "get_provider", lambda: provider)
    first: list = []
    t = threading.Thread(target=lambda: first.append(_append(U, list(rows))))
    t.start()
    try:
        assert entered.wait(timeout=10), "non-vacuity: the first request never reached the vendor"
        second = _append(U, rows, q="what went wrong with my entries")
        assert second is rows, "the second concurrent request did not get the lexical page"
        assert len(provider.calls) == 1, f"{len(provider.calls)} embeds in flight for one member"
    finally:
        release.set()
        t.join(timeout=10)
    assert [r["id"] for r in first[0]][-1] == meaning["id"], "control: the first request appended"


def test_another_member_is_not_held_behind_the_first(db_path, monkeypatch):
    rows_u, _ = _library(U)
    rows_v, meaning_v = _library(V)
    release, entered = threading.Event(), threading.Event()
    blocking = Counting(gate=release, entered=entered)
    free = Counting()
    monkeypatch.setattr(ns, "get_provider", lambda: blocking if not entered.is_set() else free)
    t = threading.Thread(target=lambda: _append(U, list(rows_u)))
    t.start()
    try:
        assert entered.wait(timeout=10)
        out = _append(V, rows_v)
        assert [r["id"] for r in out][-1] == meaning_v["id"]
        assert len(free.calls) == 1
    finally:
        release.set()
        t.join(timeout=10)


def test_the_slot_is_released_after_a_FAILED_embed(db_path, monkeypatch):
    rows, meaning = _library()

    class Failing(ns.NoOpEmbeddingProvider):
        def embed(self, texts, *, timeout=None):
            raise TimeoutError("vendor slow")

    monkeypatch.setattr(ns, "get_provider", lambda: Failing())
    assert _append(U, rows) is rows
    ns._paused_until = 0.0                                  # past the failure pause
    ok = Counting()
    monkeypatch.setattr(ns, "get_provider", lambda: ok)
    out = _append(U, rows)
    assert len(ok.calls) == 1, "the member's slot leaked after a failure"
    assert [r["id"] for r in out][-1] == meaning["id"]


# ── (b) the query-vector cache ───────────────────────────────────────────────

def test_retyping_or_paging_the_same_query_costs_no_second_embed(db_path, monkeypatch):
    rows, meaning = _library()
    provider = Counting()
    monkeypatch.setattr(ns, "get_provider", lambda: provider)
    first = _append(U, rows)
    # normalised: case and spacing (an all-caps word would read as a TICKER and
    # route the query lexical before any embed -- `query_shape`)
    again = _append(U, rows, q="  why Did I cut My winners   early ")
    assert len(provider.calls) == 1, f"{len(provider.calls)} embeds for one query"
    assert [r["id"] for r in again] == [r["id"] for r in first]
    assert [r["id"] for r in again][-1] == meaning["id"]


def test_the_cache_is_per_member_and_per_provider(db_path, monkeypatch):
    rows_u, _ = _library(U)
    rows_v, _ = _library(V)
    provider = Counting()
    monkeypatch.setattr(ns, "get_provider", lambda: provider)
    _append(U, rows_u)
    _append(V, rows_v)
    assert len(provider.calls) == 2, "one member's cached query answered another's"

    class Other(Counting):
        name = "noop:other"

    other = Other()
    monkeypatch.setattr(ns, "get_provider", lambda: other)
    _append(U, rows_u)
    assert len(other.calls) == 1, "a provider switch reused the old provider's vector"


def test_the_cache_EXPIRES_after_ten_minutes(db_path, monkeypatch):
    rows, _ = _library()
    provider = Counting()
    monkeypatch.setattr(ns, "get_provider", lambda: provider)
    clock = [1000.0]
    monkeypatch.setattr(ns, "_now", lambda: clock[0])
    _append(U, rows)
    clock[0] += ns.QUERY_CACHE_TTL_S - 1
    _append(U, rows)
    assert len(provider.calls) == 1
    clock[0] += 2
    _append(U, rows)
    assert len(provider.calls) == 2, "an expired vector was reused"
    assert ns.QUERY_CACHE_TTL_S == 600, "the ruling's ten minutes moved"


def test_the_cache_is_BOUNDED_and_evicts_the_least_recently_used(monkeypatch):
    assert ns.QUERY_CACHE_MAX == 256, "the ruling's 256 entries moved"
    monkeypatch.setattr(ns, "QUERY_CACHE_MAX", 3)
    for i in range(4):
        ns._remember_vector((U, "p", f"q{i}"), [float(i)])
    assert ns._cached_vector((U, "p", "q0")) is None, "the cache grew past its bound"
    assert ns._cached_vector((U, "p", "q1")) == [1.0]
    ns._remember_vector((U, "p", "q4"), [4.0])              # q1 was just used: q2 goes
    assert ns._cached_vector((U, "p", "q2")) is None
    assert ns._cached_vector((U, "p", "q1")) == [1.0]


# ── (c) the member's daily embed count (durable, D-H5b's counter) ────────────

def test_past_the_DAILY_count_the_lexical_page_is_served_alone(db_path, monkeypatch):
    from api.services import daily_counters as dc
    rows, _ = _library()
    provider = Counting()
    monkeypatch.setattr(ns, "get_provider", lambda: provider)
    assert ns.QUERY_EMBEDS_PER_MEMBER_PER_DAY == 200, "the ruling's 200 a day moved"
    dc.take(DAY, [dc.Charge(ns.SCOPE_QUERY_EMBED, U, ns.QUERY_EMBEDS_PER_MEMBER_PER_DAY)])
    assert _append(U, rows) is rows
    assert provider.calls == [], "the vendor was called past the member's daily count"


def test_CONTROL_one_short_of_the_count_still_embeds_and_counts_it(db_path, monkeypatch):
    from api.services import daily_counters as dc
    rows, meaning = _library()
    provider = Counting()
    monkeypatch.setattr(ns, "get_provider", lambda: provider)
    dc.take(DAY, [dc.Charge(ns.SCOPE_QUERY_EMBED, U, ns.QUERY_EMBEDS_PER_MEMBER_PER_DAY - 1)])
    out = _append(U, rows)
    assert len(provider.calls) == 1 and [r["id"] for r in out][-1] == meaning["id"]
    assert dc.value(DAY, ns.SCOPE_QUERY_EMBED, U) == ns.QUERY_EMBEDS_PER_MEMBER_PER_DAY
    _append(U, rows)                                          # a cache hit: not counted
    assert dc.value(DAY, ns.SCOPE_QUERY_EMBED, U) == ns.QUERY_EMBEDS_PER_MEMBER_PER_DAY


def test_a_COUNTER_error_admits_the_embed_the_counters_own_rule(db_path, monkeypatch):
    """D-H5b's rule: a counter that cannot be read or written fails OPEN."""
    from api.services import auth_db
    rows, meaning = _library()
    provider = Counting()
    monkeypatch.setattr(ns, "get_provider", lambda: provider)
    from api.services import daily_counters as dc

    def boom():
        import sqlite3
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(dc, "_connect", boom)
    out = _append(U, rows)
    assert len(provider.calls) == 1 and [r["id"] for r in out][-1] == meaning["id"]
    assert auth_db  # (the notes themselves still read through auth_db untouched)


def test_the_bounds_are_DARK_too(monkeypatch):
    """Gate off: `append_meaning_hits` returns before any bound is consulted."""
    monkeypatch.delenv(GATE, raising=False)
    touched = []
    monkeypatch.setattr(ns, "_query_vector", lambda *a, **k: touched.append(a))
    rows = [{"id": "x"}]
    assert _append(U, rows) is rows and touched == []
