"""AI Search Phase 2 — retrieval-memory "house brain".

Indexes the DE-IDENTIFIED, EVERGREEN answers captured by ai_search_log and blends
the most relevant prior desk research into new answers, alongside (never over) the
live grounding. So the desk compounds knowledge as members ask more.

Design: docs/superpowers/specs/2026-07-21-aisearch-brain-phase2-design.md
Reuses brain_kb_service's embedding + pack/unpack + numpy-matrix search pattern.

Isolation: own DB (AI_SEARCH_MEMORY_DB), own flag (AI_SEARCH_MEMORY_ENABLED, default
0 = dark). Every path is best-effort — a memory failure NEVER breaks or blocks an
answer. Retrieved memory is labeled "may be dated" so a stale figure can never
override fresh live data (the leakage firewall).
"""
from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone

log = logging.getLogger("ai_search_memory")

# Question types where prior evergreen research HELPS. Live-only types
# (why-move / options-flow / idea-screen / portfolio-risk) are excluded — memory
# would add staleness, not value.
_RETRIEVAL_ELIGIBLE = {
    "concept-education", "valuation", "compare", "setup-technical", "catalyst-news",
}
# Cosine floor — below this a match is noise; never inject it.
_MIN_SCORE = 0.34
_PIN_BOOST = 0.05

_LOCK = threading.Lock()
_MATRIX_CACHE: dict | None = None
_LAST_INDEX = 0.0
_INDEXING = False


def _enabled() -> bool:
    return os.environ.get("AI_SEARCH_MEMORY_ENABLED", "0") == "1"


def _index_db() -> str:
    return os.environ.get(
        "AI_SEARCH_MEMORY_DB",
        os.path.join(os.environ.get("DATA_DIR", "/data"), "ai_search_memory.db"),
    )


def _throttle_s() -> int:
    try:
        return max(30, int(os.environ.get("AI_SEARCH_MEMORY_INDEX_THROTTLE_S", "600")))
    except ValueError:
        return 600


def _reset_for_tests() -> None:
    global _MATRIX_CACHE, _LAST_INDEX, _INDEXING
    with _LOCK:
        _MATRIX_CACHE = None
        _LAST_INDEX = 0.0
        _INDEXING = False


