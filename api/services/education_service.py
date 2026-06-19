"""SQLite store for Educational Videos — the firm's curated library of teaching
videos, organized into categories and surfaced on the paid Educational Videos tab.

DB path: /data/education.db (web service Railway volume).
Dashboard-OWNED storage. Mirrors api/services/modelbook_service.py: WAL mode,
_WRITE_LOCK on writes, contextlib.closing on every connection (Windows teardown
requires explicit close).

Videos are NOT hosted here — only their YouTube id + metadata. The library lives
unlisted on YouTube; the frontend embeds via youtube-nocookie.com. One table:
  edu_videos — one row per video (youtube_id + title + category + ordering).
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time
from typing import Optional

_DB_PATH = os.environ.get("EDUCATION_DB_PATH", "/data/education.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS edu_videos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_id  TEXT    NOT NULL,           -- the 11-char YouTube video id
  title       TEXT    NOT NULL,
  description TEXT,
  category    TEXT    NOT NULL DEFAULT 'General',
  duration    TEXT,                        -- free-text, e.g. "12:34" (optional)
  sort_order  INTEGER NOT NULL DEFAULT 0,  -- within a category
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_edu_videos_cat
  ON edu_videos(category, sort_order, id);
"""

# Fields a client may set (id, created_at, updated_at managed here).
_VIDEO_FIELDS = ("youtube_id", "title", "description", "category", "duration",
                 "sort_order")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


# ── Reads ──────────────────────────────────────────────────────────────────────

def list_videos() -> list[dict]:
    """Every video, ordered by category then sort_order (for the library view)."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT * FROM edu_videos
               ORDER BY category ASC, sort_order ASC, id ASC"""
        ).fetchall()
        return [dict(r) for r in rows]


def list_categories() -> list[str]:
    """Distinct category names that currently have at least one video."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT DISTINCT category FROM edu_videos ORDER BY category ASC"
        ).fetchall()
        return [r["category"] for r in rows]


def get_video(video_id: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM edu_videos WHERE id = ?", (int(video_id),)
        ).fetchone()
        return dict(row) if row else None


# ── Writes (admin) ─────────────────────────────────────────────────────────────

def create_video(payload: dict) -> dict:
    """Insert a video. Returns the created row."""
    now = int(time.time())
    data = {f: payload.get(f) for f in _VIDEO_FIELDS}
    data["youtube_id"] = (data.get("youtube_id") or "").strip()
    data["title"] = (data.get("title") or "").strip()
    data["category"] = (data.get("category") or "General").strip() or "General"
    data["sort_order"] = data.get("sort_order") or 0
    data["created_at"] = now
    data["updated_at"] = now
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            """INSERT INTO edu_videos
               (youtube_id, title, description, category, duration, sort_order,
                created_at, updated_at)
               VALUES (:youtube_id, :title, :description, :category, :duration,
                       :sort_order, :created_at, :updated_at)""",
            data,
        )
        c.commit()
        new_id = cur.lastrowid
    return get_video(new_id)


def update_video(video_id: int, payload: dict) -> Optional[dict]:
    """Patch any provided video fields. Unknown keys ignored. None if missing."""
    fields = {f: payload[f] for f in _VIDEO_FIELDS if f in payload}
    if not fields:
        return get_video(video_id)
    if "category" in fields:
        fields["category"] = (fields["category"] or "General").strip() or "General"
    fields["updated_at"] = int(time.time())
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["id"] = int(video_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            f"UPDATE edu_videos SET {set_clause} WHERE id = :id", fields
        )
        c.commit()
        if cur.rowcount == 0:
            return None
    return get_video(video_id)


def delete_video(video_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM edu_videos WHERE id = ?", (int(video_id),))
        c.commit()
        return cur.rowcount > 0


def reorder_category(category: str, ordered_ids: list[int]) -> None:
    """Set sort_order for videos in a category to match the given id order."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        for i, vid in enumerate(ordered_ids):
            c.execute(
                "UPDATE edu_videos SET sort_order = ?, updated_at = ? WHERE id = ? AND category = ?",
                (i, int(time.time()), int(vid), category),
            )
        c.commit()


# ── Seed (firm library) ─────────────────────────────────────────────────────────

def existing_youtube_ids() -> set[str]:
    """Set of youtube_ids already in the library."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT youtube_id FROM edu_videos").fetchall()
        return {r["youtube_id"] for r in rows}


def ensure_default_videos() -> None:
    """Idempotently seed the firm's workshop library from the curated roster
    (api/services/education_seed.py → SEED_VIDEOS). Inserts only videos whose
    youtube_id is not already present, so an admin who edits/recategorizes a
    video is never clobbered and re-runs on every boot never duplicate. On
    Railway this backfills the persistent /data/education.db on each deploy.
    Never raises."""
    try:
        from api.services.education_seed import SEED_VIDEOS
    except Exception:
        return
    try:
        have = existing_youtube_ids()
    except Exception:
        have = set()
    for v in SEED_VIDEOS:
        yt = (v.get("youtube_id") or "").strip()
        if not yt or yt in have:
            continue
        try:
            create_video(v)
            have.add(yt)
        except Exception:
            continue
