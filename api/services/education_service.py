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

CREATE TABLE IF NOT EXISTS edu_video_progress (
  user_id     TEXT    NOT NULL,
  youtube_id  TEXT    NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,   -- seconds watched
  duration    INTEGER NOT NULL DEFAULT 0,   -- total seconds
  done        INTEGER NOT NULL DEFAULT 0,   -- 1 once finished (sticky)
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, youtube_id)
);

CREATE TABLE IF NOT EXISTS edu_video_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  youtube_id  TEXT    NOT NULL,
  t_seconds   INTEGER NOT NULL DEFAULT 0,    -- playhead the note was taken at
  text        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edu_video_notes_user_vid
  ON edu_video_notes(user_id, youtube_id, t_seconds);
"""

# Fields a client may set (id, created_at, updated_at managed here).
_VIDEO_FIELDS = ("youtube_id", "title", "description", "category", "duration",
                 "sort_order")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# Additive columns introduced after the original schema (Live Session chapters /
# transcript / ticker-moments). SQLite has no "ADD COLUMN IF NOT EXISTS", so each
# is ALTER-added on boot when missing. All nullable → old rows + non-session
# videos are unaffected.
_EXTRA_COLUMNS = (
    ("meeting_uuid", "TEXT"),       # Zoom meeting_uuid (session videos only) → transcript source
    ("transcript", "TEXT"),        # raw transcript text once captured
    ("chapters", "TEXT"),          # JSON: [{t: seconds, title}]
    ("ticker_moments", "TEXT"),    # JSON: [{ticker, t: seconds, note}]
    ("insights_at", "INTEGER"),    # last insights attempt (epoch); set = stop retrying
    ("zoom_cleaned", "INTEGER"),   # 1 once the Zoom cloud recording has been trashed
    ("headline", "TEXT"),          # one-line AI recap headline
    ("summary", "TEXT"),           # JSON: [str] key-takeaway bullets
    ("poster", "INTEGER"),         # 1 once the branded recap poster PNG has been rendered
)


def _migrate_columns(c: sqlite3.Connection) -> None:
    have = {r["name"] for r in c.execute("PRAGMA table_info(edu_videos)").fetchall()}
    for name, decl in _EXTRA_COLUMNS:
        if name not in have:
            c.execute(f"ALTER TABLE edu_videos ADD COLUMN {name} {decl}")


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        _migrate_columns(c)
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


# ── Watch progress (cross-device, per user) ─────────────────────────────────────

def get_user_progress(user_id: str) -> list[dict]:
    """Every progress row for a user: youtube_id, position, duration, done, updated_at."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT youtube_id, position, duration, done, updated_at "
            "FROM edu_video_progress WHERE user_id = ?",
            (str(user_id),),
        ).fetchall()
        return [dict(r) for r in rows]


