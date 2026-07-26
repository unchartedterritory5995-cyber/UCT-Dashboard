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

# Deep-search index staleness flag (see api/services/education_search.py).
# Write paths only SET this — they never rebuild the index synchronously
# (rebuild acquires _WRITE_LOCK, which is NON-reentrant and already held by
# every writer). The next search() call notices the flag and rebuilds.
# Starts True so a fresh process always rebuilds on its first search (covers
# writes from a prior process that died before searching).
_search_dirty = True


def _mark_search_dirty() -> None:
    global _search_dirty
    _search_dirty = True

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

CREATE TABLE IF NOT EXISTS edu_categories (
  name        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'library',   -- 'show' | 'library'
  sort_order  INTEGER NOT NULL DEFAULT 0,        -- within kind
  blurb       TEXT,
  created_at  INTEGER NOT NULL
);
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
    ("key_levels", "TEXT"),        # DEPRECATED (removed 2026-07-11): dormant, no longer written/read
    ("setups", "TEXT"),            # JSON: [{setup, note, t}] firm-taxonomy setups taught
    ("poster", "INTEGER"),         # 1 once the branded recap poster PNG has been rendered
    ("audio_url", "TEXT"),         # R2 object key for the extracted background-audio track (NULL = none yet)
    ("audio_at", "INTEGER"),       # epoch when the audio track was produced
    ("tags", "TEXT"),              # JSON: ["risk", ...] — filter chips
    ("episode_label", "TEXT"),     # normalized "S12 · E9" / "E42.4" self-identified episode tag
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


def list_recent_recap_candidates(category: str, days: int = 4) -> list[dict]:
    """Recent videos in `category` that carry a transcript — the source list for
    the terminal/subscription daily-recap job. Read-only, no LLM. Newest first."""
    cutoff = int(time.time()) - int(days) * 86400
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT id, youtube_id, title, category, created_at, "
            "       length(COALESCE(transcript,'')) AS tlen "
            "FROM edu_videos "
            "WHERE category = ? AND created_at >= ? "
            "ORDER BY id DESC",
            (category, cutoff),
        ).fetchall()
    return [{
        "id": r["id"], "youtube_id": r["youtube_id"], "title": r["title"],
        "category": r["category"], "created_at": r["created_at"],
        "has_transcript": bool(r["tlen"]),
    } for r in rows]


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
    _mark_search_dirty()
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
    _mark_search_dirty()
    return get_video(video_id)


def delete_video(video_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM edu_videos WHERE id = ?", (int(video_id),))
        c.commit()
        deleted = cur.rowcount > 0
    if deleted:
        _mark_search_dirty()
    return deleted


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


# ── Category metadata (Shows + Library taxonomy) ────────────────────────────────

_CATEGORY_KINDS = ("show", "library")


def list_category_meta() -> list[dict]:
    """All category meta rows: shows first, then library, each by sort_order."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT name, kind, sort_order, blurb FROM edu_categories
               ORDER BY CASE kind WHEN 'show' THEN 0 ELSE 1 END, sort_order ASC, name ASC"""
        ).fetchall()
        return [dict(r) for r in rows]


def _validate_category_input(name: str, kind: str | None) -> str:
    """Shared validation for a category upsert: non-empty name, kind (if given)
    is one of _CATEGORY_KINDS. Returns the trimmed name. Raises ValueError."""
    nm = (name or "").strip()
    if not nm:
        raise ValueError("category name required")
    if kind is not None and kind not in _CATEGORY_KINDS:
        raise ValueError(f"kind must be one of {_CATEGORY_KINDS}")
    return nm


