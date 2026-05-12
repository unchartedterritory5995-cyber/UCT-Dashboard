"""
Voice embeddings service — RAG foundation for the assistant's memory.

We embed every fact, session summary, journal entry (later), and KB chunk
(later) using OpenAI text-embedding-3-small (1536 dims, $0.02/1M tokens).
Embeddings are stored as raw BLOBs in voice_embeddings; cosine similarity
runs in-process via numpy. This scales fine to ~100k vectors per user.

Public surface:
  - index_text(user_id, kind, source_id, text) → embed + insert
  - reindex_source(kind, source_id, text) → re-embed (e.g. on update)
  - delete_source(kind, source_id) → drop a row's embedding
  - search(user_id, query, *, k=5, kind=None) → top-K {source_id, text, score}
  - kinds: 'fact', 'summary', 'journal_entry', 'transcript', 'kb_chunk'
"""

import logging
import struct
from typing import Iterable

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
KINDS = frozenset(["fact", "summary", "journal_entry", "transcript", "kb_chunk"])

# Max chars per embedding chunk. text-embedding-3-small handles 8191 tokens
# (~32k chars) but shorter is cleaner for retrieval signal.
MAX_CHUNK_CHARS = 1500


def _encode_vector(vec: list[float]) -> bytes:
    """Pack a list of floats into a compact little-endian float32 blob."""
    return struct.pack(f"<{len(vec)}f", *vec)


def _decode_vector(blob: bytes) -> list[float]:
    n = len(blob) // 4
    return list(struct.unpack(f"<{n}f", blob))


def embed_text(text: str) -> list[float]:
    """Call OpenAI embeddings API. Caller handles caching/storage."""
    text = (text or "").strip()
    if not text:
        raise ValueError("text is empty")
    if len(text) > MAX_CHUNK_CHARS:
        text = text[:MAX_CHUNK_CHARS]
    from api.services.voice_openai import _get_client
    client = _get_client()
    resp = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return list(resp.data[0].embedding)


def _cosine(a: list[float], b: list[float]) -> float:
    """Pure-Python cosine for ~1500-dim vectors. Fast enough for thousands."""
    if len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / ((na ** 0.5) * (nb ** 0.5))


def index_text(user_id: str, *, kind: str, source_id: int | None,
               text: str) -> int | None:
    """Embed `text` and insert. Returns embedding row id (or None on empty/err)."""
    if kind not in KINDS:
        raise ValueError(f"unknown kind: {kind!r}")
    t = (text or "").strip()
    if not t:
        return None
    try:
        vec = embed_text(t)
    except Exception as e:  # noqa: BLE001
        _log.warning("[voice_embeddings] embed failed kind=%s id=%s: %s",
                     kind, source_id, e)
        return None
    blob = _encode_vector(vec)
    conn = get_connection()
    try:
        cur = conn.execute(
            """
            INSERT INTO voice_embeddings (user_id, kind, source_id, text, embedding, model)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, kind, source_id, t[:MAX_CHUNK_CHARS], blob, EMBEDDING_MODEL),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def reindex_source(user_id: str, *, kind: str, source_id: int,
                   text: str) -> int | None:
    """Drop old embedding for (kind, source_id) and re-embed."""
    if kind not in KINDS:
        raise ValueError(f"unknown kind: {kind!r}")
    delete_source(kind=kind, source_id=source_id)
    return index_text(user_id, kind=kind, source_id=source_id, text=text)


def delete_source(*, kind: str, source_id: int) -> int:
    """Remove every embedding row for a given (kind, source_id). Returns count."""
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM voice_embeddings WHERE kind = ? AND source_id = ?",
            (kind, source_id),
        )
        conn.commit()
        return result.rowcount or 0
    finally:
        conn.close()


def search(user_id: str, query: str, *, k: int = 5,
           kind: str | None = None) -> list[dict]:
    """
    Return top-K embeddings most similar to `query`, optionally filtered by kind.
    Each result: {id, kind, source_id, text, score, created_at}.
    """
    q = (query or "").strip()
    if not q:
        return []
    try:
        qvec = embed_text(q)
    except Exception as e:  # noqa: BLE001
        _log.warning("[voice_embeddings] search embed failed: %s", e)
        return []
    conn = get_connection()
    try:
        sql = """
            SELECT id, kind, source_id, text, embedding, created_at
              FROM voice_embeddings
             WHERE user_id = ?
        """
        params: list = [user_id]
        if kind:
            sql += " AND kind = ?"
            params.append(kind)
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()

    scored = []
    for r in rows:
        try:
            vec = _decode_vector(r["embedding"])
            score = _cosine(qvec, vec)
            scored.append({
                "id": r["id"], "kind": r["kind"],
                "source_id": r["source_id"], "text": r["text"],
                "score": round(score, 4), "created_at": r["created_at"],
            })
        except Exception:  # noqa: BLE001
            continue
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[: max(1, min(50, int(k)))]


def reindex_user(user_id: str, *, kinds: Iterable[str] | None = None) -> dict:
    """
    Backfill embeddings for a user.
    Currently covers facts + summaries (cheap, ~few hundred per user).
    Journal entries + transcripts are large-volume and handled by a
    separate background reindex later (Batch 8c).

    Returns {indexed, skipped, errors}.
    """
    target_kinds = set(kinds) if kinds else {"fact", "summary"}
    counts = {"indexed": 0, "skipped": 0, "errors": 0}

    conn = get_connection()
    try:
        existing = set()
        for r in conn.execute(
            "SELECT kind, source_id FROM voice_embeddings WHERE user_id = ?",
            (user_id,),
        ).fetchall():
            existing.add((r["kind"], r["source_id"]))

        rows_to_embed: list[tuple[str, int, str]] = []
        if "fact" in target_kinds:
            for r in conn.execute(
                "SELECT id, text FROM user_voice_facts WHERE user_id = ?",
                (user_id,),
            ).fetchall():
                if ("fact", r["id"]) not in existing:
                    rows_to_embed.append(("fact", r["id"], r["text"] or ""))
        if "summary" in target_kinds:
            for r in conn.execute(
                "SELECT id, summary_text FROM voice_session_summaries WHERE user_id = ?",
                (user_id,),
            ).fetchall():
                if ("summary", r["id"]) not in existing:
                    rows_to_embed.append(("summary", r["id"], r["summary_text"] or ""))
    finally:
        conn.close()

    for kind, sid, text in rows_to_embed:
        if not text.strip():
            counts["skipped"] += 1
            continue
        try:
            rid = index_text(user_id, kind=kind, source_id=sid, text=text)
            if rid is None:
                counts["errors"] += 1
            else:
                counts["indexed"] += 1
        except Exception:  # noqa: BLE001
            counts["errors"] += 1
    return counts