def upsert_progress(user_id: str, youtube_id: str, position: int,
                    duration: int = 0, done: bool = False) -> None:
    """Record a user's position in a video. `done` is sticky and duration grows
    monotonically (so a stale 0 never wipes a known length)."""
    yt = (youtube_id or "").strip()
    if not user_id or not yt:
        return
    pos = max(0, int(position or 0))
    dur = max(0, int(duration or 0))
    dn = 1 if done else 0
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO edu_video_progress
                 (user_id, youtube_id, position, duration, done, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, youtube_id) DO UPDATE SET
                 position   = excluded.position,
                 duration   = MAX(edu_video_progress.duration, excluded.duration),
                 done       = MAX(edu_video_progress.done, excluded.done),
                 updated_at = excluded.updated_at""",
            (str(user_id), yt, pos, dur, dn, int(time.time())),
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
    seeds: list[dict] = []
    try:
        from api.services.education_seed import SEED_VIDEOS
        seeds.extend(SEED_VIDEOS)
    except Exception:
        pass
    try:  # channel uploads not in the workshop sheet
        from api.services.education_channel_seed import SEED_VIDEOS_CHANNEL
        seeds.extend(SEED_VIDEOS_CHANNEL)
    except Exception:
        pass
    try:  # "Interviews" + "Mental Game" tabs of the workbook
        from api.services.education_extra_seed import SEED_VIDEOS_EXTRA
        seeds.extend(SEED_VIDEOS_EXTRA)
    except Exception:
        pass
    if not seeds:
        return
    try:
        have = existing_youtube_ids()
    except Exception:
        have = set()
    for v in seeds:
        yt = (v.get("youtube_id") or "").strip()
        if not yt or yt in have:
            continue
        try:
            create_video(v)
            have.add(yt)
        except Exception:
            continue
    _migrate_seed_categories_once()
    _backfill_seed_meta_once(seeds)


# One-shot backfill of duration (+ blank description) onto already-seeded rows
# from the seed lists (which now carry both). Only fills EMPTY fields, so an
# admin edit is never clobbered. Flag-gated → runs once per version.
_META_BACKFILL_VERSION = "v1_durations"


def _backfill_seed_meta_once(seeds: list[dict]) -> None:
    flag = os.path.join(os.path.dirname(_DB_PATH) or ".",
                        f".edu_meta_backfill_{_META_BACKFILL_VERSION}")
    try:
        if os.path.exists(flag):
            return
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            now = int(time.time())
            for v in seeds:
                yt = (v.get("youtube_id") or "").strip()
                dur = (v.get("duration") or "").strip()
                desc = (v.get("description") or "").strip()
                if dur:
                    c.execute(
                        "UPDATE edu_videos SET duration = ?, updated_at = ? "
                        "WHERE youtube_id = ? AND (duration IS NULL OR duration = '')",
                        (dur, now, yt),
                    )
                if desc:
                    c.execute(
                        "UPDATE edu_videos SET description = ?, updated_at = ? "
                        "WHERE youtube_id = ? AND (description IS NULL OR description = '')",
                        (desc, now, yt),
                    )
            c.commit()
        with open(flag, "w") as f:
            f.write(_META_BACKFILL_VERSION)
    except Exception:
        pass


# Renames applied once to already-seeded videos (the seed file itself carries the
# new names, so only pre-existing prod rows need this). Each entry runs exactly
# once via a flag file on the DB volume. Scoped to the seed's own youtube_ids and
# only rows STILL in the old category, so an admin who recategorized a video is
# never touched.
_CATEGORY_RENAMES: dict[str, str] = {
    "Guest Sessions & Interviews": "Interviews",
}
_CATEGORY_MIGRATION_VERSION = "v1_interviews"


def _migrate_seed_categories_once() -> None:
    flag = os.path.join(os.path.dirname(_DB_PATH) or ".",
                        f".edu_cat_migrate_{_CATEGORY_MIGRATION_VERSION}")
    try:
        if os.path.exists(flag):
            return
        from api.services.education_seed import SEED_VIDEOS
        seed_ids = [v["youtube_id"] for v in SEED_VIDEOS]
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            ph = ",".join("?" for _ in seed_ids)
            for old, new in _CATEGORY_RENAMES.items():
                c.execute(
                    f"UPDATE edu_videos SET category = ?, updated_at = ? "
                    f"WHERE category = ? AND youtube_id IN ({ph})",
                    [new, int(time.time()), old, *seed_ids],
                )
            c.commit()
        with open(flag, "w") as f:
            f.write(_CATEGORY_MIGRATION_VERSION)
    except Exception:
        pass


# ── Session insights (chapters / transcript / ticker-moments) ───────────────────
# Powers the Live Trading Session chapter rail + scrubber markers + ticker chips.
# All additive; non-session videos simply never get a meeting_uuid so they're
# skipped by the backfill and these reads return empty.

import json as _json  # local alias; module already minimal


def get_video_by_youtube_id(youtube_id: str) -> Optional[dict]:
    yt = (youtube_id or "").strip()
    if not yt:
        return None
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM edu_videos WHERE youtube_id = ? ORDER BY id ASC LIMIT 1",
            (yt,),
        ).fetchone()
        return dict(row) if row else None


def set_meeting_uuid(video_id: int, meeting_uuid: str) -> None:
    """Link a published video back to its Zoom recording (for transcript backfill)."""
    mu = (meeting_uuid or "").strip()
    if not mu:
        return
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "UPDATE edu_videos SET meeting_uuid = ?, updated_at = ? WHERE id = ?",
            (mu, int(time.time()), int(video_id)),
        )
        c.commit()


def get_insights(video_id: int) -> dict:
    """Chapters + ticker-moments + recap (headline/summary/poster) for the player
    UI. Always returns the full shape (empty when none yet) so the frontend can
    render-or-skip without null juggling."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT chapters, ticker_moments, transcript, headline, summary, poster "
            "FROM edu_videos WHERE id = ?",
            (int(video_id),),
        ).fetchone()
    if not row:
        return {"chapters": [], "ticker_moments": [], "has_transcript": False,
                "headline": "", "summary": [], "has_poster": False}

    def _parse(s):
        try:
            v = _json.loads(s) if s else []
            return v if isinstance(v, list) else []
        except Exception:
            return []
    return {
        "chapters": _parse(row["chapters"]),
        "ticker_moments": _parse(row["ticker_moments"]),
        "has_transcript": bool(row["transcript"]),
        "headline": row["headline"] or "",
        "summary": _parse(row["summary"]),
        "has_poster": bool(row["poster"]),
    }