def _upsert_category_conn(c: sqlite3.Connection, name: str, kind: str | None = None,
                          sort_order: Optional[int] = None,
                          blurb: Optional[str] = None) -> dict:
    """Create-or-update a category meta row on a CALLER-OWNED connection/
    transaction. No locking, no commit — the caller holds _WRITE_LOCK (if
    needed) and commits. Same semantics as upsert_category(); factored out so
    bulk_apply_taxonomy can upsert N categories inside its own single
    transaction without re-entering _WRITE_LOCK (NOT reentrant)."""
    nm = _validate_category_input(name, kind)
    row = c.execute("SELECT * FROM edu_categories WHERE name = ?", (nm,)).fetchone()
    if row is None:
        k = kind or "library"
        if sort_order is None:
            mx = c.execute(
                "SELECT COALESCE(MAX(sort_order), -1) AS m FROM edu_categories WHERE kind = ?",
                (k,)).fetchone()["m"]
            sort_order = int(mx) + 1
        c.execute(
            "INSERT INTO edu_categories (name, kind, sort_order, blurb, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (nm, k, int(sort_order), blurb, int(time.time())))
    else:
        sets, vals = [], []
        for col, val in (("kind", kind), ("sort_order", sort_order), ("blurb", blurb)):
            if val is not None:
                sets.append(f"{col} = ?"); vals.append(val)
        if sets:
            c.execute(f"UPDATE edu_categories SET {', '.join(sets)} WHERE name = ?",
                      (*vals, nm))
    return dict(c.execute("SELECT name, kind, sort_order, blurb FROM edu_categories "
                          "WHERE name = ?", (nm,)).fetchone())


def upsert_category(name: str, kind: str | None = None,
                    sort_order: Optional[int] = None,
                    blurb: Optional[str] = None) -> dict:
    """Create or update a category meta row. On create, missing sort_order
    appends at the tail of its kind. On update, only non-None fields change."""
    _validate_category_input(name, kind)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        result = _upsert_category_conn(c, name, kind=kind, sort_order=sort_order, blurb=blurb)
        c.commit()
        return result


def register_category_if_missing(name: str, kind: str = "library") -> None:
    """Create a category meta row iff none exists yet — appended at the tail of
    its kind via the same create-path as `_upsert_category_conn`. NEVER updates
    an existing row (any field) — unlike `upsert_category()`, a repeat call on
    a category an admin has since retaxonomized (e.g. flipped a curated show
    to 'library') can never flip it back. For publish-path "does this category
    exist yet?" registration, where the caller only wants a sane default kind
    for a brand-new name and must never fight an admin's correction on every
    subsequent matching recording. One `_WRITE_LOCK` acquisition (non-reentrant
    — never call this while already holding the lock)."""
    nm = _validate_category_input(name, kind)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        row = c.execute("SELECT 1 FROM edu_categories WHERE name = ?", (nm,)).fetchone()
        if row is not None:
            return
        _upsert_category_conn(c, nm, kind=kind)
        c.commit()


def rename_category(old: str, new: str) -> int:
    """Move every video from `old` to `new` + retire the old meta row. If `new`
    has no meta row, the old row's kind/blurb carry over. Returns rows moved."""
    o, n = (old or "").strip(), (new or "").strip()
    if not o or not n or o == n:
        raise ValueError("distinct old and new category names required")
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        old_meta = c.execute("SELECT * FROM edu_categories WHERE name = ?", (o,)).fetchone()
        new_meta = c.execute("SELECT * FROM edu_categories WHERE name = ?", (n,)).fetchone()
        if new_meta is None:
            k = old_meta["kind"] if old_meta else "library"
            so = old_meta["sort_order"] if old_meta else 0
            bl = old_meta["blurb"] if old_meta else None
            c.execute("INSERT INTO edu_categories (name, kind, sort_order, blurb, created_at) "
                      "VALUES (?, ?, ?, ?, ?)", (n, k, so, bl, int(time.time())))
        cur = c.execute("UPDATE edu_videos SET category = ?, updated_at = ? WHERE category = ?",
                        (n, int(time.time()), o))
        c.execute("DELETE FROM edu_categories WHERE name = ?", (o,))
        c.commit()
        return cur.rowcount


def set_video_tags(video_id: int, tags: list[str]) -> None:
    clean = [str(t).strip() for t in (tags or []) if str(t).strip()]
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE edu_videos SET tags = ?, updated_at = ? WHERE id = ?",
                  (_json.dumps(clean), int(time.time()), int(video_id)))
        c.commit()


def bulk_apply_taxonomy(categories: list[dict], assignments: list[dict]) -> dict:
    """One-shot taxonomy apply (PUSH_SECRET rail). Upserts category meta, then
    sets category+tags per video id — ALL of it in ONE transaction under ONE
    _WRITE_LOCK acquisition, so a bad category (or any other failure) leaves
    the DB completely unchanged rather than partially applied. Every category
    name/kind is validated BEFORE any connection is opened, so a bad row later
    in the list can't let earlier rows land first. Missing video ids are
    reported, not fatal (they don't roll back the transaction — only a raised
    exception does, via the implicit rollback-on-close of an uncommitted
    sqlite3 transaction)."""
    cats = categories or []
    for cat in cats:
        _validate_category_input(cat.get("name"), cat.get("kind"))
    applied, missing = 0, []
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        for cat in cats:
            _upsert_category_conn(c, cat["name"], kind=cat.get("kind"),
                                  sort_order=cat.get("sort_order"), blurb=cat.get("blurb"))
        for a in assignments or []:
            vid = int(a["id"])
            tags = _json.dumps([str(t).strip() for t in (a.get("tags") or []) if str(t).strip()])
            cur = c.execute(
                "UPDATE edu_videos SET category = ?, tags = ?, updated_at = ? WHERE id = ?",
                ((a["category"] or "General").strip() or "General", tags, now, vid))
            if cur.rowcount == 0:
                missing.append(vid)
            else:
                applied += 1
        c.commit()
    _mark_search_dirty()
    return {"categories": len(cats), "videos": applied, "missing_ids": missing}


