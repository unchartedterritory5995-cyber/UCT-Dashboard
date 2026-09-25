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

⚠️ PER-PROCESS: nothing. The index is durable (auth.db); the only state is the
gate, read per call.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import sqlite3
import struct
from typing import Any, Protocol

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


def _decode(blob: bytes) -> list[float]:
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


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


def run_sweep(*, conn: sqlite3.Connection | None = None,
              provider: EmbeddingProvider | None = None,
              max_embeds: int = MAX_EMBEDS_PER_SWEEP) -> dict[str, Any]:
    """Every member with notes, oldest-indexed first, until the run's budget is
    spent. ⛔ Dark: a no-op that touches nothing."""
    if not semantic_enabled():
        return {"skipped": "dark"}
    provider = provider or get_provider()
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        ensure_semantic_schema(conn)
        members = [r[0] for r in conn.execute(
            "SELECT n.user_id FROM j2_notes n"
            " LEFT JOIN (SELECT user_id, MAX(updated_at) AS at FROM j2_note_embeddings"
            "            GROUP BY user_id) e ON e.user_id = n.user_id"
            " WHERE n.deleted_at IS NULL GROUP BY n.user_id"
            " ORDER BY COALESCE(MAX(e.at), '') ASC, n.user_id ASC")]
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

def search(user_id: str, query: str, k: int = 10, *, conn: sqlite3.Connection | None = None,
           provider: EmbeddingProvider | None = None) -> list[dict[str, Any]]:
    """The member's notes closest in MEANING to `query`: `[{note_id, score}]`,
    best first, one entry per note (its best block), above the provider's floor.
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
        rows = conn.execute(
            "SELECT note_id, vector FROM j2_note_embeddings WHERE user_id = ?",
            (user_id,)).fetchall()
        if not rows:
            return []
        qv = provider.embed([q])[0]
        best: dict[str, float] = {}
        for r in rows:
            v = _decode(r["vector"])
            if len(v) != len(qv):
                continue      # a vector from another provider's space: re-embedded by the sweep
            s = _cosine(qv, v)
            if s > best.get(r["note_id"], -1.0):
                best[r["note_id"]] = s
        ranked = sorted((item for item in best.items() if item[1] >= provider.min_score),
                        key=lambda kv: (-kv[1], kv[0]))
        return [{"note_id": nid, "score": round(score, 4)} for nid, score in ranked[:max(0, k)]]
    finally:
        if owned:
            conn.close()


def _cosine(a: list[float], b: list[float]) -> float:
    dot = na = nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


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
                        conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """The one hook in `GET /notes` (journal_two.py), AFTER its single
    `list_and_count_notes` call. Returns `rows`, or `rows` + meaning hits.

    ⛔ Order of refusals, each before any SQL or vendor call:
      1. dark -> the lexical rows, untouched (the handler's SQL is byte-identical
         to lane I's plan rail: this issues NONE);
      2. any other filter is set (folder, tag, ticker, trash, dates, property,
         saved view...) -> untouched: a meaning hit is a note-id LIST, never a
         bypass of the filters the lexical page was built under;
      3. not the first page, or the lexical answer spans pages -> untouched:
         meaning is appended AFTER the lexical list, so only on the page where
         that list ends, and only when all of it is in hand to dedupe against;
      4. query shape LEXICAL (<=2 tokens, quoted, ticker-shaped) -> untouched,
         and `search()` is never called.
    Appended rows are the list's own projection, marked `matchKind: "meaning"`,
    active notes only, in meaning order, deduped by id."""
    if not semantic_enabled():
        return rows
    if not only_query or offset or total > len(rows):
        return rows
    if query_shape(q) != SEMANTIC:
        return rows
    hits = search(user_id, q or "", k=APPEND_K * 2, conn=conn)
    have = {r.get("id") for r in rows}
    ids = [h["note_id"] for h in hits if h["note_id"] not in have][:APPEND_K]
    if not ids:
        return rows
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
    return rows + extra
