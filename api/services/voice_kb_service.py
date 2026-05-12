"""
Trading Knowledge Base service. Loads the curated corpus from
api/data/voice_kb/trading_principles.json, indexes each entry as a
kb_chunk in voice_embeddings, and exposes a lookup helper.

The KB is shared across all users (no per-user filter) but stored in the
same embeddings table with kind='kb_chunk' and source_id = numeric hash
of the entry's id. We seed on a magic user_id sentinel.
"""

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Iterable

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

_KB_PATH = Path(__file__).parent.parent / "data" / "voice_kb" / "trading_principles.json"

# Sentinel user_id for the shared KB. Any real user_id is a UUID; this
# string is reserved.
KB_USER_ID = "__voice_kb__"


def _ensure_kb_sentinel_user() -> None:
    """KB embeddings live under a sentinel user_id; the FK on
    voice_embeddings.user_id → users(id) requires a row to exist. Idempotent."""
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM users WHERE id = ?", (KB_USER_ID,),
        ).fetchone()
        if existing:
            return
        # Minimal fields: just enough to satisfy the FK. The user is never
        # logged in as.
        try:
            conn.execute(
                "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
                (KB_USER_ID, f"{KB_USER_ID}@uct.local", "!"),
            )
            conn.commit()
        except Exception:
            # Email might be UNIQUE — fall back to NULL where allowed
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO users (id) VALUES (?)", (KB_USER_ID,),
                )
                conn.commit()
            except Exception:
                pass
    finally:
        conn.close()


def _entry_source_id(entry_id: str) -> int:
    """Deterministic integer from a string id, fits in SQLite INTEGER."""
    h = hashlib.sha256(entry_id.encode("utf-8")).digest()
    return int.from_bytes(h[:6], "little")  # 48 bits, safely positive


def load_corpus() -> list[dict]:
    """Read and return all KB entries from the JSON file. Empty if missing."""
    if not _KB_PATH.exists():
        return []
    try:
        with open(_KB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        _log.warning("[voice_kb] failed to load %s: %s", _KB_PATH, e)
        return []
    entries = data.get("entries") or []
    return [e for e in entries if isinstance(e, dict) and e.get("id") and e.get("text")]


def _format_entry_for_embedding(entry: dict) -> str:
    """Compose a single chunk of text per entry — title + category + body."""
    title = (entry.get("title") or "").strip()
    cat = (entry.get("category") or "").strip().replace("_", " ")
    body = (entry.get("text") or "").strip()
    parts = []
    if title:
        parts.append(title)
    if cat:
        parts.append(f"({cat})")
    if body:
        parts.append(body)
    return " ".join(parts)


def index_corpus(*, force: bool = False) -> dict:
    """
    Index every KB entry into voice_embeddings as kind='kb_chunk' under the
    KB_USER_ID sentinel. Idempotent: skips entries already indexed unless
    force=True.

    Returns {indexed, skipped, errors}.
    """
    from api.services.voice_embeddings_service import index_text, delete_source

    entries = load_corpus()
    counts = {"indexed": 0, "skipped": 0, "errors": 0}
    if not entries:
        _log.info("[voice_kb] corpus is empty; nothing to index")
        return counts

    _ensure_kb_sentinel_user()

    conn = get_connection()
    try:
        existing = set()
        for r in conn.execute(
            "SELECT source_id FROM voice_embeddings WHERE user_id = ? AND kind = 'kb_chunk'",
            (KB_USER_ID,),
        ).fetchall():
            existing.add(r["source_id"])
    finally:
        conn.close()

    for entry in entries:
        sid = _entry_source_id(entry["id"])
        if not force and sid in existing:
            counts["skipped"] += 1
            continue
        if force:
            try:
                delete_source(kind="kb_chunk", source_id=sid)
            except Exception:
                pass
        text = _format_entry_for_embedding(entry)
        try:
            rid = index_text(KB_USER_ID, kind="kb_chunk", source_id=sid, text=text)
            if rid is None:
                counts["errors"] += 1
            else:
                counts["indexed"] += 1
        except Exception as e:  # noqa: BLE001
            _log.warning("[voice_kb] index failed for %s: %s", entry.get("id"), e)
            counts["errors"] += 1
    _log.info("[voice_kb] index_corpus: %s", counts)
    return counts


def lookup(query: str, *, k: int = 3) -> list[dict]:
    """
    Semantic search the trading KB. Returns up to k entries with their
    embedding score, joined back to the original JSON metadata.

    Each result: {id, title, category, text, score}.
    """
    from api.services.voice_embeddings_service import search
    hits = search(KB_USER_ID, query, k=max(1, min(10, int(k))), kind="kb_chunk")
    if not hits:
        return []
    # Build lookup from source_id → entry
    by_sid = {}
    for entry in load_corpus():
        by_sid[_entry_source_id(entry["id"])] = entry
    out = []
    for h in hits:
        entry = by_sid.get(h["source_id"])
        if entry is None:
            # Embedding exists but source removed — still useful via .text
            out.append({
                "id": str(h["source_id"]), "title": "(unknown)",
                "category": "(unknown)", "text": h["text"],
                "score": h["score"],
            })
            continue
        out.append({
            "id": entry.get("id"),
            "title": entry.get("title"),
            "category": entry.get("category"),
            "text": entry.get("text"),
            "score": h["score"],
        })
    return out


def seed_on_startup() -> None:
    """Called once at app startup. No-op if corpus already indexed."""
    try:
        counts = index_corpus(force=False)
        if counts["indexed"] > 0:
            _log.info("[voice_kb] seeded %d new KB chunks on startup", counts["indexed"])
    except Exception as e:  # noqa: BLE001
        _log.warning("[voice_kb] seed_on_startup failed: %s", e)