# Fields present on every list_videos() row that no frontend consumer of the
# /videos payload reads — a single video's transcript alone can run to 600k
# chars (~294 videos and counting). The theater fetches insights per-video via
# /videos/{id}/insights instead. Stripped in grouped_videos_payload() AFTER the
# kind-inference below (which still needs meeting_uuid) — order matters.
_GROUPED_PAYLOAD_STRIP_KEYS = (
    "transcript", "chapters", "ticker_moments", "summary", "setups",
    "key_levels", "meeting_uuid",
)


def grouped_videos_payload() -> dict:
    """The /api/education/videos payload: categories ordered shows-first by
    sort_order, each with its videos (sort_order, id). Categories present on
    videos but missing a meta row are auto-registered at the tail (kind='show'
    when any member is a Zoom session, else 'library') so nothing ever hides.
    Heavyweight per-video fields (see _GROUPED_PAYLOAD_STRIP_KEYS) are dropped
    before returning — cheap/useful fields (tags, headline, audio_url, poster,
    …) are kept."""
    vids = list_videos()
    by_cat: dict[str, list[dict]] = {}
    for v in vids:
        v["tags"] = _parse_json_list(v.get("tags"))
        by_cat.setdefault(v["category"], []).append(v)
    meta = {m["name"]: m for m in list_category_meta()}
    for name, members in by_cat.items():
        if name not in meta:
            kind = "show" if any(m.get("meeting_uuid") for m in members) else "library"
            meta[name] = upsert_category(name, kind=kind)
    for v in vids:
        for k in _GROUPED_PAYLOAD_STRIP_KEYS:
            v.pop(k, None)
    ordered = [m for m in list_category_meta() if m["name"] in by_cat]
    return {
        "categories": [{**m, "videos": by_cat[m["name"]]} for m in ordered],
        "total": len(vids),
    }


def _parse_json_list(raw) -> list:
    try:
        v = _json.loads(raw) if raw else []
        return v if isinstance(v, list) else []
    except Exception:
        return []


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


def set_audio(video_id: int, audio_key: str) -> None:
    """Record the R2 key of the extracted background-audio track for a video."""
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "UPDATE edu_videos SET audio_url = ?, audio_at = ?, updated_at = ? WHERE id = ?",
            (audio_key, now, now, int(video_id)),
        )
        c.commit()


def get_insights(video_id: int) -> dict:
    """Chapters + ticker-moments + recap (headline/summary/poster) for the player
    UI. Always returns the full shape (empty when none yet) so the frontend can
    render-or-skip without null juggling."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT chapters, ticker_moments, transcript, headline, summary, setups, poster "
            "FROM edu_videos WHERE id = ?",
            (int(video_id),),
        ).fetchone()
    if not row:
        return {"chapters": [], "ticker_moments": [], "has_transcript": False,
                "headline": "", "summary": [], "setups": [], "has_poster": False}

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
        "setups": _parse(row["setups"]),
        "has_poster": bool(row["poster"]),
    }


def get_transcript_cues(video_id: int) -> list[dict]:
    """Timed transcript cues [{t: seconds, text}] for search-and-seek. The stored
    transcript is the timestamped-block form, so recover cues with the session
    insights parser. Returns [] when no transcript is captured."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT transcript FROM edu_videos WHERE id = ?", (int(video_id),)
        ).fetchone()
    if not row or not row["transcript"]:
        return []
    # Imported lazily — desk_session_insights imports this module (avoid a cycle).
    from api.services.desk_session_insights import _parse_timestamped_block
    return _parse_timestamped_block(row["transcript"])


def videos_without_chapters(limit: int = 1000) -> list[dict]:
    """Videos lacking generated chapters — targets for the library-wide insights
    backfill (educational videos were never run through the Zoom pipeline). Newest
    first so a fresh add is enriched first."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT id, youtube_id, title FROM edu_videos "
            "WHERE chapters IS NULL OR chapters = '' OR chapters = '[]' "
            "ORDER BY id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    return [{"id": r["id"], "youtube_id": r["youtube_id"], "title": r["title"]} for r in rows]


def videos_needing_posters(limit: int = 500) -> list[dict]:
    """Enriched videos (have chapters) lacking a recap poster — the poster backfill
    work list. Poster renders server-side from stored insights (no re-fetch), so
    backfilled videos match the Zoom-session standard's left-rail recap poster."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT id, youtube_id, title FROM edu_videos "
            "WHERE chapters IS NOT NULL AND chapters != '' AND chapters != '[]' "
            "AND (poster IS NULL OR poster = 0) "
            "ORDER BY id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    return [{"id": r["id"], "youtube_id": r["youtube_id"], "title": r["title"]} for r in rows]