def _connect() -> sqlite3.Connection:
    c = sqlite3.connect(_index_db(), check_same_thread=False, timeout=5)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    c.execute(
        """CREATE TABLE IF NOT EXISTS ais_memory (
            answer_id TEXT PRIMARY KEY,
            answer_hash TEXT, query TEXT, answer TEXT,
            primary_ticker TEXT, question_type TEXT,
            pinned INTEGER DEFAULT 0, citation_count INTEGER DEFAULT 0,
            embedding BLOB NOT NULL, model TEXT, created_at TEXT)"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_aism_hash ON ais_memory(answer_hash)")
    return c


# ── indexing (background, incremental) ───────────────────────────────────────
def _eligible_rows(log_db_path: str, known_ids: set) -> list[dict]:
    """Evergreen, ok, non-first-person, non-excluded answers not yet indexed.
    De-dup by answer_hash so the ~50 near-identical answers collapse to one."""
    out: list[dict] = []
    seen_hashes: set = set()
    try:
        with contextlib.closing(sqlite3.connect(log_db_path, timeout=5)) as c:
            c.row_factory = sqlite3.Row
            rows = c.execute(
                "SELECT answer_id, answer_hash, query, answer, primary_ticker, "
                "question_type, pinned, citation_count FROM ai_search_log "
                "WHERE freshness='evergreen' AND answer_kind='ok' AND first_person=0 "
                "AND excluded=0 AND answer IS NOT NULL AND answer <> '' "
                "ORDER BY id DESC LIMIT 5000"
            ).fetchall()
    except Exception:
        return out
    for r in rows:
        aid, h = r["answer_id"], r["answer_hash"]
        if not aid or aid in known_ids or (h and h in seen_hashes):
            continue
        seen_hashes.add(h)
        out.append(dict(r))
    return out


def reindex(*, embed_fn=None, batch_size: int = 128, log_db_path: str | None = None) -> dict:
    """Incrementally index newly-eligible evergreen answers; drop rows now excluded.
    Best-effort — returns a small stats dict, never raises."""
    stats = {"indexed": 0, "removed": 0, "total": 0}
    try:
        from api.services import ai_search_log
        from api.services.brain_kb_service import _default_embed, _pack
        embed_fn = embed_fn or _default_embed
        log_db = log_db_path or ai_search_log._db_path()

        with contextlib.closing(_connect()) as idx:
            known = {r[0] for r in idx.execute("SELECT answer_id FROM ais_memory")}
            todo = _eligible_rows(log_db, known)

            # Remove any indexed row that is now excluded or no longer eligible.
            still_ok: set = set()
            try:
                with contextlib.closing(sqlite3.connect(log_db, timeout=5)) as c:
                    still_ok = {row[0] for row in c.execute(
                        "SELECT answer_id FROM ai_search_log WHERE freshness='evergreen' "
                        "AND answer_kind='ok' AND first_person=0 AND excluded=0")}
            except Exception:
                still_ok = known  # if we can't check, don't delete
            for aid in list(known - still_ok):
                idx.execute("DELETE FROM ais_memory WHERE answer_id=?", (aid,))
                stats["removed"] += 1

            now = datetime.now(timezone.utc).isoformat()
            for i in range(0, len(todo), batch_size):
                batch = todo[i:i + batch_size]
                texts = [f"{r['query']}\n{r['answer']}"[:1800] for r in batch]
                vecs = embed_fn(texts)
                for r, vec in zip(batch, vecs):
                    idx.execute(
                        "INSERT OR REPLACE INTO ais_memory (answer_id, answer_hash, query, "
                        "answer, primary_ticker, question_type, pinned, citation_count, "
                        "embedding, model, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (r["answer_id"], r["answer_hash"], r["query"], r["answer"],
                         r["primary_ticker"], r["question_type"], r["pinned"] or 0,
                         r["citation_count"] or 0, _pack(vec), "text-embedding-3-small", now))
                    stats["indexed"] += 1
                idx.commit()
            idx.commit()
            stats["total"] = idx.execute("SELECT COUNT(*) FROM ais_memory").fetchone()[0]
        _reset_for_tests_matrix_only()
        if stats["indexed"] or stats["removed"]:
            log.info("ai_search_memory reindex: %s", stats)
    except Exception:
        log.exception("ai_search_memory reindex failed")
    return stats


def _reset_for_tests_matrix_only() -> None:
    global _MATRIX_CACHE
    with _LOCK:
        _MATRIX_CACHE = None


def _maybe_index() -> None:
    """Kick a throttled background reindex (daemon thread). Non-blocking — the
    brain warms opportunistically as questions come in; no main.py wiring."""
    global _LAST_INDEX, _INDEXING
    now = time.time()
    with _LOCK:
        if _INDEXING or now - _LAST_INDEX < _throttle_s():
            return
        _INDEXING = True
        _LAST_INDEX = now

    def _run():
        global _INDEXING
        try:
            reindex()
        finally:
            with _LOCK:
                _INDEXING = False

    threading.Thread(target=_run, daemon=True).start()


# ── search ───────────────────────────────────────────────────────────────────
def _matrix():
    global _MATRIX_CACHE
    import numpy as np
    path = _index_db()
    stamp = os.path.getmtime(path) if os.path.exists(path) else 0
    with _LOCK:
        if _MATRIX_CACHE and _MATRIX_CACHE["stamp"] == stamp:
            return _MATRIX_CACHE
    try:
        from api.services.brain_kb_service import _unpack
        with contextlib.closing(_connect()) as idx:
            rows = idx.execute(
                "SELECT answer_id, query, answer, primary_ticker, question_type, "
                "pinned, citation_count, embedding FROM ais_memory").fetchall()
        if not rows:
            cache = {"stamp": stamp, "mat": None, "meta": []}
        else:
            mat = np.array([_unpack(r[7]) for r in rows], dtype=np.float32)
            norms = np.linalg.norm(mat, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            mat = mat / norms
            meta = [{"answer_id": r[0], "query": r[1], "answer": r[2], "primary_ticker": r[3],
                     "question_type": r[4], "pinned": r[5], "citation_count": r[6]} for r in rows]
            cache = {"stamp": stamp, "mat": mat, "meta": meta}
    except Exception:
        cache = {"stamp": stamp, "mat": None, "meta": []}
    with _LOCK:
        _MATRIX_CACHE = cache
    return cache


def search(query: str, k: int = 3, *, embed_fn=None) -> list[dict]:
    """Top-k prior evergreen answers by cosine similarity (pinned boosted). []
    on empty index / error. Best-effort."""
    import numpy as np
    try:
        cache = _matrix()
        if cache["mat"] is None:
            return []
        from api.services.brain_kb_service import _default_embed
        embed_fn = embed_fn or _default_embed
        q = np.array(embed_fn([query])[0], dtype=np.float32)
        qn = np.linalg.norm(q)
        if qn == 0:
            return []
        scores = cache["mat"] @ (q / qn)
        boosted = scores + np.array([_PIN_BOOST if m["pinned"] else 0.0 for m in cache["meta"]],
                                    dtype=np.float32)
        out = []
        for i in np.argsort(-boosted)[:k]:
            i = int(i)
            if scores[i] < _MIN_SCORE:
                continue
            out.append({**cache["meta"][i], "score": float(scores[i])})
        return out
    except Exception:
        return []


# ── the blend (request-time) ─────────────────────────────────────────────────
def retrieve_context(query: str, question_type: str | None = None, *, embed_fn=None) -> str:
    """The memory block injected into the system prompt, or "".

    Returns "" unless the flag is on AND the question type benefits from prior
    research. Kicks a throttled background reindex so the brain keeps warming.
    Labeled "may be dated" so live grounding always wins on fresh figures."""
    if not _enabled():
        return ""
    if question_type not in _RETRIEVAL_ELIGIBLE:
        return ""
    try:
        _maybe_index()
        hits = search(query, k=3, embed_fn=embed_fn)
        if not hits:
            return ""
        lines = []
        for h in hits:
            a = (h.get("answer") or "").replace("\n", " ").strip()
            lines.append(f"- (Q: {(h.get('query') or '').strip()[:90]}) {a[:420]}")
        body = "\n".join(lines)
        return (
            "\n\nPRIOR DESK RESEARCH (the desk's own past answers on similar questions — "
            "CONTEXT ONLY, may be dated; the live UCT desk data above is authoritative for "
            "any current price / level / date — prefer it and re-verify):\n" + body
        )
    except Exception:
        return ""


def status() -> dict:
    """Small admin summary — index size, enabled flag, last index time."""
    out = {"enabled": _enabled(), "indexed": 0, "last_index_epoch": _LAST_INDEX}
    try:
        with contextlib.closing(_connect()) as idx:
            out["indexed"] = idx.execute("SELECT COUNT(*) FROM ais_memory").fetchone()[0]
    except Exception:
        pass
    return out