def set_video_insights(video_id: int, *, transcript: Optional[str] = None,
                       chapters: Optional[list] = None,
                       ticker_moments: Optional[list] = None,
                       headline: Optional[str] = None,
                       summary: Optional[list] = None,
                       poster: Optional[bool] = None) -> None:
    """Store generated insights (chapters / ticker-moments / transcript / recap
    headline + summary / poster flag) + stamp insights_at."""
    sets = {"insights_at": int(time.time()), "updated_at": int(time.time())}
    if transcript is not None:
        sets["transcript"] = transcript
    if chapters is not None:
        sets["chapters"] = _json.dumps(chapters)
    if ticker_moments is not None:
        sets["ticker_moments"] = _json.dumps(ticker_moments)
    if headline is not None:
        sets["headline"] = headline
    if summary is not None:
        sets["summary"] = _json.dumps(summary)
    if poster is not None:
        sets["poster"] = 1 if poster else 0
    clause = ", ".join(f"{k} = :{k}" for k in sets)
    sets["id"] = int(video_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(f"UPDATE edu_videos SET {clause} WHERE id = :id", sets)
        c.commit()


def mark_insights_attempt(video_id: int) -> None:
    """Stamp insights_at without storing chapters — the 'we tried, give up / wait'
    marker (mirrors the catalysts_at idiom) so the backfill stops looping."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "UPDATE edu_videos SET insights_at = ?, updated_at = ? WHERE id = ?",
            (int(time.time()), int(time.time()), int(video_id)),
        )
        c.commit()


def mark_zoom_cleaned(video_id: int) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "UPDATE edu_videos SET zoom_cleaned = 1, updated_at = ? WHERE id = ?",
            (int(time.time()), int(video_id)),
        )
        c.commit()


def videos_pending_insights(max_age_secs: int) -> list[dict]:
    """Session videos (have a meeting_uuid) whose Zoom recording hasn't been
    cleaned yet and were published within max_age_secs — the backfill work-list.
    Ordered oldest-first so we drain the queue deterministically."""
    cutoff = int(time.time()) - int(max_age_secs)
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT id, youtube_id, title, meeting_uuid, created_at, chapters,
                      insights_at, zoom_cleaned
               FROM edu_videos
               WHERE meeting_uuid IS NOT NULL AND meeting_uuid != ''
                 AND COALESCE(zoom_cleaned, 0) = 0
                 AND created_at >= ?
               ORDER BY created_at ASC""",
            (cutoff,),
        ).fetchall()
        return [dict(r) for r in rows]


# ── Per-user timestamped video notes ─────────────────────────────────────────────
# Lightweight "jot a thought at MM:SS" notes for any video; click a note to jump
# back. A separate "send to Notebook" action (frontend) bundles them into a J2 note.

def list_video_notes(user_id: str, youtube_id: str) -> list[dict]:
    yt = (youtube_id or "").strip()
    if not user_id or not yt:
        return []
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT id, youtube_id, t_seconds, text, created_at
               FROM edu_video_notes
               WHERE user_id = ? AND youtube_id = ?
               ORDER BY t_seconds ASC, id ASC""",
            (str(user_id), yt),
        ).fetchall()
        return [dict(r) for r in rows]


def create_video_note(user_id: str, youtube_id: str, t_seconds: int, text: str) -> Optional[dict]:
    yt = (youtube_id or "").strip()
    body = (text or "").strip()[:2000]
    if not user_id or not yt or not body:
        return None
    now = int(time.time())
    t = max(0, int(t_seconds or 0))
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            """INSERT INTO edu_video_notes (user_id, youtube_id, t_seconds, text, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (str(user_id), yt, t, body, now),
        )
        c.commit()
        new_id = cur.lastrowid
    return {"id": new_id, "youtube_id": yt, "t_seconds": t, "text": body, "created_at": now}


def delete_video_note(user_id: str, note_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            "DELETE FROM edu_video_notes WHERE id = ? AND user_id = ?",
            (int(note_id), str(user_id)),
        )
        c.commit()
        return cur.rowcount > 0
