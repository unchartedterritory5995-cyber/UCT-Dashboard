"""Semantic index over the Brain Pack's knowledge_base for ask_the_brain.

v1 is retrieval-only: return the top-k cited passages and let the CALLING
model (Realtime voice / Sonnet chat) synthesize — no nested LLM call.

Index lives OUTSIDE the swapped pack dir (survives pack installs):
    <DATA_DIR>/brain_index.db   (env BRAIN_INDEX_DB overrides)
Search uses an in-memory float32 numpy matrix (module cache) — ~10k chunks
x 1536 dims ~= 60 MB, matvec < 50 ms.
"""
from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
import struct
import threading
from datetime import datetime, timezone

log = logging.getLogger("brain_kb")

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
MAX_CHUNK_CHARS = 1500

_LOCK = threading.Lock()
_MATRIX_CACHE: dict | None = None  # {"stamp": float, "ids": [...], "mat": np.ndarray, "meta": {id: row}}


def _index_path() -> str:
    return os.environ.get(
        "BRAIN_INDEX_DB",
        os.path.join(os.environ.get("DATA_DIR", "/data"), "brain_index.db"),
    )


def _brain_db_path() -> str:
    from api.services import brain_sync
    return os.path.join(brain_sync.brain_dir(), "data", "uct_intelligence.db")


def _reset_for_tests() -> None:
    global _MATRIX_CACHE
    with _LOCK:
        _MATRIX_CACHE = None


def _connect_index() -> sqlite3.Connection:
    c = sqlite3.connect(_index_path(), check_same_thread=False)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    c.execute("""CREATE TABLE IF NOT EXISTS brain_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kb_id INTEGER NOT NULL, chunk_no INTEGER NOT NULL,
        title TEXT, category TEXT, trader TEXT, source TEXT,
        content_hash TEXT NOT NULL, text TEXT NOT NULL,
        embedding BLOB NOT NULL, model TEXT NOT NULL, created_at TEXT,
        UNIQUE(kb_id, chunk_no))""")
    return c


def _pack(vec) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


def _unpack(blob: bytes):
    n = len(blob) // 4
    return struct.unpack(f"<{n}f", blob)


def _default_embed(texts: list[str]) -> list[list[float]]:
    from api.services.voice_openai import _get_client
    client = _get_client()
    resp = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [d.embedding for d in resp.data]


def _chunk(title: str, content: str) -> list[str]:
    text = f"{title}\n{content}".strip()
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    out, buf = [], ""
    for para in text.split("\n"):
        if len(buf) + len(para) + 1 > MAX_CHUNK_CHARS and buf:
            out.append(buf)
            buf = f"{title}\n"  # keep the title on every chunk for retrieval quality
        buf = (buf + "\n" + para).strip()
    if buf:
        out.append(buf)
    return out