def videos_needing_setups(limit: int = 500) -> list[dict]:
    """Enriched videos (have chapters) with no setup tags yet — the setup-pass work
    list. Runs off the STORED transcript (no proxy)."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT id, youtube_id, title FROM edu_videos "
            "WHERE chapters IS NOT NULL AND chapters != '' AND chapters != '[]' "
            "AND transcript IS NOT NULL AND transcript != '' "
            "AND (setups IS NULL OR setups = '' OR setups = '[]') "
            "ORDER BY id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    return [{"id": r["id"], "youtube_id": r["youtube_id"], "title": r["title"]} for r in rows]


def related_videos_by_ticker(video_id: int, limit: int = 10) -> list[dict]:
    """Other videos that covered any of THIS video's tickers, ranked by overlap
    count. Small library (~300 rows) → compute in Python rather than JSON-query
    SQLite. Returns [{id, youtube_id, title, shared: [T,...], overlap}]."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT id, youtube_id, title, ticker_moments FROM edu_videos "
            "WHERE ticker_moments IS NOT NULL AND ticker_moments != '' AND ticker_moments != '[]'"
        ).fetchall()

    def _tickers(raw) -> set:
        try:
            arr = _json.loads(raw) if raw else []
            return {str(m["ticker"]).upper() for m in arr
                    if isinstance(m, dict) and m.get("ticker")}
        except Exception:
            return set()

    vid = int(video_id)
    cur = next((r for r in rows if r["id"] == vid), None)
    mine = _tickers(cur["ticker_moments"]) if cur else set()
    if not mine:
        return []
    out = []
    for r in rows:
        if r["id"] == vid:
            continue
        shared = mine & _tickers(r["ticker_moments"])
        if shared:
            out.append({"id": r["id"], "youtube_id": r["youtube_id"], "title": r["title"],
                        "shared": sorted(shared), "overlap": len(shared)})
    out.sort(key=lambda x: (-x["overlap"], x["title"]))
    return out[:limit]


def set_video_insights(video_id: int, *, transcript: Optional[str] = None,
                       chapters: Optional[list] = None,
                       ticker_moments: Optional[list] = None,
                       headline: Optional[str] = None,
                       summary: Optional[list] = None,
                       setups: Optional[list] = None,
                       poster: Optional[bool] = None,
                       episode_label: Optional[str] = None) -> None:
    """Store generated insights (chapters / ticker-moments / transcript / recap
    headline + summary / setups / poster flag / episode label) + stamp
    insights_at. Only provided (non-None) fields are written — omitting a
    field never clobbers an existing value."""
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
    if setups is not None:
        sets["setups"] = _json.dumps(setups)
    if poster is not None:
        sets["poster"] = 1 if poster else 0
    if episode_label is not None:
        sets["episode_label"] = episode_label
    clause = ", ".join(f"{k} = :{k}" for k in sets)
    sets["id"] = int(video_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(f"UPDATE edu_videos SET {clause} WHERE id = :id", sets)
        c.commit()
    _mark_search_dirty()


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


def videos_missing_ticker_moments(max_age_secs: int, limit: int) -> list[dict]:
    """Session videos that already have chapters + a stored transcript but no
    ticker_moments yet — the ticker-backfill work-list (runs entirely off the
    stored transcript; the Zoom recording is already trashed by this point, so
    this query is intentionally NOT gated on zoom_cleaned). Ordered
    oldest-first, bounded by `limit` so a pass never over-processes."""
    cutoff = int(time.time()) - int(max_age_secs)
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT id, youtube_id, title, transcript, chapters, ticker_moments
               FROM edu_videos
               WHERE meeting_uuid IS NOT NULL AND meeting_uuid != ''
                 AND chapters IS NOT NULL AND chapters != '' AND chapters != '[]'
                 AND transcript IS NOT NULL AND transcript != ''
                 AND (ticker_moments IS NULL OR ticker_moments = '' OR ticker_moments = '[]')
                 AND created_at >= ?
               ORDER BY created_at ASC
               LIMIT ?""",
            (cutoff, int(limit)),
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
