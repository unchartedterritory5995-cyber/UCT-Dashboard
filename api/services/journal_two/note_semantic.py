"""Wave 7 lane H (H3) — meaning search over a member's notes. DARK.

A member who searches "why did I cut my winners too early" is asking a
question, not naming words; lexical search finds the notes that contain those
words and misses the one that says "I sold into strength again". This module
adds MEANING to the Notebook's search, the way ruling D-H3 decided:

  * EMBEDDINGS: OpenAI `text-embedding-3-small` on the existing client
    (`voice_openai._get_client`, `voice_embeddings_service`'s model and chunk
    ceiling -- the `brain_kb_service` precedent), one request per batch, behind
    a provider interface with a second, NO-OP implementation that never leaves
    the process.
  * THE INDEX: `j2_note_embeddings` in auth.db, one row per note BLOCK
    (`ask_retrieval._note_blocks` is the splitter, so a block here is the same
    unit Ask cites), incremental by `content_hash`, SELF-ENSURED on every call
    (the `ensure_capture_auth_schema` idiom — db.py is not this lane's), purged
    with the account (`account_purge._DIRECT_USER_TABLES`).
  * THE SWEEP: `run_sweep()` / `sweep_job()`, scheduled by the controller in
    api/main.py — never on save (notes.py's write path is not this lane's).
  * THE ROUTING, never a fusion: `query_shape()` — two tokens or fewer, a
    quoted phrase, or a ticker-shaped token is LEXICAL ONLY; a natural-language
    query of three tokens or more gets the lexical list first and the meaning
    hits APPENDED after it, deduped by note id (`append_meaning_hits`, called
    once from `GET /notes` after its single `list_and_count_notes` call). The
    Wave-L measurement is why: naive RRF cost lexical precision (0.917 -> 0.608)
    for no measured gain.

⛔⛔ WHILE `NOTEBOOK_SEMANTIC_SEARCH_ENABLED` IS OFF: nothing is embedded,
nothing is sent to any vendor, the sweep is a no-op, and the provider is NEVER
CONSTRUCTED — every public function checks the gate FIRST, before it opens a
connection or builds a provider. It STAYS DARK until OpenAI zero-retention
terms are confirmed (docs/notebook VENDOR-TERMS): switching it on sends note
text to OpenAI. Read per call; a flip needs no restart.

⛔ NOTHING HERE LOGS NOTE OR QUERY TEXT. Counts only.

⚠️ PER-PROCESS: the pause after a failed meaning search (`_paused_until`, see
"Failing open"), and ruling D-H6's single-flight set (`_embedding_now`) and
query-vector cache (`_query_cache`, see "The query embed's bounds"). The index
and D-H6's daily embed count are durable (auth.db) and the gate is read per
call.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import struct
import threading
import time
from collections import OrderedDict
from typing import Any, Protocol

from api.services import daily_counters
from api.services.auth_db import get_connection

log = logging.getLogger(__name__)

SEMANTIC_GATE = "NOTEBOOK_SEMANTIC_SEARCH_ENABLED"
_GATE_ON_VALUES = {"1", "true", "yes", "on"}

# Which provider an ENABLED search uses. A MODE, declared as a table so the
# flag index (`feature_flag_index.mode_flags`) can see its default and its
# vocabulary. The default is OpenAI because that is what the ruling built; the
# no-op exists so a sandbox or staging box can run the whole feature offline.
PROVIDER_OPENAI = "openai"
PROVIDER_NOOP = "noop"
NOTE_SEMANTIC_MODE_FLAGS = {
    "NOTEBOOK_SEMANTIC_PROVIDER": (PROVIDER_OPENAI, (PROVIDER_OPENAI, PROVIDER_NOOP)),
}

# Bounds. Each is a cost ceiling, not a quality knob: a sweep embeds at most
# this much before it yields to the next run.
MAX_BLOCKS_PER_NOTE = 200
MAX_EMBEDS_PER_MEMBER_RUN = 400
MAX_EMBEDS_PER_SWEEP = 2000
APPEND_K = 8                 # meaning hits appended after the lexical list
_BATCH = 64
# The search bound and its fallback (review I-1) -- the Search section says
# why each is the value it is.
MAX_SEARCH_BLOCKS = 2000
QUERY_EMBED_TIMEOUT_S = 2.0
PAUSE_AFTER_FAILURE_S = 60
# The query embed's per-member bounds (ruling D-H6) -- "The query embed's
# bounds" below says why each is the value it is.
QUERY_EMBEDS_PER_MEMBER_PER_DAY = 200
QUERY_CACHE_MAX = 256
QUERY_CACHE_TTL_S = 600
SCOPE_QUERY_EMBED = "notebook_semantic_query_embed"   # a daily_counters scope

LEXICAL = "lexical"
SEMANTIC = "semantic"

_DDL = """
CREATE TABLE IF NOT EXISTS j2_note_embeddings (
    user_id      TEXT NOT NULL,
    note_id      TEXT NOT NULL,
    block_id     TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    vector       BLOB NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, note_id, block_id)
);
"""


def semantic_enabled() -> bool:
    """The gate, read PER CALL. Unset, or anything but an on-value, is OFF."""
    raw = os.environ.get(SEMANTIC_GATE)
    return raw is not None and raw.strip().lower() in _GATE_ON_VALUES


def ensure_semantic_schema(conn: sqlite3.Connection) -> None:
    """Self-ensured on every call that touches the table (never db.py's)."""
    conn.executescript(_DDL)


# ── Providers ────────────────────────────────────────────────────────────────

class EmbeddingProvider(Protocol):
    name: str
    min_score: float

    def embed(self, texts: list[str], *, timeout: float | None = None) -> list[list[float]]: ...


class OpenAIEmbeddingProvider:
    """`text-embedding-3-small` (voice_embeddings_service's model and chunk
    ceiling) on the existing client, `voice_openai._get_client` -- never a
    second one. ⛔ Constructed only by `get_provider()`, which refuses while the
    gate is off.

    ONE HTTP REQUEST PER CALL (`input=[...]`, review I-2): the caller batches
    (`_BATCH`). ⚰️ It used to call `embed_text` once per block, so one batch of
    64 was 64 sequential round trips -- inside a write transaction, at the time.

    `timeout` is a per-call ceiling on the SHARED client (`with_options`, which
    copies the client, never constructs a new one), and it disables the SDK's
    retries: a caller that passes one has a fallback, and a retry would spend
    the time the fallback exists to save. None keeps the client's own ceiling
    (REQUEST_PATH_LONG) and retries -- the sweep's case, on a scheduler thread
    with no lock held."""

    name = "openai:text-embedding-3-small"
    min_score = 0.30

    def embed(self, texts: list[str], *, timeout: float | None = None) -> list[list[float]]:
        from api.services import voice_embeddings_service as ves
        from api.services import voice_openai
        if not texts:
            return []
        client = voice_openai._get_client()
        if timeout is not None:
            client = client.with_options(timeout=timeout, max_retries=0)
        resp = client.embeddings.create(
            model=ves.EMBEDDING_MODEL, input=[t[:ves.MAX_CHUNK_CHARS] for t in texts])
        got = sorted(resp.data, key=lambda d: d.index)   # the API does not promise order
        if len(got) != len(texts):
            raise RuntimeError(f"the provider answered {len(got)} vectors for {len(texts)} texts")
        return [list(d.embedding) for d in got]


class NoOpEmbeddingProvider:
    """⛔ NEVER CONTACTS ANY VENDOR. A deterministic local vector (hashed bag of
    words, 256 dims) so the index and the search can be exercised end to end
    with nothing leaving the process. Not a quality claim — a plumbing one."""

    name = "noop:hash-256"
    min_score = 0.20
    _DIM = 256

    def embed(self, texts: list[str], *, timeout: float | None = None) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    def _vector(self, text: str) -> list[float]:
        v = [0.0] * self._DIM
        for word in re.findall(r"[a-z0-9$]+", (text or "").lower()):
            h = int.from_bytes(hashlib.sha1(word.encode("utf-8")).digest()[:4], "little")
            v[h % self._DIM] += 1.0
        return v


def provider_mode() -> str:
    raw = os.environ.get("NOTEBOOK_SEMANTIC_PROVIDER")
    v = raw.strip().lower() if isinstance(raw, str) else None
    default, allowed = NOTE_SEMANTIC_MODE_FLAGS["NOTEBOOK_SEMANTIC_PROVIDER"]
    return v if v in allowed else default


def get_provider() -> EmbeddingProvider | None:
    """⛔ None while the gate is off: the provider is never constructed dark."""
    if not semantic_enabled():
        return None
    return NoOpEmbeddingProvider() if provider_mode() == PROVIDER_NOOP else OpenAIEmbeddingProvider()


# ── Vectors ──────────────────────────────────────────────────────────────────

def _encode(vec: list[float]) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


def _sha(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


# ── Blocks ───────────────────────────────────────────────────────────────────

def note_blocks(title: str | None, body_json: Any) -> list[dict[str, str]]:
    """A note as embeddable units: its title, then its blocks as
    `ask_retrieval._note_blocks` splits them (the same unit Ask cites; an
    inserted Ask/writing-help answer is skipped there, because it is not the
    member's writing). `block_id` is derived from the text, so a paragraph that
    moves keeps its vector; duplicates collapse to one."""
    from api.services.journal_two import ask_retrieval
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    t = (title or "").strip()
    if t:
        bid = "t:" + _sha(t)[:20]
        out.append({"block_id": bid, "text": t})
        seen.add(bid)
    doc = body_json
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except (TypeError, ValueError):
            doc = None
    if isinstance(doc, dict):
        try:
            blocks = ask_retrieval._note_blocks(doc, "")
        except Exception:  # noqa: BLE001 — a body the splitter cannot read indexes its title only
            blocks = []
        for b in blocks:
            text = (b.get("text") or "").strip()
            if not text:
                continue
            bid = "b:" + _sha(text)[:20]
            if bid in seen:
                continue
            seen.add(bid)
            out.append({"block_id": bid, "text": text})
            if len(out) >= MAX_BLOCKS_PER_NOTE:
                break
    return out


def _content_hash(provider_name: str, text: str) -> str:
    """The PROVIDER is part of the hash, so switching providers re-embeds
    everything incrementally instead of comparing vectors from two spaces."""
    return _sha(provider_name + "\n" + text)


# ── Indexing ─────────────────────────────────────────────────────────────────
#
# ⛔⛔ NO TRANSACTION IS EVER OPEN ACROSS A VENDOR CALL (review I-2). auth.db is
# the session and notes database for every member, and `get_connection()` is
# Python's legacy implicit-BEGIN isolation: the first INSERT/UPDATE/DELETE
# takes the write lock and holds it until commit. ⚰️ The sweep used to take it
# with the DELETE of dropped notes and keep it through the first note's
# embedding (and a long note's second batch ran after its first batch's
# INSERT), so an unrelated write elsewhere in the app waited on OpenAI --
# measured: `database is locked` after 619 ms. Now: plan a note with reads
# only, embed with no transaction open (`_embed_unlocked` REFUSES to run
# otherwise), then write the note in ONE short transaction.


# A note with NOTHING to embed (no title, and a body the splitter keeps nothing
# of: an empty "Untitled", an image-only note, a note holding only an Ask
# answer) gets ONE row under this block id with an EMPTY vector: the record
# that this revision was indexed and holds nothing. ⚰️ It got no row at all, so
# the sweep's work predicate read its revision as missing on every run and
# visited its member every 15 minutes, forever (backend re-review N1). Real
# block ids are "t:<sha>" / "b:<sha>", so this one can never collide; the row
# lives and dies with the note's other rows (a later edit that adds words drops
# it as a `gone` block, and the account purge deletes the table by member), and
# the candidate read skips an empty vector.
NO_BLOCKS_ID = "-"


def _revision_marker(note_updated_at: str, provider_name: str) -> str:
    """What `j2_note_embeddings.updated_at` records: WHICH REVISION of the note
    the vectors came from AND which provider made them. The provider is part
    of it so a provider switch revisits every note without waiting for an edit
    -- vectors from two spaces cannot be compared, and the one the search
    cannot read would leave the note invisible to it."""
    return f"{note_updated_at}|{provider_name}"


def _plan_note(conn, provider, user_id: str, note: sqlite3.Row) -> dict[str, Any]:
    """Reads only: what this note needs embedded, reused and dropped."""
    blocks = note_blocks(note["title"], note["body_json"])
    existing = {r["block_id"]: r["content_hash"] for r in conn.execute(
        "SELECT block_id, content_hash FROM j2_note_embeddings WHERE user_id = ? AND note_id = ?",
        (user_id, note["id"]))}
    want = {b["block_id"]: _content_hash(provider.name, b["text"]) for b in blocks}
    return {"blocks": blocks, "want": want,
            "todo": [b for b in blocks if existing.get(b["block_id"]) != want[b["block_id"]]],
            "gone": [bid for bid in existing if bid not in want]}


def _embed_unlocked(conn, provider, texts: list[str]) -> list[list[float]]:
    """Every sweep vendor call goes through here, in batches of `_BATCH` (one
    HTTP request each). ⛔ Refuses to run while `conn` holds a transaction:
    failing the sweep is recoverable next run; a write lock held across the
    network is an outage for every member writing to auth.db meanwhile."""
    if conn.in_transaction:
        raise RuntimeError("note_semantic: a transaction is open across a vendor call")
    out: list[list[float]] = []
    for i in range(0, len(texts), _BATCH):
        out.extend(provider.embed(texts[i:i + _BATCH]))
    if len(out) != len(texts):
        raise RuntimeError(f"the provider answered {len(out)} vectors for {len(texts)} texts")
    return out


def _index_note(conn, provider, user_id: str, note: sqlite3.Row, plan: dict[str, Any]) -> int:
    vectors = _embed_unlocked(conn, provider, [b["text"] for b in plan["todo"]])
    # ONE short write transaction per note, opened only now that every vector
    # is in hand: nothing between here and the commit leaves the process.
    marker = _revision_marker(note["updated_at"], provider.name)
    try:
        conn.executemany(
            "INSERT OR REPLACE INTO j2_note_embeddings"
            " (user_id, note_id, block_id, content_hash, vector, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            [(user_id, note["id"], b["block_id"], plan["want"][b["block_id"]], _encode(v), marker)
             for b, v in zip(plan["todo"], vectors)])
        if plan["gone"]:
            conn.executemany(
                "DELETE FROM j2_note_embeddings WHERE user_id = ? AND note_id = ? AND block_id = ?",
                [(user_id, note["id"], bid) for bid in plan["gone"]])
        if not plan["blocks"]:
            conn.execute(
                "INSERT OR REPLACE INTO j2_note_embeddings"
                " (user_id, note_id, block_id, content_hash, vector, updated_at)"
                " VALUES (?, ?, ?, '', ?, ?)",
                (user_id, note["id"], NO_BLOCKS_ID, b"", marker))
        # ⭐ The marker records WHICH REVISION of the note these vectors came
        # from (j2_notes.updated_at), never the wall clock: a note edited
        # during a sweep then reads as changed on the next one instead of
        # looking indexed forever.
        conn.execute(
            "UPDATE j2_note_embeddings SET updated_at = ? WHERE user_id = ? AND note_id = ?",
            (marker, user_id, note["id"]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return len(plan["todo"])


def index_member(user_id: str, *, conn: sqlite3.Connection | None = None,
                 provider: EmbeddingProvider | None = None,
                 max_embeds: int = MAX_EMBEDS_PER_MEMBER_RUN) -> dict[str, Any]:
    """Bring one member's index up to date, newest notes first. → counts
    (never text).

    The walk STOPS at the first note the remaining budget cannot cover (review
    M-6): every note after it is counted as deferred without being parsed.
    ⚰️ It used to parse every remaining body and defer each one -- measured
    `notes 954, indexed 10, deferred 944` for a 64-embed budget, all of it
    repeated by the next run.

    ⛔ Dark: returns at once — no connection, no provider, nothing sent."""
    if not semantic_enabled():
        return {"skipped": "dark"}
    provider = provider or get_provider()
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        ensure_semantic_schema(conn)
        notes = conn.execute(
            "SELECT id, title, body_json, updated_at FROM j2_notes"
            " WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL"
            " ORDER BY updated_at DESC, id",
            (user_id,)).fetchall()
        indexed_at = {r["note_id"]: r["at"] for r in conn.execute(
            "SELECT note_id, MAX(updated_at) AS at FROM j2_note_embeddings"
            " WHERE user_id = ? GROUP BY note_id", (user_id,))}
        # A note trashed, archived or deleted since the last run leaves the
        # index -- in its OWN short transaction, committed before any vendor call.
        dropped = conn.execute(
            "DELETE FROM j2_note_embeddings WHERE user_id = ?"
            " AND note_id NOT IN (SELECT value FROM json_each(?))",
            (user_id, json.dumps([n["id"] for n in notes]))).rowcount
        conn.commit()
        pending = [n for n in notes
                   if indexed_at.get(n["id"]) != _revision_marker(n["updated_at"], provider.name)]
        out = {"notes": len(notes), "indexed": 0, "unchanged": len(notes) - len(pending),
               "deferred": 0, "embedded": 0, "reused": 0, "dropped": max(0, dropped or 0)}
        budget = max_embeds
        for i, n in enumerate(pending):
            plan = _plan_note(conn, provider, user_id, n)
            if len(plan["todo"]) > budget:
                out["deferred"] = len(pending) - i
                break
            embedded = _index_note(conn, provider, user_id, n, plan)
            budget -= embedded
            out["embedded"] += embedded
            out["reused"] += len(plan["blocks"]) - embedded
            out["indexed"] += 1
        return out
    finally:
        if owned:
            conn.close()


# The members a sweep has WORK for, oldest-indexed first -- ONE statement, no
# note body read (whole-branch review M-4). A member has work when a live note's
# revision marker is missing or differs (a new note, an edit, a provider
# switch: `_revision_marker` is `<updated_at>|<provider>`), or when a stored
# vector's note is no longer live (trashed, archived, deleted, or the member's
# notes are gone altogether -- the review's M-5 purge race). ⚰️ It listed EVERY
# member with a live note, and the budget shrank only by embeds, so an idle run
# walked every member's whole library (bodies included) plus a DELETE and a
# commit per member, four times an hour. ⛔ Not "newest note vs newest indexed
# block": a member whose older notes were deferred past a run's budget has an
# indexed newest note, and that test would strand the rest forever.
_MEMBERS_WITH_WORK_SQL = (
    "WITH live AS ("
    "  SELECT user_id, id, updated_at FROM j2_notes"
    "  WHERE deleted_at IS NULL AND archived_at IS NULL),"
    " idx AS ("
    "  SELECT user_id, note_id, MAX(updated_at) AS at FROM j2_note_embeddings"
    "  GROUP BY user_id, note_id),"
    " work AS ("
    "  SELECT l.user_id FROM live l LEFT JOIN idx i"
    "    ON i.user_id = l.user_id AND i.note_id = l.id"
    "  WHERE i.at IS NULL OR i.at <> (l.updated_at || '|' || ?)"
    "  UNION"
    # ⛔ A SET DIFFERENCE, not a join back to j2_notes by id: the join read each
    # indexed note's ROW (its deleted_at/archived_at sit past a ~2 KB body, an
    # overflow walk per note); EXCEPT reads both sides from covering indexes.
    "  SELECT user_id FROM (SELECT user_id, note_id FROM idx"
    "                       EXCEPT SELECT user_id, id FROM live))"
    " SELECT w.user_id FROM work w"
    " LEFT JOIN (SELECT user_id, MAX(at) AS last_at FROM idx GROUP BY user_id) m"
    "   ON m.user_id = w.user_id"
    " ORDER BY COALESCE(m.last_at, '') ASC, w.user_id ASC")


def run_sweep(*, conn: sqlite3.Connection | None = None,
              provider: EmbeddingProvider | None = None,
              max_embeds: int = MAX_EMBEDS_PER_SWEEP) -> dict[str, Any]:
    """Every member with something to index or drop (`_MEMBERS_WITH_WORK_SQL`),
    oldest-indexed first, until the run's budget is spent; a member with
    nothing pending is never visited. ⛔ Dark: a no-op that touches nothing."""
    if not semantic_enabled():
        return {"skipped": "dark"}
    provider = provider or get_provider()
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        ensure_semantic_schema(conn)
        members = [r[0] for r in conn.execute(_MEMBERS_WITH_WORK_SQL, (provider.name,))]
        total = {"members": 0, "embedded": 0, "deferred": 0}
        budget = max_embeds
        for uid in members:
            if budget <= 0:
                break
            r = index_member(uid, conn=conn, provider=provider,
                             max_embeds=min(budget, MAX_EMBEDS_PER_MEMBER_RUN))
            total["members"] += 1
            total["embedded"] += r.get("embedded", 0)
            total["deferred"] += r.get("deferred", 0)
            budget -= r.get("embedded", 0)
        return total
    finally:
        if owned:
            conn.close()


def sweep_job() -> None:
    """The scheduler's entry point (the controller registers it in api/main.py,
    `max_instances=1`). Never raises into the scheduler; logs counts only."""
    try:
        r = run_sweep()
        if r.get("skipped"):
            return
        log.info("[note-semantic] sweep members=%s embedded=%s deferred=%s",
                 r.get("members"), r.get("embedded"), r.get("deferred"))
    except Exception:  # noqa: BLE001
        log.exception("[note-semantic] sweep failed")


# ── Search ───────────────────────────────────────────────────────────────────
#
# ⛔⛔ BOUNDED, AND FAIL-OPEN (review I-1). `GET /notes` is a sync handler on the
# web pod's ONE shared anyio pool, so everything below is paid by a pool worker
# while a member waits on a type-ahead search.
#   * THE CANDIDATE SET is the notes that could still be APPENDED to the page:
#     the member's active notes (not trashed, not archived -- a note that can
#     never be shown is never scored), minus the note ids the router's lexical
#     page already holds, newest first, cut at `MAX_SEARCH_BLOCKS` blocks.
#     WHY 2,000: measured at 50k stored blocks (1,536 dims), reading and
#     scoring costs ~10 us per candidate block, linearly -- 2,000 is ~20 ms
#     (p50 22.5 ms, peak 15.6 MB; it was 6.1 s and 318 MB unbounded), under
#     a quarter of the Notebook's 100 ms search budget, so the vendor round
#     trip stays the only real cost of an armed search.
#     It is the newest ~100-200 notes at 10-20 blocks a note (never fewer
#     than 10, at the 200-block per-note ceiling); older notes stay
#     reachable lexically. The ceiling holds whatever the library's size.
#     ⚰️ It used to fetch and score EVERY stored vector in pure Python --
#     0.106-0.124 ms per block, 5.3-6.2 s at 50k blocks, 127 MB at 20k.
#   * THE QUERY EMBED is one request with its own short ceiling
#     (`query_embed_timeout()`, default 2 s, no retries) -- never the shared
#     client's 120 s.
#   * ANY FAILURE (vendor, timeout, database) serves the lexical page unchanged:
#     one log line, then meaning search pauses for `PAUSE_AFTER_FAILURE_S` so a
#     vendor outage costs one short wait a minute, not one per keystroke.


# ⛔ `CROSS JOIN` IS LOAD-BEARING: it makes SQLite walk the member's LIVE notes
# newest-first on an index (`idx_j2_notes_switcher_live`) and stop at the
# LIMIT, probing each note's blocks by primary key. ⚰️ The plain JOIN let the
# planner start from the embeddings and sort every candidate's 6 KB vector in a
# temp B-tree before the LIMIT applied -- measured at 50k stored blocks: 1,337 ms
# to read 4,000 rows, against 30 ms this way. No `n.id` tiebreak for the same
# reason (the index does not carry it); notes edited in the same instant may
# come in either order, which the scorer does not care about.
_CANDIDATES_SQL = (
    "SELECT e.note_id, e.vector FROM j2_notes n"
    " CROSS JOIN j2_note_embeddings e ON e.user_id = n.user_id AND e.note_id = n.id"
    " WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL"
    " AND n.id NOT IN (SELECT value FROM json_each(?))"
    " ORDER BY n.updated_at DESC LIMIT ?")


def query_embed_timeout() -> float:
    """The query embedding's ceiling, seconds. Default 2: text-embedding-3-small
    answers a one-line input well under a second, the lexical answer is already
    computed and waiting, and every second past that is a pool worker pinned for
    a result the page can live without. `NOTEBOOK_SEMANTIC_QUERY_TIMEOUT_SECS`
    retunes it from Railway (llm_timeouts.seconds: a bad value falls back)."""
    from api.services import llm_timeouts
    return llm_timeouts.seconds("NOTEBOOK_SEMANTIC_QUERY_TIMEOUT_SECS", QUERY_EMBED_TIMEOUT_S)


def search(user_id: str, query: str, k: int = 10, *, conn: sqlite3.Connection | None = None,
           provider: EmbeddingProvider | None = None,
           exclude_note_ids: set[str] | frozenset[str] = frozenset()) -> list[dict[str, Any]]:
    """The member's notes closest in MEANING to `query`: `[{note_id, score}]`,
    best first, one entry per note (its best block), above the provider's floor.
    Scores at most `MAX_SEARCH_BLOCKS` blocks, from active notes not in
    `exclude_note_ids`, newest first. RAISES on a provider or database failure:
    `append_meaning_hits` is where failing open is decided.
    ⛔ Dark: `[]` at once — nothing embedded, nothing sent, nothing read."""
    if not semantic_enabled():
        return []
    q = (query or "").strip()
    if not q:
        return []
    provider = provider or get_provider()
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        ensure_semantic_schema(conn)
        # ⛔ The bounds FIRST, the candidates only for a query they admit
        # (backend re-review N5): `_query_vector` calls the reader once every
        # refusal has been checked, so a refused query builds no matrix.
        found = _query_vector(user_id, provider, q, read_candidates=lambda: _read_candidates(
            conn, user_id, exclude_note_ids))
        if not found:
            # A bound refused the embed (ruling D-H6), or there is nothing to
            # score: no meaning hits, and the caller serves the lexical page.
            return []
        qv, (note_ids, mat) = found
        best = _score(qv, note_ids, mat)
        ranked = sorted((item for item in best.items() if item[1] >= provider.min_score),
                        key=lambda kv: (-kv[1], kv[0]))
        return [{"note_id": nid, "score": round(score, 4)} for nid, score in ranked[:max(0, k)]]
    finally:
        if owned:
            conn.close()


def _read_candidates(conn, user_id: str, exclude_note_ids) -> tuple[list[str], Any]:
    """The candidate blocks, streamed a chunk at a time into ONE preallocated
    float32 matrix (at most `MAX_SEARCH_BLOCKS` rows), so the request's peak is
    the matrix and one chunk -- never every vector held twice. The width is the
    newest block's; a block of another width (a provider switch the sweep has
    not reached yet -- it revisits newest first) is skipped, never compared."""
    import numpy as np
    limit = max(0, MAX_SEARCH_BLOCKS)
    cur = conn.execute(_CANDIDATES_SQL, (
        user_id, json.dumps(sorted(x for x in exclude_note_ids if x)), limit))
    note_ids: list[str] = []
    mat = None
    width = 0
    while True:
        chunk = cur.fetchmany(256)
        if not chunk:
            break
        for r in chunk:
            blob = r["vector"]
            if not blob:
                continue            # a note with nothing to embed (NO_BLOCKS_ID), not a vector
            if mat is None:
                width = len(blob)
                mat = np.empty((limit, width // 4), dtype="<f4")
            if len(blob) != width:
                continue
            mat[len(note_ids)] = np.frombuffer(blob, dtype="<f4")
            note_ids.append(r["note_id"])
    return note_ids, (mat[:len(note_ids)] if mat is not None else None)


def _score(qv: list[float], note_ids: list[str], mat) -> dict[str, float]:
    """Cosine of the query against every candidate block, one float32 matrix
    product; the best block per note. A query of another width than the index
    (the provider changed and the sweep has not caught up) scores nothing."""
    import numpy as np
    q = np.asarray(qv, dtype=np.float32)
    q_norm = float(np.linalg.norm(q))
    if mat is None or not note_ids or mat.shape[1] != q.size or q_norm <= 0:
        return {}
    # einsum, not np.linalg.norm(axis=1): the norm builds a squared copy of the
    # whole matrix first, which doubled the request's peak.
    norms = np.sqrt(np.einsum("ij,ij->i", mat, mat)) * q_norm
    dots = mat @ q
    scores = np.divide(dots, norms, out=np.zeros_like(dots), where=norms > 0)
    best: dict[str, float] = {}
    for nid, s in zip(note_ids, scores.tolist()):
        if s > best.get(nid, -1.0):
            best[nid] = s
    return best


# ── Failing open ─────────────────────────────────────────────────────────────
# ⚠️ PER-PROCESS state (the web pod is one process): after a failure, meaning
# search is skipped until `_paused_until`. A second process would pause
# separately; nothing breaks, each just pays its own first failure.

_pause_lock = threading.Lock()
_paused_until = 0.0


def _now() -> float:
    return time.monotonic()


def meaning_paused() -> bool:
    with _pause_lock:
        return _now() < _paused_until


def _fail_open(err: BaseException) -> None:
    """ONE log line per pause, naming the failure's CLASS only: never the query
    (member text) and never the provider's message (which can echo input)."""
    global _paused_until
    with _pause_lock:
        already = _now() < _paused_until
        _paused_until = _now() + PAUSE_AFTER_FAILURE_S
    if not already:
        log.warning("[note-semantic] meaning search failed (%s); served the lexical page,"
                    " meaning paused %ss", type(err).__name__, PAUSE_AFTER_FAILURE_S)


# ── The query embed's bounds (ruling D-H6) ───────────────────────────────────
# ⚰️ Armed, every 3+ word `GET /notes` query was one synchronous OpenAI embed
# bounded only by the 2 s timeout and the FAILURE pause above: the one wave-7
# vendor path with no per-member, per-day or concurrency limit and no cache
# (backend review I-1). Each call holds one of the web pod's shared pool
# workers and spends the shared OpenAI key's rate limit. Three bounds, and
# every one of them FAILS OPEN TO THE LEXICAL PAGE -- the search answers, only
# the meaning append is skipped:
#   (a) ONE query embed in flight per member (`_embedding_now`): a second
#       concurrent query-shaped request from the same member (a client with
#       overlapping type-ahead requests, a script) gets the lexical page;
#   (b) a bounded query-vector cache, `QUERY_CACHE_MAX` entries for
#       `QUERY_CACHE_TTL_S`, least recently used out first: re-typing a query or
#       paging back to it costs no second embed. ⛔ The MEMBER is in the key,
#       with the provider and the normalised query: a cache shared across
#       members would let one member time whether another searched the same
#       words in the last ten minutes. A provider switch misses (vectors from
#       two spaces are never compared);
#   (c) `QUERY_EMBEDS_PER_MEMBER_PER_DAY` embeds a member a day, on the durable
#       counter of ruling D-H5b (`daily_counters`, so a deploy does not reset
#       it). A cache hit is not an embed and is not counted. A counter that
#       cannot be read or written admits the embed -- the counter's own rule
#       (a cap that fails closed refuses every member on a busy database), and
#       (a), (b) and the 2 s timeout still hold.
# All three are consulted BEFORE the candidate read (backend re-review N5), so a
# refused query costs its pool worker no vector read and no matrix.
# ⚠️ (a) and (b) are PER-PROCESS: a second web process would double (a) and keep
# its own cache -- listed for the CLAUDE.md single-process roster.

_bounds_lock = threading.Lock()
_embedding_now: set[str] = set()
_query_cache: "OrderedDict[tuple[str, str, str], tuple[float, list[float]]]" = OrderedDict()


def _et_day() -> str:
    """The ET day the daily embed count is kept for."""
    from datetime import datetime
    from api.services.journal_two.timeutil import ET
    return datetime.now(ET).date().isoformat()


def _normalise_query(q: str) -> str:
    return " ".join((q or "").lower().split())


def _cached_vector(key: tuple[str, str, str]) -> list[float] | None:
    with _bounds_lock:
        entry = _query_cache.get(key)
        if entry is None:
            return None
        if _now() - entry[0] > QUERY_CACHE_TTL_S:
            del _query_cache[key]
            return None
        _query_cache.move_to_end(key)
        return entry[1]


def _remember_vector(key: tuple[str, str, str], vector: list[float]) -> None:
    with _bounds_lock:
        _query_cache[key] = (_now(), vector)
        _query_cache.move_to_end(key)
        while len(_query_cache) > max(0, QUERY_CACHE_MAX):
            _query_cache.popitem(last=False)


def clear_query_cache() -> None:
    """Forget every cached query vector (tests; an operator after a provider
    incident). Nothing in the product calls it."""
    with _bounds_lock:
        _query_cache.clear()


def _query_vector(user_id: str, provider: EmbeddingProvider, q: str,
                  read_candidates) -> tuple[list[float], tuple[list[str], Any]] | None:
    """`(vector, candidates)` for the query under ruling D-H6's three bounds, or
    None when a bound refused it or there is nothing to score (the caller then
    serves the lexical page). RAISES a provider failure, like the embed it
    wraps: `append_meaning_hits` decides failing open, and the member's
    in-flight slot is released either way.

    ⛔ `read_candidates` (no arguments -> `(note_ids, matrix)`) runs only once
    every refusal has been checked (backend re-review N5) -- the cache, the
    one-in-flight slot and the day's count, the count first as a READ -- so a
    refused query reads no vector and builds no matrix, and a member with
    nothing to score spends neither an embed nor a count. ⚰️ The candidates
    were read first: up to MAX_SEARCH_BLOCKS vectors into a ~12 MB matrix on a
    pool worker, for a query a bound then refused."""
    key = (str(user_id), provider.name, _normalise_query(q))
    hit = _cached_vector(key)                                  # (b)
    if hit is not None:
        candidates = read_candidates()
        return (hit, candidates) if candidates[0] else None
    with _bounds_lock:
        if key[0] in _embedding_now:                          # (a)
            return None
        _embedding_now.add(key[0])
    try:
        day = _et_day()
        if daily_counters.value(day, SCOPE_QUERY_EMBED, key[0]) >= QUERY_EMBEDS_PER_MEMBER_PER_DAY:
            return None                                        # (c), read before the candidates
        candidates = read_candidates()
        if not candidates[0]:
            return None
        refused = daily_counters.take(day, [daily_counters.Charge(      # (c), the atomic charge
            SCOPE_QUERY_EMBED, key[0], 1, QUERY_EMBEDS_PER_MEMBER_PER_DAY)])
        if refused is not None:
            return None
        vector = provider.embed([q], timeout=query_embed_timeout())[0]
        _remember_vector(key, vector)                          # (b)
        return vector, candidates
    finally:
        with _bounds_lock:
            _embedding_now.discard(key[0])


# ── Query-shape routing (ruling D-H3) ────────────────────────────────────────

_TICKER_TOKEN = re.compile(r"^\$[A-Za-z]{1,6}(?:[.\-][A-Za-z]{1,2})?$|^[A-Z]{2,5}(?:[.\-][A-Z]{1,2})?$")


def query_shape(q: str | None) -> str:
    """LEXICAL for two tokens or fewer, a quoted phrase, or any ticker-shaped
    token ($NVDA, NVDA, BRK.B); SEMANTIC for natural language of three tokens
    or more. ⛔ When in doubt, LEXICAL: it is what search did before, and a
    ticker query is exactly where meaning search would add noise."""
    s = (q or "").strip()
    if not s or '"' in s or "“" in s or "”" in s:
        return LEXICAL
    tokens = [t.strip(".,;:!?()[]") for t in s.split()]
    tokens = [t for t in tokens if t]
    if len(tokens) <= 2:
        return LEXICAL
    if any(_TICKER_TOKEN.match(t) for t in tokens):
        return LEXICAL
    return SEMANTIC


def append_meaning_hits(user_id: str, q: str | None, rows: list[dict[str, Any]], *,
                        total: int, offset: int, only_query: bool,
                        limit: int | None = None,
                        conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """The one hook in `GET /notes` (journal_two.py), AFTER its single
    `list_and_count_notes` call. Returns `rows`, or `rows` + meaning hits.

    ⛔ Order of refusals, each before any SQL or vendor call:
      1. dark -> the lexical rows, untouched (the handler's SQL is byte-identical
         to lane I's plan rail: this issues NONE);
      2. any other filter is set (folder, tag, ticker, trash, dates, sector or
         theme, property filter, saved view...) -> untouched: a meaning hit is a
         note-id LIST, never a bypass of the filters the lexical page was built
         under (for a filtered page the candidate set is EMPTY);
      3. not the first page, or the lexical answer spans pages, or the page has
         no room left under `limit` -> untouched: meaning is appended AFTER the
         lexical list, only on the page where that list ends, only when all of
         it is in hand to dedupe against, and never past the page size the
         client asked for (review M-5);
      4. query shape LEXICAL (<=2 tokens, quoted, ticker-shaped) -> untouched,
         and `search()` is never called;
      5. meaning search is paused after a recent failure -> untouched;
      6. one of ruling D-H6's bounds refuses the query embed (this member
         already has one in flight, or has used the day's count) -> untouched.
    Past the refusals it FAILS OPEN (review I-1): any exception -- the vendor,
    its timeout, the database -- returns `rows` unchanged, never a 500.
    Appended rows are the list's own projection, marked `matchKind: "meaning"`,
    active notes only, in meaning order, deduped by id. `total` stays the
    lexical count (the appended rows are extra, and say so by their mark)."""
    if not semantic_enabled():
        return rows
    if not only_query or offset or total > len(rows):
        return rows
    room = APPEND_K if limit is None else min(APPEND_K, max(0, limit - len(rows)))
    if room <= 0:
        return rows
    if query_shape(q) != SEMANTIC:
        return rows
    if meaning_paused():
        return rows
    try:
        extra = _meaning_rows(user_id, q or "", rows, room, conn)
        # Nothing to append (no hit, or a D-H6 bound refused the embed): the
        # lexical page itself, exactly as the handler built it.
        return rows + extra if extra else rows
    except Exception as err:  # noqa: BLE001 -- failing open IS the contract here
        _fail_open(err)
        return rows


def _meaning_rows(user_id: str, q: str, rows: list[dict[str, Any]], room: int,
                  conn: sqlite3.Connection | None) -> list[dict[str, Any]]:
    have = {r.get("id") for r in rows}
    hits = search(user_id, q, k=room * 2, conn=conn, exclude_note_ids=have)
    ids = [h["note_id"] for h in hits if h["note_id"] not in have][:room]
    if not ids:
        return []
    from api.services.journal_two import notes as notes_service
    owned = conn is None
    c = conn or get_connection()
    try:
        c.row_factory = sqlite3.Row
        marks = ",".join("?" * len(ids))
        found = {r["id"]: r for r in c.execute(
            f"SELECT {notes_service._NOTE_SUMMARY_COLS} FROM j2_notes"
            f" WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND id IN ({marks})",
            (user_id, *ids))}
    finally:
        if owned:
            c.close()
    extra = []
    for nid in ids:
        if nid in found:
            row = notes_service._row_to_note_summary(found[nid])
            row["matchKind"] = "meaning"
            extra.append(row)
    return extra