def reindex(*, embed_fn=None, batch_size: int = 128) -> dict:
    """Incrementally (re)build the index from the installed pack's KB."""
    embed_fn = embed_fn or _default_embed
    src = sqlite3.connect(_brain_db_path())
    src.row_factory = sqlite3.Row
    rows = src.execute(
        "SELECT id, category, title, content, trader, source FROM knowledge_base"
        " WHERE active = 1"
    ).fetchall()
    src.close()

    idx = _connect_index()
    existing = {(r[0], r[1]): r[2] for r in
                idx.execute("SELECT kb_id, chunk_no, content_hash FROM brain_chunks")}
    live_keys, todo = set(), []
    for r in rows:
        for chunk_no, text in enumerate(_chunk(r["title"] or "", r["content"] or "")):
            key = (r["id"], chunk_no)
            live_keys.add(key)
            h = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if existing.get(key) == h:
                continue
            todo.append((key, h, text, r))

    indexed = 0
    for i in range(0, len(todo), batch_size):
        batch = todo[i:i + batch_size]
        vecs = embed_fn([t[2] for t in batch])
        now = datetime.now(timezone.utc).isoformat()
        for ((kb_id, chunk_no), h, text, r), vec in zip(batch, vecs):
            idx.execute(
                "INSERT INTO brain_chunks (kb_id, chunk_no, title, category, trader,"
                " source, content_hash, text, embedding, model, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(kb_id, chunk_no) DO UPDATE SET content_hash=excluded.content_hash,"
                " text=excluded.text, embedding=excluded.embedding, title=excluded.title,"
                " category=excluded.category, trader=excluded.trader, source=excluded.source",
                (kb_id, chunk_no, r["title"], r["category"], r["trader"], r["source"],
                 h, text, _pack(vec), EMBEDDING_MODEL, now))
            indexed += 1
        idx.commit()

    deleted = 0
    for key in set(existing) - live_keys:
        idx.execute("DELETE FROM brain_chunks WHERE kb_id = ? AND chunk_no = ?", key)
        deleted += 1
    idx.commit()
    total = idx.execute("SELECT COUNT(*) FROM brain_chunks").fetchone()[0]
    idx.close()
    _reset_for_tests()
    skipped = len(live_keys) - indexed
    log.info("brain reindex: indexed=%s skipped=%s deleted=%s total=%s",
             indexed, skipped, deleted, total)
    return {"indexed": indexed, "skipped": skipped, "deleted": deleted, "total": total}


def _matrix():
    global _MATRIX_CACHE
    import numpy as np
    stamp = os.path.getmtime(_index_path()) if os.path.exists(_index_path()) else 0
    with _LOCK:
        if _MATRIX_CACHE and _MATRIX_CACHE["stamp"] == stamp:
            return _MATRIX_CACHE
        idx = _connect_index()
        rows = idx.execute("SELECT id, kb_id, title, category, trader, source, text,"
                           " embedding FROM brain_chunks").fetchall()
        idx.close()
        if not rows:
            _MATRIX_CACHE = {"stamp": stamp, "ids": [], "mat": None, "meta": {}}
            return _MATRIX_CACHE
        mat = np.array([_unpack(r[7]) for r in rows], dtype=np.float32)
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        mat = mat / norms
        meta = {r[0]: {"kb_id": r[1], "title": r[2], "category": r[3],
                       "trader": r[4], "source": r[5], "text": r[6]} for r in rows}
        _MATRIX_CACHE = {"stamp": stamp, "ids": [r[0] for r in rows], "mat": mat, "meta": meta}
        return _MATRIX_CACHE


def search(query: str, k: int = 6, *, embed_fn=None) -> list[dict]:
    import numpy as np
    cache = _matrix()
    if cache["mat"] is None:
        return []
    embed_fn = embed_fn or _default_embed
    q = np.array(embed_fn([query])[0], dtype=np.float32)
    qn = np.linalg.norm(q)
    if qn == 0:
        return []
    scores = cache["mat"] @ (q / qn)
    top = np.argsort(-scores)[:k]
    out = []
    for i in top:
        cid = cache["ids"][int(i)]
        m = cache["meta"][cid]
        out.append({**{kk: m[kk] for kk in ("kb_id", "title", "category", "trader", "source")},
                    "score": float(scores[int(i)]), "text": m["text"]})
    return out


def ask_the_brain(question: str, k: int = 6, *, embed_fn=None) -> dict:
    try:
        hits = search(question, k=k, embed_fn=embed_fn)
    except Exception as e:
        log.exception("ask_the_brain failed")
        return {"ok": False, "error": str(e)}
    if not hits:
        return {"ok": False, "reason": "brain index empty — run reindex"}
    passages = [{
        "title": h["title"], "category": h["category"], "trader": h["trader"] or "firm KB",
        "source": h["source"] or f"KB #{h['kb_id']}", "score": round(h["score"], 3),
        "excerpt": h["text"][:900],
    } for h in hits]
    return {"ok": True, "question": question, "passages": passages,
            "note": "synthesize from these passages and cite the sources by title/trader"}
