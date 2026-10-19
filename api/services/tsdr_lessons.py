"""#tsdr video lessons — every video Patrick posts in #tsdr becomes a short,
organised lesson post in the Education section of the UCT Discord, and (behind a
second flag) an UNLISTED YouTube upload on a "TSDR Lessons" shelf in Desk > Videos.

Owner design, 2026-10-15:
  * Source: video FILE attachments Patrick posts in #tsdr, including replies to
    member questions. Backfill reaches back to TSDR_LESSONS_SINCE (2026-01-01).
  * Each video: transcript (ffmpeg → Whisper, the voice-notes path) → Claude
    writes a title + a 4-6 sentence recap of the lesson → the bot posts it to
    #video-lessons with a jump link to the original post (no re-upload).
  * A reply's question is included ONLY when the lesson needs it to make sense,
    and only as an anonymous paraphrase. This is an owner ruling for this
    feature; it is NOT the Wisdom programme (whose §0.4e forbids member text),
    and nothing here writes to wisdom.db. The member's words are read in memory
    at recap time and never stored — only the model's paraphrase, when used.
  * The bot creates the Education category + channel itself (needs Manage
    Channels), read-only for members, visible to the same audience as #tsdr.
  * Owner design, 2026-10-16 (behind TSDR_LESSONS_THREADS_ENABLED): the channel
    holds four section header posts, each with a thread (SECTIONS). A lesson goes
    to its section's thread as two messages: the recap embed (jump link kept),
    then a FORWARD of the original #tsdr message so the video plays in place.
    Lessons posted before this are moved into the threads oldest first and
    their old channel posts deleted (`run_regroup`).

  * Library v2 (owner decisions 2026-10-18, spec
    docs/superpowers/specs/2026-10-18-tsdr-lessons-library-v2-design.md): every
    recap carries a LEVEL (beginner / intermediate / advanced) and 2-3 KEY
    MOMENTS timed from the transcription's part offsets (or proportionally for a
    linked video), shown in the embed, the YouTube description and as chapters
    on Desk > Videos; a video that repeats an earlier talk by the same speaker
    is recorded as a DUPLICATE and not posted; clips that are not lessons never
    reach the website shelf.
  * Behind TSDR_LESSONS_FORUM_ENABLED a FORUM channel (#lesson-library) replaces
    the five threads: one post per lesson tagged with its section, level and
    speaker, the video inside the post, a "See also" line of related lessons,
    a pinned Index post listing every lesson by section, and a ✏️ reaction from
    a speaker on a post = rewrite it. Lessons already in the threads are moved
    over oldest first (run_forum_migration); the old channel is left for the
    owner to delete.
  * The owner chose the threads over the forum (2026-10-18), so the same
    organisation lives in #video-lessons itself: each section's header post is
    edited into a live, level-grouped table of contents (refresh_thread_index),
    every post carries its level and a "See also" line, a speaker's ✏️ on a
    post rewrites it, and lessons from before levels get one
    (run_level_backfill).
  * A post whose title is only a link or a mention is renamed in place
    (run_title_repair: the YouTube video's own name, else "Quick clip, <date>").
  * /lesson <words> in Discord searches the library (titles, tickers, tags,
    recaps, transcripts) and answers the member privately with the best two or
    three lessons and the moment in each video that says it
    (search_lessons / format_search_reply; the command itself lives with the
    other slash commands in discord_interactions).
  * A linked lesson whose video YouTube no longer has (oEmbed 404) is taken
    down on the rewrite pass and never posted in the first place; a private
    video or a network fault is not "gone".
  * Desk > Videos mirrors the sections: one shelf per section ("TSDR Lessons ·
    Setups & Entries", ...), the section and level as tags for the Filters
    chips, the recap + key moments as the description, the moments as
    chapters; rows already on the website move over once
    (move_library_rows_to_sections), and a rewrite updates its row.

Stages, each run by `tick()` every 15 minutes on the web pod:
  1. scan     — REST-poll the source channels (forward + resumable backfill),
                record one row per video attachment. No downloads.
  2. lessons  — at most TSDR_LESSONS_PER_TICK videos: re-fetch the message (a
                Discord CDN url expires, the message hands out a fresh one),
                download, transcribe, recap, post.        TSDR_LESSONS_ENABLED
  3. youtube  — at most TSDR_LESSONS_YT_PER_DAY uploads per ET day (the Data API
                quota is shared with the daily session uploads), then the
                edu_videos row.                    TSDR_LESSONS_YOUTUBE_ENABLED
  regroup     — move lessons posted to the channel itself into their section
                threads.                           TSDR_LESSONS_THREADS_ENABLED

All gates default OFF and are read per call, so a flag flip is the only lever.
Never raises out of `tick()`.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

API = "https://discord.com/api/v10"
USER_AGENT = "DiscordBot (https://uctintelligence.com, 1.0)"
_BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
               "(KHTML, like Gecko) Chrome/141.0 Safari/537.36")   # YouTube's public pages
_ET = ZoneInfo("America/New_York")
_DISCORD_EPOCH_MS = 1420070400000

TSDR_CHANNEL_ID = "882459873823043655"        # docs/wisdom/discord-sources.json
PATRICK_USER_ID = "339816805805588480"        # docs/wisdom/authors.json (author tsdr)
BRACCO_CHANNEL_ID = "882460017352130630"      # docs/wisdom/discord-sources.json
BRACCO_USER_ID = "427798118935953410"         # docs/wisdom/authors.json (author bracco)
# Who is speaking (for the recap) and the label on their YouTube titles. An
# author not listed here reads as Patrick, the original and default source.
AUTHOR_NAMES = {PATRICK_USER_ID: ("Patrick", "TSDR"), BRACCO_USER_ID: ("Bracco", "Bracco")}
CHANNEL_NAMES = {TSDR_CHANNEL_ID: "tsdr", BRACCO_CHANNEL_ID: "bracco"}
DEFAULT_GUILD_ID = "882293203485720596"

VIDEO_EXTENSIONS = (".mp4", ".mov", ".webm", ".m4v", ".mkv")
KEEP_TYPES = frozenset({0, 19})              # DEFAULT, REPLY
MAX_ATTEMPTS = 3
MAX_PAGES_PER_TICK = 20   # TSDR_LESSONS_SCAN_PAGES overrides; one page is 100 messages
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024  # long recordings run past 600 MB; streamed to disk
MAX_VIDEO_SECONDS = 2 * 60 * 60
MIN_WORDS = 20
TICK_BUDGET_S = 10 * 60
RECENT_FIRST_S = 2 * 24 * 3600               # today's videos jump the backfill queue
HTTP_TIMEOUT_S = 30.0

# Discord permission bits
_VIEW_CHANNEL = 1 << 10
_SEND_MESSAGES = 1 << 11
_EMBED_LINKS = 1 << 14
_READ_HISTORY = 1 << 16
_CREATE_PUBLIC_THREADS = 1 << 35
_CREATE_PRIVATE_THREADS = 1 << 36
_SEND_IN_THREADS = 1 << 38
_POSTING_BITS = _SEND_MESSAGES | _SEND_IN_THREADS | _CREATE_PUBLIC_THREADS | _CREATE_PRIVATE_THREADS

_EMBED_COLOR = 0xC9A227
_THREAD_ARCHIVE_MINUTES = 10080              # Discord's longest: 7 days
_FORWARD = 1                                 # message_reference type FORWARD
_DESCRIPTION_MAX = 4000

_WRITE_LOCK = threading.Lock()
_TICK_LOCK = threading.Lock()
_sleep = time.sleep  # injectable for tests


# ── config (read at call time) ───────────────────────────────────────────────

def is_enabled() -> bool:
    return os.environ.get("TSDR_LESSONS_ENABLED", "") == "1"


def youtube_enabled() -> bool:
    return os.environ.get("TSDR_LESSONS_YOUTUBE_ENABLED", "") == "1"


def forum_enabled() -> bool:
    """The Forum channel replaces the five threads (owner, 2026-10-18)."""
    return os.environ.get("TSDR_LESSONS_FORUM_ENABLED", "") == "1"


def threads_enabled() -> bool:
    return os.environ.get("TSDR_LESSONS_THREADS_ENABLED", "") == "1"


def _env(name: str, default: str) -> str:
    return (os.environ.get(name) or "").strip() or default


def _int_env(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _csv_env(name: str, default: str) -> list[str]:
    return [p.strip() for p in _env(name, default).split(",") if p.strip()]


def source_channels() -> list[str]:
    return _csv_env("TSDR_LESSONS_SOURCE_CHANNELS", TSDR_CHANNEL_ID)


def author_ids() -> set[str]:
    return set(_csv_env("TSDR_LESSONS_AUTHOR_IDS", PATRICK_USER_ID))


def speaker_name(lesson: dict) -> str:
    return AUTHOR_NAMES.get(str(lesson.get("author_id") or ""), AUTHOR_NAMES[PATRICK_USER_ID])[0]


def speaker_label(lesson: dict) -> str:
    return AUTHOR_NAMES.get(str(lesson.get("author_id") or ""), AUTHOR_NAMES[PATRICK_USER_ID])[1]


def source_name(lesson: dict) -> str:
    return CHANNEL_NAMES.get(str(lesson.get("channel_id") or ""), "tsdr")


def since_date() -> datetime:
    raw = _env("TSDR_LESSONS_SINCE", "2026-01-01")
    try:
        d = datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        d = datetime(2026, 1, 1)
    return d.replace(tzinfo=_ET)


def guild_id() -> str:
    return _env("TSDR_LESSONS_GUILD_ID", _env("DISCORD_GUILD_ID", DEFAULT_GUILD_ID))


def category_name() -> str:
    return _env("TSDR_LESSONS_CATEGORY_NAME", "EDUCATION")


def channel_name() -> str:
    return _env("TSDR_LESSONS_CHANNEL_NAME", "video-lessons")


def library_category() -> str:
    return _env("TSDR_LESSONS_LIBRARY_CATEGORY", "TSDR Lessons")


def _model() -> str:
    return _env("TSDR_LESSONS_MODEL", "claude-opus-5-5")


def _db_path() -> str:
    # A direct env read (not `_env`), so the test suite's AST census of /data
    # paths sees this one and pins it away from the live volume.
    return os.environ.get("TSDR_LESSONS_DB_PATH", "/data/tsdr_lessons.db")


def _token() -> str:
    return os.environ.get("DISCORD_BOT_TOKEN", "").strip()


# ── time ─────────────────────────────────────────────────────────────────────

def snowflake_datetime(snowflake: object) -> datetime:
    ms = (int(snowflake) >> 22) + _DISCORD_EPOCH_MS
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)


def snowflake_for(dt: datetime) -> int:
    """The smallest snowflake at `dt` — a message id compares against it."""
    return max(0, int(dt.timestamp() * 1000) - _DISCORD_EPOCH_MS) << 22


def jump_link(guild: str, channel: str, message: str) -> str:
    return f"https://discord.com/channels/{guild}/{channel}/{message}"


# ── store ────────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tsdr_lessons (
  attachment_id   TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  author_id       TEXT NOT NULL,
  posted_at       INTEGER NOT NULL,      -- epoch seconds, from the snowflake
  filename        TEXT,
  size            INTEGER,
  caption         TEXT,                  -- the AUTHOR's own message text
  is_reply        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'new',   -- new | posted | skipped | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  duration_s      REAL,
  transcript      TEXT,
  title           TEXT,
  recap           TEXT,
  question        TEXT,                  -- the model's anonymous paraphrase, only when used
  takeaway        TEXT,
  tickers         TEXT,                  -- JSON list
  tags            TEXT,                  -- JSON list, from TAGS
  discord_post_id TEXT,                  -- the recap embed
  post_channel_id TEXT,                  -- where it is (a section thread, or the channel)
  forward_post_id TEXT,                  -- the forwarded video beside it
  section         TEXT,                  -- SECTIONS key; NULL = never put in a thread
  lesson_posted_at INTEGER,
  yt_attempts     INTEGER NOT NULL DEFAULT 0,
  yt_error        TEXT,
  youtube_id      TEXT,
  edu_video_id    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tsdr_lessons_status ON tsdr_lessons(status, posted_at);
CREATE TABLE IF NOT EXISTS tsdr_lessons_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"""


# Columns added after the table first shipped; CREATE TABLE IF NOT EXISTS never
# adds a column to a table that already exists.
_ADDED_COLUMNS = (("post_channel_id", "TEXT"), ("forward_post_id", "TEXT"),
                  ("section", "TEXT"),
                  # 1 = a transcript arrived for a posted link lesson: rewrite it
                  ("redo", "INTEGER NOT NULL DEFAULT 0"),
                  # library v2 (owner, 2026-10-18): the recap's level, its key
                  # moments (JSON [{t, label, quote}]), the transcript's part
                  # offsets (JSON [[start_s, text], ...]) and, for a repeat of
                  # an earlier video, the lesson it duplicates
                  ("level", "TEXT"), ("moments", "TEXT"), ("segments", "TEXT"),
                  ("duplicate_of", "TEXT"),
                  # the Forum channel (TSDR_LESSONS_FORUM_ENABLED): the lesson's
                  # post, its "See also" lessons (JSON [{title, post}]) and when
                  # they were last worked out, and when its reactions were read
                  ("forum_post_id", "TEXT"), ("related", "TEXT"), ("related_at", "INTEGER"),
                  ("reaction_checked_at", "INTEGER"))


def _connect() -> sqlite3.Connection:
    path = _db_path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    have = {r[1] for r in conn.execute("PRAGMA table_info(tsdr_lessons)")}
    for col, kind in _ADDED_COLUMNS:
        if col not in have:
            try:
                conn.execute(f"ALTER TABLE tsdr_lessons ADD COLUMN {col} {kind}")
            except sqlite3.OperationalError as e:   # another connection added it first
                if "duplicate column" not in str(e).lower():
                    raise
    return conn


def get_state(key: str) -> Optional[str]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT value FROM tsdr_lessons_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_state(key: str, value: str) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("INSERT INTO tsdr_lessons_state(key, value) VALUES (?, ?) "
                  "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))
        c.commit()


def _update(attachment_id: str, **fields) -> None:
    fields["updated_at"] = int(time.time())
    clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["attachment_id"] = attachment_id
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(f"UPDATE tsdr_lessons SET {clause} WHERE attachment_id = :attachment_id", fields)
        c.commit()


def get_lesson(attachment_id: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM tsdr_lessons WHERE attachment_id = ?",
                        (attachment_id,)).fetchone()
    return dict(row) if row else None


def status_counts() -> dict:
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT status, COUNT(*) AS n FROM tsdr_lessons GROUP BY status").fetchall()
        yt = c.execute("SELECT COUNT(*) AS n FROM tsdr_lessons WHERE youtube_id IS NOT NULL").fetchone()
    out = {r["status"]: r["n"] for r in rows}
    out["on_youtube"] = yt["n"]
    return out


def _queue_order_sql() -> str:
    # Today's videos first (newest first), then the backlog oldest first, so the
    # channel keeps up with the day while the 2026 backfill trickles in.
    cutoff = int(time.time()) - RECENT_FIRST_S
    return (f"ORDER BY CASE WHEN posted_at >= {cutoff} THEN 0 ELSE 1 END, "
            f"CASE WHEN posted_at >= {cutoff} THEN -posted_at ELSE posted_at END")


# ── Discord REST ─────────────────────────────────────────────────────────────

class DiscordError(Exception):
    def __init__(self, status: Optional[int], message: str):
        super().__init__(f"Discord {status}: {message}")
        self.status = status


def _discord(method: str, path: str, *, params: Optional[dict] = None,
             body: Optional[dict] = None):
    """One Discord REST call as the bot. Returns parsed JSON (or None on 204).
    Sleeps once on a 429 and retries; raises DiscordError on anything else.
    The seam tests replace."""
    tok = _token()
    if not tok:
        raise DiscordError(None, "DISCORD_BOT_TOKEN is not set")
    import httpx

    headers = {"Authorization": f"Bot {tok}", "User-Agent": USER_AGENT}
    for attempt in range(2):
        resp = httpx.request(method, f"{API}{path}", params=params, json=body,
                             headers=headers, timeout=HTTP_TIMEOUT_S)
        if resp.status_code == 429 and attempt == 0:
            try:
                wait = float((resp.json() or {}).get("retry_after") or 1.0)
            except Exception:
                wait = 1.0
            _sleep(min(wait, 30.0))
            continue
        if resp.status_code == 204:
            return None
        if 200 <= resp.status_code < 300:
            return resp.json()
        raise DiscordError(resp.status_code, resp.text[:200])
    raise DiscordError(429, "rate limited twice")


# A YouTube link in an author's message is a video too. Its row is keyed
# "yt:<video id>", so the same video shared twice is one lesson, and it never
# collides with a Discord attachment id (those are all digits).
_YOUTUBE_LINK = re.compile(
    r"(?:https?://)?(?:www\.|m\.)?(?:youtu\.be/|youtube\.com/(?:watch\?(?:[^\s]*&)?v=|live/|shorts/|embed/))"
    r"([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])")
LINK_PREFIX = "yt:"


def youtube_ids_in(text: str) -> list[str]:
    out = []
    for vid in _YOUTUBE_LINK.findall(text or ""):
        if vid not in out:
            out.append(vid)
    return out


def link_video_id(row: dict) -> str:
    """The YouTube id of a lesson that came from a link, else ""."""
    aid = str(row.get("attachment_id") or "")
    return aid[len(LINK_PREFIX):] if aid.startswith(LINK_PREFIX) else ""


def is_video_attachment(a: dict) -> bool:
    ctype = str(a.get("content_type") or "").lower()
    name = str(a.get("filename") or "").lower()
    return ctype.startswith("video/") or name.endswith(VIDEO_EXTENSIONS)


def record_message(msg: dict, channel_id: str) -> int:
    """Record every video attachment on an author's message. Returns rows added.
    A member's message is ignored before anything is written."""
    author = str(((msg.get("author") or {}).get("id")) or "")
    if author not in author_ids() or int(msg.get("type") or 0) not in KEEP_TYPES:
        return 0
    if msg.get("webhook_id"):
        return 0
    try:
        posted = snowflake_datetime(msg["id"])
    except (KeyError, TypeError, ValueError):
        return 0
    if posted < since_date():
        return 0
    added = 0
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        for a in msg.get("attachments") or []:
            if not isinstance(a, dict) or not a.get("id") or not is_video_attachment(a):
                continue
            cur = c.execute(
                """INSERT OR IGNORE INTO tsdr_lessons
                   (attachment_id, message_id, channel_id, author_id, posted_at, filename,
                    size, caption, is_reply, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (str(a["id"]), str(msg["id"]), str(channel_id), author,
                 int(posted.timestamp()), a.get("filename"), a.get("size"),
                 (msg.get("content") or "")[:4000],
                 1 if int(msg.get("type") or 0) == 19 else 0, now, now))
            added += cur.rowcount
        for vid in youtube_ids_in(msg.get("content") or ""):
            cur = c.execute(
                """INSERT OR IGNORE INTO tsdr_lessons
                   (attachment_id, message_id, channel_id, author_id, posted_at, filename,
                    size, caption, is_reply, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (LINK_PREFIX + vid, str(msg["id"]), str(channel_id), author,
                 int(posted.timestamp()), f"https://youtu.be/{vid}", 0,
                 (msg.get("content") or "")[:4000],
                 1 if int(msg.get("type") or 0) == 19 else 0, now, now))
            added += cur.rowcount
        c.commit()
    return added


def _backfill_done(done_key: str) -> bool:
    """The backfill is done for the CURRENT TSDR_LESSONS_SINCE only. The marker
    holds the floor date it reached, so moving the date earlier reopens the
    backfill from where it stopped, with no hand edit of the state table.
    The legacy marker "1" was written when the floor was always 2026-01-01."""
    value = get_state(done_key)
    floor = since_date().date().isoformat()
    if value == "1":
        return floor >= "2026-01-01"
    return value is not None and value <= floor


def _mark_backfill_done(done_key: str) -> None:
    set_state(done_key, since_date().date().isoformat())


def scan_channel(channel_id: str, *, max_pages: Optional[int] = None) -> dict:
    """Forward pages first (new posts), the rest of the budget on the backfill
    down to TSDR_LESSONS_SINCE. A cursor moves only after its page is recorded."""
    if max_pages is None:
        max_pages = _int_env("TSDR_LESSONS_SCAN_PAGES", MAX_PAGES_PER_TICK)
    out = {"pages": 0, "added": 0}
    fwd_key, back_key, done_key = (f"cursor:{channel_id}", f"backfill:{channel_id}",
                                   f"backfill_done:{channel_id}")
    forward = get_state(fwd_key)
    if forward is None:
        page = _discord("GET", f"/channels/{channel_id}/messages", params={"limit": 100}) or []
        out["pages"] += 1
        for m in page:
            out["added"] += record_message(m, channel_id)
        ids = [int(m["id"]) for m in page if m.get("id")]
        set_state(fwd_key, str(max(ids) if ids else snowflake_for(datetime.now(timezone.utc))))
        if ids:
            set_state(back_key, str(min(ids)))
        else:
            _mark_backfill_done(done_key)
    else:
        while out["pages"] < max_pages:
            page = _discord("GET", f"/channels/{channel_id}/messages",
                            params={"limit": 100, "after": forward}) or []
            out["pages"] += 1
            for m in page:
                out["added"] += record_message(m, channel_id)
            if not page:
                break
            forward = str(max(int(m["id"]) for m in page))
            set_state(fwd_key, forward)
            if len(page) < 100:
                break
    floor = snowflake_for(since_date())
    while out["pages"] < max_pages and not _backfill_done(done_key):
        before = get_state(back_key)
        if before is None or int(before) <= floor:
            _mark_backfill_done(done_key)
            break
        page = _discord("GET", f"/channels/{channel_id}/messages",
                        params={"limit": 100, "before": before}) or []
        out["pages"] += 1
        for m in page:
            out["added"] += record_message(m, channel_id)
        if not page:
            _mark_backfill_done(done_key)
            break
        oldest = min(int(m["id"]) for m in page)
        set_state(back_key, str(oldest))
        if oldest <= floor or len(page) < 100:
            _mark_backfill_done(done_key)
    return out


# ── the lesson channel ───────────────────────────────────────────────────────

def _read_only_overwrites(source: list[dict], bot_id: str, guild: str, *,
                          deny_bits: int = _POSTING_BITS,
                          bot_bits: int = _VIEW_CHANNEL | _SEND_MESSAGES | _EMBED_LINKS
                          | _READ_HISTORY,
                          copy_audience: bool = True) -> list[dict]:
    """The source channel's AUDIENCE (only its View Channel bit — Discord refuses
    an overwrite naming any permission the bot does not hold itself, so the
    source's other bits are never copied), with posting denied for everyone but
    the bot. Admins bypass overwrites, so Patrick can still post or pin."""
    out, seen_everyone = [], False
    for ow in (source or []) if copy_audience else []:
        oid = str(ow.get("id") or "")
        if not oid or oid == bot_id:
            continue
        allow = int(ow.get("allow") or 0) & _VIEW_CHANNEL
        deny = (int(ow.get("deny") or 0) & _VIEW_CHANNEL) | deny_bits
        seen_everyone |= oid == guild
        out.append({"id": oid, "type": int(ow.get("type") or 0),
                    "allow": str(allow), "deny": str(deny)})
    if not seen_everyone:
        out.append({"id": guild, "type": 0, "allow": "0", "deny": str(deny_bits)})
    out.append({"id": bot_id, "type": 1, "deny": "0", "allow": str(bot_bits)})
    return out


# Tried in order until Discord accepts one: each later step names fewer
# permissions, for a bot role that lacks the thread or embed bits. The last
# drops the audience copy (the channel then inherits the category's).
_OVERWRITE_LADDER = (
    {},
    {"deny_bits": _SEND_MESSAGES, "bot_bits": _VIEW_CHANNEL | _SEND_MESSAGES | _EMBED_LINKS},
    {"deny_bits": _SEND_MESSAGES, "bot_bits": _VIEW_CHANNEL | _SEND_MESSAGES},
    {"deny_bits": _SEND_MESSAGES, "bot_bits": _SEND_MESSAGES, "copy_audience": False},
)


def ensure_lesson_channel() -> str:
    """The channel lessons post to: TSDR_LESSONS_CHANNEL_ID, else the one this
    module created (remembered), else find it by name, else create the
    category + channel. Raises DiscordError (e.g. 403 = no Manage Channels)."""
    override = _env("TSDR_LESSONS_CHANNEL_ID", "")
    if override:
        return override
    known = get_state("lesson_channel_id")
    if known:
        return known
    guild = guild_id()
    channels = _discord("GET", f"/guilds/{guild}/channels") or []
    cat_name, ch_name = category_name().lower(), channel_name().lower()
    category = next((c for c in channels if c.get("type") == 4
                     and str(c.get("name") or "").lower() == cat_name), None)
    if category:
        existing = next((c for c in channels if c.get("type") == 0
                         and str(c.get("parent_id") or "") == str(category["id"])
                         and str(c.get("name") or "").lower() == ch_name), None)
        if existing:
            set_state("lesson_channel_id", str(existing["id"]))
            return str(existing["id"])
    else:
        category = _discord("POST", f"/guilds/{guild}/channels",
                            body={"name": category_name(), "type": 4})
    me = _discord("GET", "/users/@me") or {}
    source = _discord("GET", f"/channels/{source_channels()[0]}") or {}
    created, last_error = None, None
    for step in _OVERWRITE_LADDER:
        body = {"name": channel_name(), "type": 0, "parent_id": str(category["id"]),
                "topic": ("Every video lesson from #tsdr, recapped in a few sentences. "
                          "Click a title to watch the original video."),
                "permission_overwrites": _read_only_overwrites(
                    source.get("permission_overwrites") or [], str(me.get("id") or ""),
                    guild, **step)}
        try:
            created = _discord("POST", f"/guilds/{guild}/channels", body=body)
            break
        except DiscordError as e:
            if e.status != 403:
                raise
            last_error = e
    if created is None:
        raise last_error
    set_state("lesson_channel_id", str(created["id"]))
    log.info("[tsdr-lessons] created #%s (%s) under %s", channel_name(), created["id"],
             category_name())
    return str(created["id"])


# ── the four section threads ─────────────────────────────────────────────────

# (key, thread name, one line for the header post). Order is the order the
# header posts appear in the channel.
SECTIONS = (
    ("setups", "Setups & Entries",
     "Bases, breakouts, pullbacks and exactly where to get in."),
    ("management", "Trade Management",
     "Stops, sizing, adds, trims and exits once you are in a trade."),
    ("market", "Market Read",
     "Reading the indexes, sectors and conditions, and what they mean for exposure."),
    ("mindset", "Mindset & Process",
     "Psychology, routine and reviewing your own trades."),
    ("clips", "Clips & Quick Takes",
     "Quick looks, short clips and anything that is not a full lesson."),
)
_SECTION_KEYS = tuple(k for k, _, _ in SECTIONS)
# A lesson's section is the one its FIRST tag belongs to (the model lists the
# main topic first). Every tag in TAGS maps to exactly one section.
_TAG_SECTION = {"setups": "setups", "entries": "setups", "exits": "management",
                "risk": "management", "market": "market", "psychology": "mindset",
                "process": "mindset", "review": "mindset", "clip": "clips"}
_DEFAULT_SECTION = "mindset"
# Every video is posted, lesson or not: a clip that teaches nothing (or says
# nothing) carries this tag, which puts it in the Clips & Quick Takes thread.
CLIP_TAG = "clip"


def section_for(lesson: dict) -> str:
    for tag in _json_list(lesson.get("tags")):
        key = _TAG_SECTION.get(str(tag).lower())
        if key:
            return key
    return _DEFAULT_SECTION


def _thread_state_key(key: str) -> str:
    return f"section_thread:{key}"


def _header_body(name: str, blurb: str) -> dict:
    return {"embeds": [{"title": name, "color": _EMBED_COLOR,
                        "description": (f"{blurb}\n\nOpen the thread below for every "
                                        "lesson in this section, oldest first. Each one "
                                        "has the recap and the video.")}],
            "allowed_mentions": {"parse": []}}


def ensure_section_threads() -> dict:
    """{section key: thread id}. A missing section gets a header post in the
    lesson channel and a thread started from it, in SECTIONS order. The thread
    is locked when the bot may (members read, only the bot posts); a bot
    without Manage Threads leaves it unlocked, which the channel's own
    permissions then govern."""
    out = {k: get_state(_thread_state_key(k)) for k in _SECTION_KEYS}
    if all(out.values()):
        return out
    channel = ensure_lesson_channel()
    for key, name, blurb in SECTIONS:
        if out[key]:
            continue
        header = _discord("POST", f"/channels/{channel}/messages",
                          body=_header_body(name, blurb)) or {}
        thread = _discord("POST", f"/channels/{channel}/messages/{header['id']}/threads",
                          body={"name": name,
                                "auto_archive_duration": _THREAD_ARCHIVE_MINUTES}) or {}
        tid = str(thread["id"])
        try:
            _discord("PATCH", f"/channels/{tid}", body={"locked": True})
        except DiscordError as e:
            log.info("[tsdr-lessons] could not lock the %s thread: %s", name, e)
        set_state(_thread_state_key(key), tid)
        out[key] = tid
        log.info("[tsdr-lessons] created the %s thread (%s)", name, tid)
    return out


def _in_thread(method: str, thread: str, path: str, body: dict):
    """A call into a thread. An idle thread archives itself after a week, and
    Discord may refuse a post or an edit there until it is reopened, so a 400
    or 403 reopens it once and retries."""
    try:
        return _discord(method, path, body=body)
    except DiscordError as e:
        if e.status not in (400, 403):
            raise
        _discord("PATCH", f"/channels/{thread}", body={"archived": False})
        return _discord(method, path, body=body)


def forward_body(lesson: dict) -> dict:
    """A forward of the original #tsdr message: Discord shows its video (and
    caption) in place, with a link back to where it was posted."""
    return {"message_reference": {"type": _FORWARD, "message_id": str(lesson["message_id"]),
                                  "channel_id": str(lesson["channel_id"]),
                                  "guild_id": guild_id()}}


def youtube_video_body(lesson: dict) -> dict:
    """The fallback when Discord will not forward the video: the lesson's
    unlisted YouTube copy, which Discord shows as a playable video in place.
    A lesson that came from a YouTube link shows that video."""
    return {"content": f"https://youtu.be/{link_video_id(lesson) or lesson['youtube_id']}"}


def post_to_section(lesson: dict, link: str) -> dict:
    """Post a lesson into its section thread: the recap, then the forwarded
    video. Returns {section, thread, post_id, forward_id}. A thread that was
    deleted is made again once. A failed forward leaves the recap (its link
    still opens the video) and an empty forward_id."""
    key = section_for(lesson)
    for attempt in range(2):
        thread = ensure_section_threads()[key]
        try:
            post = _in_thread("POST", thread, f"/channels/{thread}/messages",
                              _lesson_body(lesson, link)) or {}
            break
        except DiscordError as e:
            if e.status != 404 or attempt:
                raise
            set_state(_thread_state_key(key), "")
    forward_id = ""
    try:
        # a linked video is shown by its link; there is no file to forward
        fwd = _in_thread("POST", thread, f"/channels/{thread}/messages",
                         youtube_video_body(lesson) if link_video_id(lesson)
                         else forward_body(lesson)) or {}
        forward_id = str(fwd.get("id") or "")
    except DiscordError as e:
        # Measured 2026-10-17: two lessons were refused every tick for 90 min
        # ("Maximum amount of forwarded attachment bytes reached"), so the
        # refusal is not only a rate: a large enough file is never forwarded.
        # The YouTube copy plays in place instead; without one, run_video_refill
        # waits for the upload.
        log.warning("[tsdr-lessons] could not forward the video for %s: %s",
                    lesson.get("attachment_id"), e)
        if lesson.get("youtube_id"):
            try:
                yt = _in_thread("POST", thread, f"/channels/{thread}/messages",
                                youtube_video_body(lesson)) or {}
                forward_id = str(yt.get("id") or "")
            except DiscordError as e2:
                log.warning("[tsdr-lessons] could not post the YouTube video for %s: %s",
                            lesson.get("attachment_id"), e2)
    return {"section": key, "thread": thread, "post_id": str(post.get("id") or ""),
            "forward_id": forward_id}


# ── media: download, transcribe ──────────────────────────────────────────────

def fetch_message(channel_id: str, message_id: str) -> Optional[dict]:
    """The message with FRESH attachment urls, or None if it was deleted."""
    try:
        return _discord("GET", f"/channels/{channel_id}/messages/{message_id}")
    except DiscordError as e:
        if e.status == 404:
            return None
        raise


def download(url: str, dest: Path) -> int:
    import httpx

    written = 0
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_bytes(1024 * 1024):
                written += len(chunk)
                if written > _int_env("TSDR_LESSONS_MAX_DOWNLOAD_MB", MAX_DOWNLOAD_BYTES >> 20) << 20:
                    raise ValueError("video is larger than the download cap")
                fh.write(chunk)
    return written


def transcribe(video: Path, work: Path) -> tuple[str, float, list]:
    """(transcript, seconds, segments) through the voice-notes ffmpeg split +
    Whisper. `segments` is one [start_seconds, text] per 5-minute part: the
    timing key moments are placed with. ('', 0.0, []) when the file carries no
    audio."""
    from api.services.journal_two import voice_notes

    seconds = voice_notes.probe_duration(video)
    if not seconds:
        return "", 0.0, []
    if seconds > MAX_VIDEO_SECONDS:
        raise ValueError(f"video is {int(seconds // 60)} minutes, over the cap")
    parts = voice_notes.split_audio(video, work / "parts", duration=seconds)
    segments = []
    for i, part in enumerate(parts):
        text = (voice_notes.transcribe_part(part, i) or "").strip()
        if text:
            segments.append([i * voice_notes.CHUNK_SECONDS, text])
    return " ".join(t for _, t in segments), float(seconds), segments


def youtube_transcript(video_id: str) -> str:
    """The video's captions as plain text, or "" when YouTube has none or
    refuses (it often refuses a server's address); the lesson is then written
    from the title and caption instead."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        fetched = YouTubeTranscriptApi().fetch(video_id, languages=["en", "en-US"])
        return " ".join(str(getattr(sn, "text", "") or "") for sn in fetched).strip()
    except Exception as e:  # noqa: BLE001 — no captions is an ordinary answer
        log.info("[tsdr-lessons] no captions for %s: %s", video_id, str(e)[:160])
        return ""


def youtube_video_title(video_id: str) -> str:
    """The video's own title from YouTube's public oEmbed, or ""."""
    import httpx
    try:
        r = httpx.get("https://www.youtube.com/oembed",
                      params={"url": f"https://www.youtube.com/watch?v={video_id}",
                              "format": "json"}, timeout=15.0)
        return str(r.json().get("title") or "").strip() if r.status_code == 200 else ""
    except Exception:  # noqa: BLE001
        return ""


def youtube_video_gone(video_id: str) -> bool:
    """True only when YouTube says the video no longer exists (oEmbed 404).
    A private video (401), a block or a network fault all count as present:
    a post comes down only on a definite answer."""
    import httpx
    try:
        r = httpx.get("https://www.youtube.com/oembed",
                      params={"url": f"https://www.youtube.com/watch?v={video_id}",
                              "format": "json"}, timeout=15.0)
        return r.status_code == 404
    except Exception:  # noqa: BLE001
        return False


def youtube_video_length(video_id: str) -> Optional[float]:
    """Seconds, read off the public watch page, or None. Best effort: the
    length only places key moments along a linked video."""
    import httpx
    try:
        r = httpx.get(f"https://www.youtube.com/watch?v={video_id}",
                      headers={"User-Agent": _BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"},
                      timeout=15.0, follow_redirects=True)
        m = re.search(r'"lengthSeconds":"(\d+)"', r.text) if r.status_code == 200 else None
        return float(m.group(1)) if m else None
    except Exception:  # noqa: BLE001
        return None


# ── the recap ────────────────────────────────────────────────────────────────

# Lowercase single words, the same shape as the library's existing tags
# ("earnings", "macro"), so they become Desk > Videos filter chips as-is.
TAGS = ("setups", "entries", "exits", "risk", "market", "psychology", "process", "review")
LEVELS = ("beginner", "intermediate", "advanced")
MAX_MOMENTS = 3
_TICKER = re.compile(r"^[A-Z]{1,5}(?:\.[A-Z])?$")

_SYS = (
    "You write the lesson log for a stock-trading community's Discord. The community's "
    "traders record short videos during and after the trading day, and each one becomes a "
    "post in an education channel so members can find the lesson later.\n"
    "You get who is speaking, the video's transcript, the caption they posted with it, "
    "its date, and, when "
    "the video answered a member's question, that question.\n"
    "Return ONLY a JSON object with these keys:\n"
    '  "title": 4-10 words naming the lesson (not the date, no emoji, no quotes).\n'
    '  "recap": 4 to 6 complete sentences, one paragraph, in third person '
    '("<SPEAKER> explains..." is fine, using the SPEAKER name given). Say what the lesson is, the reasoning, and the '
    "takeaway a member should apply. Name tickers, setups and levels exactly as said.\n"
    '  "question_needed": true only if the recap would not make sense without knowing '
    "what was asked.\n"
    '  "question": when question_needed, a one-sentence anonymous paraphrase of what the '
    'member asked (never a name or handle); otherwise "".\n'
    '  "takeaway": ONE short sentence a member should remember and apply.\n'
    '  "tickers": the stock/ETF symbols actually discussed, uppercase, no "$", at most 8.\n'
    f'  "tags": 1 to 3 topics, chosen ONLY from: {", ".join(TAGS)}.\n'
    f'  "level": who the lesson is for, ONLY one of: {", ".join(LEVELS)}. beginner = a '
    "first principle every new member needs; advanced = assumes the member already trades "
    "these setups and manages positions; otherwise intermediate.\n"
    '  "moments": 2 or 3 key moments, in transcript order, each {"quote": 6 to 12 '
    "consecutive words copied EXACTLY from the transcript where the moment starts, "
    '"label": 3 to 7 words naming what happens there, e.g. "The entry trigger on NVDA"}. '
    "[] when there is no transcript.\n"
    '  "is_lesson": false when the clip teaches nothing (a joke, a quick "look at this" '
    "with no explanation, a tech test, an announcement); true otherwise. Every clip is "
    "still posted, so when is_lesson is false still give a title and a recap of 1 to 3 "
    "sentences saying what the clip shows.\n"
    "Rules: ground every claim in the transcript or caption; never invent tickers, prices "
    "or results; no position sizes or share counts; no hype; plain text, no markdown."
)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split((text or "").strip()) if s.strip()]


def _parse_json_object(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model reply carried no JSON object")
    return json.loads(text[start:end + 1])


def generate_recap(*, transcript: str, caption: str, posted: datetime,
                   question: str = "", speaker: str = "Patrick") -> dict:
    """{is_lesson, title, recap, question, takeaway, tickers, tags} from Claude.
    Raises on an unusable reply."""
    from api.services.engine import _get_anthropic_client

    et = posted.astimezone(_ET)
    user = f"SPEAKER: {speaker}\n"
    user += f"DATE: {et:%A, %B} {et.day}, {et.year}\n"
    user += f"CAPTION: {caption.strip() or '(none)'}\n"
    if question.strip():
        user += f"MEMBER QUESTION THIS VIDEO ANSWERS: {question.strip()[:1500]}\n"
    user += f"\nTRANSCRIPT:\n{transcript[:120_000] or '(no speech)'}"
    client = _get_anthropic_client().with_options(timeout=180.0)
    msg = client.messages.create(
        model=_model(),
        max_tokens=4000,
        system=_SYS,
        messages=[{"role": "user", "content": user}],
        extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
        extra_body={"fallbacks": "default", "output_config": {"effort": "low"}},
    )
    if getattr(msg, "stop_reason", None) == "refusal":
        raise ValueError("the model declined to write this recap")
    text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text")
    data = _parse_json_object(text)
    is_lesson = data.get("is_lesson") is not False
    title = re.sub(r"\s+", " ", str(data.get("title") or "")).strip().strip('"')[:120]
    sentences = split_sentences(str(data.get("recap") or ""))
    if not title or len(sentences) < (3 if is_lesson else 1):
        if not is_lesson:
            return {"is_lesson": False}     # the caller writes a plain clip entry
        raise ValueError("model reply was missing a title or a recap")
    q = str(data.get("question") or "").strip() if data.get("question_needed") else ""
    tickers = []
    for t in data.get("tickers") or []:
        sym = str(t).strip().lstrip("$").upper()
        if _TICKER.match(sym) and sym not in tickers:
            tickers.append(sym)
    tags = []
    for t in data.get("tags") or []:
        tag = str(t).strip().lower()
        if tag in TAGS and tag not in tags:
            tags.append(tag)
    level = str(data.get("level") or "").strip().lower()
    if level not in LEVELS:
        level = "intermediate"
    moments = []
    for m in data.get("moments") or []:
        if len(moments) == MAX_MOMENTS:
            break
        if not isinstance(m, dict):
            continue
        quote = re.sub(r"\s+", " ", str(m.get("quote") or "")).strip()
        label = re.sub(r"\s+", " ", str(m.get("label") or "")).strip().rstrip(".")[:80]
        if quote and label:
            moments.append({"quote": quote[:200], "label": label})
    return {"is_lesson": is_lesson, "title": title, "recap": " ".join(sentences[:6]),
            "question": q[:400], "takeaway": str(data.get("takeaway") or "").strip()[:300],
            "tickers": tickers[:8], "tags": tags[:3], "level": level, "moments": moments}


# ── key moments and duplicates ───────────────────────────────────────────────

def fmt_time(seconds) -> str:
    s = max(0, int(seconds or 0))
    if s >= 3600:
        return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"
    return f"{s // 60}:{s % 60:02d}"


def _norm_words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9$%.']+", (text or "").lower())


def locate_moments(moments: list, transcript: str, segments: list, duration_s) -> list:
    """Each key moment with its time: the quote is found in the transcript by its
    first six normalised words (so casing and punctuation cannot miss), and the
    match's position becomes a time from the part offsets when the video was
    transcribed here, else proportionally along the whole transcript. A quote
    that is not in the transcript is dropped; so is a moment with no way to
    time it. Sorted by time, so the list never runs backwards."""
    words = _norm_words(transcript)
    if not words or not moments:
        return []
    bounds = []   # (first word index, last word index + 1, start_s, end_s) per part
    if segments:
        at = 0
        for i, seg in enumerate(segments):
            n = len(_norm_words(seg[1]))
            if i + 1 < len(segments):
                end = segments[i + 1][0]
            else:   # the last part runs to the end of the video (a 5-minute part if unknown)
                end = max(float(duration_s), float(seg[0])) if duration_s else float(seg[0]) + 300.0
            bounds.append((at, at + n, float(seg[0]), float(end)))
            at += n
    elif not duration_s:
        return []
    out = []
    for m in moments:
        if not isinstance(m, dict):
            continue
        q = _norm_words(m.get("quote") or "")[:6]
        if len(q) < 3:
            continue
        idx = next((i for i in range(len(words) - len(q) + 1) if words[i:i + len(q)] == q), None)
        if idx is None:
            continue
        if bounds:
            lo, hi, start, end = next(((lo, hi, st, en) for lo, hi, st, en in bounds
                                       if lo <= idx < hi), bounds[-1])
            frac = (idx - lo) / float(max(1, hi - lo))
            t = start + frac * max(0.0, end - start)
        else:
            t = idx / float(len(words)) * float(duration_s)
        out.append({"t": int(round(t)), "label": str(m.get("label") or "").strip(),
                    "quote": str(m.get("quote") or "").strip()})
    out.sort(key=lambda m: m["t"])
    return out[:MAX_MOMENTS]


def seek_link(lesson: dict, t) -> str:
    """The lesson's YouTube copy (or the linked video) opened at `t` seconds; ""
    for a lesson whose only video is the Discord forward."""
    vid = link_video_id(lesson) or str(lesson.get("youtube_id") or "")
    return f"https://youtu.be/{vid}?t={int(t or 0)}" if vid else ""


def located_moments(lesson: dict) -> list[dict]:
    return [m for m in _json_list(lesson.get("moments"))[:MAX_MOMENTS]
            if isinstance(m, dict) and "t" in m and m.get("label")]


def moments_lines(lesson: dict) -> list[str]:
    out = []
    for m in located_moments(lesson):
        stamp, link = fmt_time(m["t"]), seek_link(lesson, m["t"])
        out.append(f"[`{stamp}`]({link}) {m['label']}" if link else f"`{stamp}` {m['label']}")
    return out


_SHINGLE = 5
_DUPLICATE_JACCARD = 0.8


def _shingles(text: str) -> set:
    w = _norm_words(text)
    return {" ".join(w[i:i + _SHINGLE]) for i in range(max(0, len(w) - _SHINGLE + 1))}


def find_duplicate(transcript: str, author_id: str, exclude: str, *,
                   in_forum: bool = False) -> Optional[str]:
    """The attachment id of an earlier POSTED lesson by the same speaker whose
    transcript is the same talk (word 5-gram Jaccard >= 0.8), else None. A
    transcript under MIN_WORDS is never a duplicate: there is nothing to match,
    and two silent clips would otherwise look identical. `in_forum` looks only
    at lessons already in the forum (the migration's question)."""
    if len(_norm_words(transcript)) < MIN_WORDS:
        return None
    mine = _shingles(transcript)
    if not mine:
        return None
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT attachment_id, transcript FROM tsdr_lessons WHERE status = 'posted' "
            "AND author_id = ? AND attachment_id != ? AND transcript IS NOT NULL "
            "AND transcript != '' " + ("AND forum_post_id IS NOT NULL " if in_forum else "")
            + "ORDER BY posted_at",
            (str(author_id), str(exclude))).fetchall()
    for r in rows:
        theirs = _shingles(r["transcript"])
        if theirs and len(mine & theirs) / float(len(mine | theirs)) >= _DUPLICATE_JACCARD:
            return str(r["attachment_id"])
    return None


def _json_list(raw) -> list:
    if isinstance(raw, list):
        return raw
    try:
        out = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return out if isinstance(out, list) else []


def website_link(youtube_id: str) -> str:
    return f"https://uctintelligence.com/desk?section=videos&v={youtube_id}"


def search_line(lesson: dict) -> str:
    """The plain-text line above the embed: tags and $tickers, so Discord's search
    bar finds a lesson by topic or symbol."""
    parts = []
    if lesson.get("level") in LEVELS:
        parts.append(str(lesson["level"]).capitalize())
    parts += [t.capitalize() for t in _json_list(lesson.get("tags"))]
    tickers = " ".join(f"${t}" for t in _json_list(lesson.get("tickers")))
    if tickers:
        parts.append(tickers)
    return " · ".join(parts)


def build_embed(lesson: dict, link: str) -> dict:
    posted = datetime.fromtimestamp(int(lesson["posted_at"]), tz=timezone.utc)
    body = ""
    if lesson.get("question"):
        body += f"**Question:** {lesson['question']}\n\n"
    body += lesson["recap"]
    if lesson.get("takeaway"):
        body += f"\n\n**Key takeaway:** {lesson['takeaway']}"
    lines = moments_lines(lesson)
    if lines:
        body += "\n\n**Key moments**\n" + "\n".join(lines)
    related = [r for r in _json_list(lesson.get("related"))
               if isinstance(r, dict) and (r.get("post") or r.get("url")) and r.get("title")]
    if related:
        body += "\n\n**See also:** " + " · ".join(
            f"[{str(r['title'])[:60]}]({r.get('url') or post_url(r['post'])})"
            for r in related[:3])
    links = f"[▶ Watch the video]({link})"
    if lesson.get("youtube_id"):
        links += f"  ·  [Watch on UCT]({website_link(lesson['youtube_id'])})"
    body = body[:_DESCRIPTION_MAX - 160] + f"\n\n{links}"
    minutes = ""
    if lesson.get("duration_s"):
        s = int(lesson["duration_s"])
        minutes = f" · {s // 60}:{s % 60:02d}"
    return {"title": lesson["title"][:256], "url": link, "description": body,
            "color": _EMBED_COLOR, "timestamp": posted.isoformat(),
            "footer": {"text": f"From #{source_name(lesson)}{minutes}"}}


def _lesson_body(lesson: dict, link: str) -> dict:
    return {"content": search_line(lesson), "embeds": [build_embed(lesson, link)],
            "allowed_mentions": {"parse": []}}


def post_lesson(channel_id: str, lesson: dict, link: str) -> str:
    out = _discord("POST", f"/channels/{channel_id}/messages", body=_lesson_body(lesson, link))
    return str((out or {}).get("id") or "")


def lesson_post_exists(channel_id: str, post_id: str) -> bool:
    """False once Patrick has deleted the lesson post — his 'not this one' signal."""
    try:
        _discord("GET", f"/channels/{channel_id}/messages/{post_id}")
        return True
    except DiscordError as e:
        if e.status == 404:
            return False
        raise


def _question_for(msg: dict) -> str:
    """The text of the message a reply answers. In memory only — never stored."""
    ref = msg.get("referenced_message") or {}
    if not isinstance(ref, dict):
        return ""
    text = str(ref.get("content") or "")
    text = re.sub(r"<@!?&?\d+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


_MENTION_OR_TAG = re.compile(r"<[^<>]*>")
_URL = re.compile(r"https?://\S+")


def clean_title(text: str) -> str:
    """A caption made fit to be a title: no mentions or custom emoji
    (`<@&...>`, `<:name:id>`), no links, no square brackets (they break a
    markdown link), whitespace collapsed and stray punctuation trimmed."""
    out = _URL.sub(" ", _MENTION_OR_TAG.sub(" ", str(text or "")))
    out = out.replace("[", " ").replace("]", " ")
    out = re.sub(r"\s+", " ", out).strip().strip(" -–—·:|,;").strip()
    return out


def as_clip(recap: dict, row: dict, caption: str, title: str = "") -> dict:
    """A recap for a video that is not a full lesson: whatever the model wrote,
    with a plain title and description filled in where it wrote nothing, and
    the clip tag first so it goes to the Clips thread."""
    posted = datetime.fromtimestamp(int(row["posted_at"]), tz=timezone.utc).astimezone(_ET)
    day = f"{posted:%b} {posted.day}, {posted.year}"
    text = re.sub(r"\s+", " ", caption).strip()
    title = (clean_title(recap.get("title") or title) or clean_title(text)[:80].rstrip()
             or f"Quick clip, {day}")
    body = recap.get("recap") or (
        text[:600] if text else
        f"A short clip {speaker_name(row)} shared in #{source_name(row)} on {day}, "
        "with no spoken commentary. Watch the video below.")
    tags = [CLIP_TAG] + [t for t in recap.get("tags") or [] if t != CLIP_TAG]
    return {"title": title, "recap": body, "question": recap.get("question") or "",
            "takeaway": recap.get("takeaway") or "", "tickers": recap.get("tickers") or [],
            "tags": tags[:3], "level": recap.get("level") or "", "moments": []}


def process_lesson(row: dict, lesson_channel: str) -> str:
    """One video, start to finish. Returns the row's new status."""
    aid = row["attachment_id"]
    msg = fetch_message(row["channel_id"], row["message_id"])
    vid = link_video_id(row)
    yt_title = ""
    if vid:
        if not msg or vid not in youtube_ids_in(msg.get("content") or ""):
            _update(aid, status="skipped", last_error="message or video was deleted")
            return "skipped"
        if youtube_video_gone(vid):
            _update(aid, status="skipped", last_error=GONE_FROM_YOUTUBE)
            return "skipped"
        # a transcript sent in from outside (store_link_transcript) wins:
        # YouTube refuses captions to this server more often than not
        transcript = (row.get("transcript") or "").strip() or youtube_transcript(vid)
        seconds = row.get("duration_s") or youtube_video_length(vid)
        segments = _json_list(row.get("segments"))
        yt_title = youtube_video_title(vid)
    else:
        att = next((a for a in (msg or {}).get("attachments") or []
                    if str(a.get("id")) == aid), None)
        if not msg or not att:
            _update(aid, status="skipped", last_error="message or video was deleted")
            return "skipped"
        if (row.get("transcript") or "").strip():
            # a lesson sent back for a rewrite: the words are already here
            transcript = row["transcript"]
            seconds, segments = row.get("duration_s"), _json_list(row.get("segments"))
        else:
            work = Path(tempfile.mkdtemp(prefix="tsdr-lesson-"))
            try:
                video = work / ("video" + (Path(str(att.get("filename") or "")).suffix or ".mp4"))
                download(str(att.get("url") or att.get("proxy_url")), video)
                transcript, seconds, segments = transcribe(video, work)
            finally:
                shutil.rmtree(work, ignore_errors=True)
    twin = find_duplicate(transcript, row["author_id"], aid)
    if twin:
        # the same talk, posted again (or shared as a link after the file):
        # recorded, never posted, so the library holds each lesson once
        _update(aid, status="duplicate", duplicate_of=twin, duration_s=seconds,
                transcript=transcript, segments=json.dumps(segments), last_error=None)
        return "duplicate"
    caption = row.get("caption") or ""
    if yt_title:
        caption = f"{caption}\n(YouTube video title: {yt_title})".strip()
    posted = datetime.fromtimestamp(int(row["posted_at"]), tz=timezone.utc)
    if len(transcript.split()) < MIN_WORDS and len(caption.split()) < MIN_WORDS:
        recap = as_clip({}, row, row.get("caption") or "", yt_title)   # nothing said
    else:
        recap = generate_recap(transcript=transcript, caption=caption, posted=posted,
                               question=_question_for(msg) if row.get("is_reply") else "",
                               speaker=speaker_name(row))
        if not recap.pop("is_lesson", True):
            recap = as_clip(recap, row, row.get("caption") or "", yt_title)
    moments = locate_moments(recap.get("moments") or [], transcript, segments, seconds)
    _update(aid, duration_s=seconds, transcript=transcript, segments=json.dumps(segments),
            title=recap["title"], recap=recap["recap"], question=recap["question"],
            takeaway=recap["takeaway"], tickers=json.dumps(recap["tickers"]),
            tags=json.dumps(recap["tags"]), level=recap.get("level") or None,
            moments=json.dumps(moments))
    lesson = {**row, **recap, "duration_s": seconds, "moments": moments}
    if row.get("edu_video_id"):
        sync_library_row({**lesson, "section": section_for(lesson)})   # a rewrite
    link = jump_link(guild_id(), row["channel_id"], row["message_id"])
    if forum_enabled():
        related = related_lessons(lesson)
        placed = post_to_forum({**lesson, "related": related}, link)
        now = int(time.time())
        _update(aid, status="posted", forum_post_id=placed["post"], discord_post_id=placed["post"],
                post_channel_id=placed["post"], forward_post_id=placed["video"],
                section=section_for(lesson), related=json.dumps(related), related_at=now,
                lesson_posted_at=now, last_error=None)
        _mark_index_dirty()
        return "posted"
    if threads_enabled():
        related = related_lessons(lesson)
        placed = post_to_section({**lesson, "related": related}, link)
        _update(aid, status="posted", discord_post_id=placed["post_id"],
                post_channel_id=placed["thread"], forward_post_id=placed["forward_id"],
                section=placed["section"], lesson_posted_at=int(time.time()),
                related=json.dumps(related), related_at=int(time.time()), last_error=None)
        _mark_index_dirty()
        return "posted"
    post_id = post_lesson(lesson_channel, lesson, link)
    _update(aid, status="posted", discord_post_id=post_id, post_channel_id=lesson_channel,
            lesson_posted_at=int(time.time()), last_error=None)
    return "posted"


def run_lessons(*, limit: int, deadline: float) -> dict:
    out = {"posted": 0, "skipped": 0, "duplicate": 0, "errors": 0}
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            f"SELECT * FROM tsdr_lessons WHERE status = 'new' AND attempts < ? "
            f"{_queue_order_sql()} LIMIT ?", (MAX_ATTEMPTS, int(limit))).fetchall()]
    if not rows:
        return out
    lesson_channel = ensure_lesson_channel()
    for row in rows:
        if time.time() > deadline:
            break
        try:
            out[process_lesson(row, lesson_channel)] += 1
        except Exception as e:  # noqa: BLE001 — one bad video never stops the queue
            attempts = int(row.get("attempts") or 0) + 1
            _update(row["attachment_id"], attempts=attempts,
                    status="failed" if attempts >= MAX_ATTEMPTS else "new",
                    last_error=f"{type(e).__name__}: {str(e)[:300]}")
            log.warning("[tsdr-lessons] video %s failed (attempt %d): %s",
                        row["attachment_id"], attempts, e)
            out["errors"] += 1
    return out


# ── regroup: lessons posted before the threads ───────────────────────────────

REMOVED = "removed"   # section value: Patrick deleted the old post, so not moved


def run_regroup(*, deadline: float, limit: int = 60) -> dict:
    """Move lessons posted to the channel itself into their section threads,
    oldest first so each thread reads in order. The new posts go up before the
    old one is deleted, so a failure part way never loses a lesson. A lesson
    whose old post Patrick deleted stays deleted."""
    out = {"moved": 0, "removed": 0, "errors": 0}
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM tsdr_lessons WHERE status = 'posted' AND section IS NULL "
            "AND discord_post_id IS NOT NULL ORDER BY posted_at LIMIT ?",
            (int(limit),)).fetchall()]
    if not rows:
        return out
    channel = ensure_lesson_channel()
    for row in rows:
        if time.time() > deadline:
            break
        aid = row["attachment_id"]
        old_channel = row.get("post_channel_id") or channel
        try:
            if not lesson_post_exists(old_channel, row["discord_post_id"]):
                _update(aid, section=REMOVED)
                out["removed"] += 1
                continue
            link = jump_link(guild_id(), row["channel_id"], row["message_id"])
            placed = post_to_section(row, link)
            _update(aid, discord_post_id=placed["post_id"], post_channel_id=placed["thread"],
                    forward_post_id=placed["forward_id"], section=placed["section"])
            _mark_index_dirty()
            out["moved"] += 1
        except Exception as e:  # noqa: BLE001 — retried on the next tick
            log.warning("[tsdr-lessons] could not move %s into its thread: %s", aid, e)
            out["errors"] += 1
            continue
        try:
            _discord("DELETE", f"/channels/{old_channel}/messages/{row['discord_post_id']}")
        except DiscordError as e:
            log.warning("[tsdr-lessons] moved %s but could not delete the old post: %s",
                        aid, e)
        _sleep(1.0)
    return out


def run_video_refill(*, deadline: float, limit: int = 3) -> dict:
    """Lessons in a thread whose video forward failed: post the lesson again
    (recap, then the video) and delete the old recap, but ONLY once the video
    has gone through, so a thread never gains a second recap without its video.
    The lesson moves to the end of its thread.

    Only lessons with a YouTube copy are retried, because that copy is a video
    post Discord cannot refuse. Retrying a forward alone posted and deleted a
    recap in the thread every tick for a file Discord would never forward;
    run_youtube uploads these lessons first, so each waits at most a day."""
    out = {"refilled": 0, "waiting": 0, "errors": 0}
    if forum_enabled():
        return _refill_forum_posts(deadline=deadline, limit=limit, out=out)
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM tsdr_lessons WHERE status = 'posted' AND section IN "
            f"({','.join('?' * len(_SECTION_KEYS))}) AND (forward_post_id IS NULL "
            "OR forward_post_id = '') AND youtube_id IS NOT NULL "
            "ORDER BY posted_at LIMIT ?",
            (*_SECTION_KEYS, int(limit))).fetchall()]
    for row in rows:
        if time.time() > deadline:
            break
        aid, thread, old_post = row["attachment_id"], row["post_channel_id"], row["discord_post_id"]
        try:
            if old_post and not lesson_post_exists(thread, old_post):
                _update(aid, section=REMOVED)      # Patrick deleted it: leave it gone
                continue
            link = jump_link(guild_id(), row["channel_id"], row["message_id"])
            placed = post_to_section(row, link)
        except Exception as e:  # noqa: BLE001
            log.warning("[tsdr-lessons] video refill for %s failed: %s", aid, e)
            out["errors"] += 1
            continue
        if not placed["forward_id"]:
            # The forward was refused again: take the new recap back down and
            # keep the old one, so nothing changes in the thread.
            try:
                _in_thread("DELETE", placed["thread"],
                           f"/channels/{placed['thread']}/messages/{placed['post_id']}", None)
            except DiscordError as e:
                log.warning("[tsdr-lessons] could not remove the retry recap %s: %s",
                            placed["post_id"], e)
            out["waiting"] += 1
            continue
        _update(aid, discord_post_id=placed["post_id"], post_channel_id=placed["thread"],
                forward_post_id=placed["forward_id"], section=placed["section"])
        _mark_index_dirty()
        if old_post:
            try:
                _in_thread("DELETE", thread, f"/channels/{thread}/messages/{old_post}", None)
            except DiscordError as e:
                log.warning("[tsdr-lessons] refilled %s but could not delete the old recap: %s",
                            aid, e)
        out["refilled"] += 1
        _sleep(1.0)
    return out


def _refill_forum_posts(*, deadline: float, limit: int, out: dict) -> dict:
    """A forum post whose video forward was refused gets its YouTube copy
    posted inside the post once that copy exists. Nothing is re-posted."""
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM tsdr_lessons WHERE status = 'posted' AND forum_post_id IS NOT NULL "
            "AND (forward_post_id IS NULL OR forward_post_id = '') AND youtube_id IS NOT NULL "
            "ORDER BY posted_at LIMIT ?", (int(limit),)).fetchall()]
    for row in rows:
        if time.time() > deadline:
            break
        pid = row["forum_post_id"]
        try:
            sent = _in_thread("POST", pid, f"/channels/{pid}/messages", youtube_video_body(row)) or {}
        except DiscordError as e:
            if e.status == 404:
                _update(row["attachment_id"], status="removed")
                _mark_index_dirty()
                continue
            log.warning("[tsdr-lessons] could not add the video to post %s: %s", pid, e)
            out["errors"] += 1
            continue
        _update(row["attachment_id"], forward_post_id=str(sent.get("id") or ""))
        out["refilled"] += 1
    return out


# ── YouTube + Desk Videos ────────────────────────────────────────────────────

def _yt_quota_left(now: Optional[datetime] = None) -> int:
    day = (now or datetime.now(_ET)).astimezone(_ET).date().isoformat()
    used = int(get_state(f"yt_count:{day}") or 0)
    return max(0, _int_env("TSDR_LESSONS_YT_PER_DAY", 4) - used)


def _yt_spend(now: Optional[datetime] = None) -> None:
    day = (now or datetime.now(_ET)).astimezone(_ET).date().isoformat()
    set_state(f"yt_count:{day}", str(int(get_state(f"yt_count:{day}") or 0) + 1))


def youtube_title(lesson: dict) -> str:
    posted = datetime.fromtimestamp(int(lesson["posted_at"]), tz=timezone.utc).astimezone(_ET)
    suffix = f" | {speaker_label(lesson)} {posted.month}/{posted.day}/{posted.year % 100:02d}"
    return lesson["title"][:100 - len(suffix)].rstrip() + suffix


def youtube_description(lesson: dict) -> str:
    posted = datetime.fromtimestamp(int(lesson["posted_at"]), tz=timezone.utc).astimezone(_ET)
    text = ""
    if lesson.get("question"):
        text += f"Question: {lesson['question']}\n\n"
    text += lesson["recap"]
    if lesson.get("takeaway"):
        text += f"\n\nKey takeaway: {lesson['takeaway']}"
    lines = [f"{fmt_time(m['t'])} {m['label']}" for m in located_moments(lesson)]
    if lines:
        text += "\n\nKey moments:\n" + "\n".join(lines)
    text += (f"\n\nOriginally shared in the Uncharted Territory Discord (#{source_name(lesson)}) on "
             f"{posted:%B} {posted.day}, {posted.year}.")
    return text.replace("<", "").replace(">", "")[:4900]


def library_category_for(lesson: dict) -> str:
    """The Desk > Videos shelf a lesson sits on: one per section ("TSDR Lessons
    · Setups & Entries"), so the website mirrors the forum (owner, 2026-10-18).
    A lesson without a section keeps the plain shelf."""
    names = {k: n for k, n, _ in SECTIONS}
    section = lesson.get("section")
    if section in names and section != "clips":
        return f"{library_category()} · {names[section]}"
    return library_category()


def library_tags(lesson: dict) -> list[str]:
    """The website row's tags: the topic tags, then the section and the level
    in words, so the Videos page's Filters chips can narrow by either."""
    tags = [str(t) for t in _json_list(lesson.get("tags")) if t and t != CLIP_TAG]
    names = {k: n for k, n, _ in SECTIONS}
    section = lesson.get("section")
    if section in names and section != "clips":
        tags.append(names[section].lower())
    if lesson.get("level") in LEVELS:
        tags.append(str(lesson["level"]))
    return tags


def sync_library_row(lesson: dict) -> bool:
    """Bring a lesson's Desk > Videos row up to date with the lesson: shelf,
    title, description, tags, recap and chapters. Best effort; False when the
    row could not be written."""
    from api.services import education_service

    vid = lesson.get("edu_video_id")
    if not vid:
        return False
    try:
        cat = library_category_for(lesson)
        education_service.register_category_if_missing(cat, kind="library")
        education_service.update_video(int(vid), {"title": lesson["title"], "category": cat,
                                                  "description": youtube_description(lesson)})
        education_service.set_video_tags(int(vid), library_tags(lesson))
        chapters = [{"t": m["t"], "title": m["label"]} for m in located_moments(lesson)]
        education_service.set_video_insights(
            int(vid), headline=lesson["title"], summary=split_sentences(lesson["recap"]),
            chapters=chapters or None)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("[tsdr-lessons] could not update the website row for %s: %s",
                    lesson.get("attachment_id"), e)
        return False


_LIBRARY_SECTIONS_KEY = "library_rows_on_section_shelves"


def move_library_rows_to_sections() -> int:
    """Once (owner, 2026-10-18): every lesson already on the website moves to
    its section's shelf, with section and level tags, the recap-and-moments
    description and chapters. Marked done only when every row went."""
    if get_state(_LIBRARY_SECTIONS_KEY):
        return 0
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM tsdr_lessons WHERE status = 'posted' AND edu_video_id IS NOT NULL "
            "ORDER BY posted_at").fetchall()]
    done = [sync_library_row(r) for r in rows]
    if all(done):
        set_state(_LIBRARY_SECTIONS_KEY, "1")
    return sum(1 for d in done if d)


def upload_lesson(row: dict, yt_client=None) -> str:
    from api.services import education_service
    from api.services.youtube_client import YouTubeClient

    aid = row["attachment_id"]
    lesson_channel = row.get("post_channel_id") or ensure_lesson_channel()
    if row.get("discord_post_id") and not lesson_post_exists(lesson_channel,
                                                             row["discord_post_id"]):
        _update(aid, yt_error="lesson post was deleted in Discord", yt_attempts=MAX_ATTEMPTS)
        return "skipped"
    msg = fetch_message(row["channel_id"], row["message_id"])
    att = next((a for a in (msg or {}).get("attachments") or []
                if str(a.get("id")) == aid), None)
    if not msg or not att:
        _update(aid, yt_error="message or video was deleted", yt_attempts=MAX_ATTEMPTS)
        return "skipped"
    work = Path(tempfile.mkdtemp(prefix="tsdr-yt-"))
    try:
        video = work / ("video" + (Path(str(att.get("filename") or "")).suffix or ".mp4"))
        download(str(att.get("url") or att.get("proxy_url")), video)
        client = yt_client or YouTubeClient()
        vid = client.upload(str(video), youtube_title(row), youtube_description(row),
                            privacy="unlisted")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    _update(aid, youtube_id=vid, yt_error=None)
    cat = library_category_for(row)
    try:
        education_service.register_category_if_missing(cat, kind="library")
    except Exception:
        pass
    duration = ""
    if row.get("duration_s"):
        duration = education_service.format_duration(int(row["duration_s"]))
    created = education_service.create_video({
        "youtube_id": vid, "title": row["title"], "category": cat,
        "description": youtube_description(row), "duration": duration, "sort_order": 0})
    chapters = [{"t": m["t"], "title": m["label"]} for m in located_moments(row)]
    education_service.set_video_insights(
        int(created["id"]), transcript=row.get("transcript") or "",
        headline=row["title"], summary=split_sentences(row["recap"]),
        chapters=chapters or None)
    tags = library_tags(row)
    if tags:
        education_service.set_video_tags(int(created["id"]), tags)
    _update(aid, edu_video_id=int(created["id"]))
    if row.get("discord_post_id"):
        # Add the "Watch on UCT" link to the Discord post. Best effort: the
        # upload already succeeded and must not be retried over a failed edit.
        try:
            link = jump_link(guild_id(), row["channel_id"], row["message_id"])
            _in_thread("PATCH", lesson_channel,
                       f"/channels/{lesson_channel}/messages/{row['discord_post_id']}",
                       _lesson_body({**row, "youtube_id": vid}, link))
        except Exception as e:  # noqa: BLE001
            log.warning("[tsdr-lessons] could not add the website link to %s: %s",
                        row["discord_post_id"], e)
    return "uploaded"


_NEEDS_VIDEO_FIRST = ("ORDER BY CASE WHEN section IS NOT NULL AND section != 'removed' "
                      "AND (forward_post_id IS NULL OR forward_post_id = '') "
                      "THEN 0 ELSE 1 END, ")


def run_youtube(*, deadline: float) -> dict:
    out = {"uploaded": 0, "errors": 0}
    left = _yt_quota_left()
    if left <= 0:
        return out
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            f"SELECT * FROM tsdr_lessons WHERE status = 'posted' AND youtube_id IS NULL "
            f"AND yt_attempts < ? AND attachment_id NOT LIKE '{LINK_PREFIX}%' "
            # a clip (not a lesson) stays in Discord: the shelf is lessons only
            f"AND (section IS NULL OR section != 'clips') "
            # a lesson in a thread without its video goes first: its YouTube
            # copy is the video run_video_refill posts
            f"{_queue_order_sql().replace('ORDER BY ', _NEEDS_VIDEO_FIRST, 1)} LIMIT ?",
            (MAX_ATTEMPTS, left)).fetchall()]
    for row in rows:
        if time.time() > deadline:
            break
        try:
            if upload_lesson(row) == "uploaded":
                _yt_spend()
                out["uploaded"] += 1
        except Exception as e:  # noqa: BLE001
            _update(row["attachment_id"], yt_attempts=int(row.get("yt_attempts") or 0) + 1,
                    yt_error=f"{type(e).__name__}: {str(e)[:300]}")
            log.warning("[tsdr-lessons] YouTube upload for %s failed: %s",
                        row["attachment_id"], e)
            out["errors"] += 1
            if "quota" in str(e).lower():
                break
    return out


_CLIPS_LIBRARY_KEY = "clips_removed_from_library"


def remove_clips_from_library() -> int:
    """Once (owner, 2026-10-18): take the clips that are not lessons off the
    Desk > Videos shelf. Their unlisted YouTube copies stay; only the library
    rows go. Marked done only when every row went, so a failure retries."""
    if get_state(_CLIPS_LIBRARY_KEY):
        return 0
    from api.services import education_service
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT attachment_id, edu_video_id FROM tsdr_lessons WHERE section = 'clips' "
            "AND edu_video_id IS NOT NULL").fetchall()]
    n, failed = 0, 0
    for r in rows:
        try:
            education_service.delete_video(int(r["edu_video_id"]))
        except Exception as e:  # noqa: BLE001
            log.warning("[tsdr-lessons] could not take clip %s off the shelf: %s",
                        r["attachment_id"], e)
            failed += 1
            continue
        _update(r["attachment_id"], edu_video_id=None)
        n += 1
    if not failed:
        set_state(_CLIPS_LIBRARY_KEY, "1")
    return n


# Skip reasons from before every clip was posted. Rows skipped for them are
# put back in the queue once; a deleted message stays skipped.
_REOPEN_REASONS = ("not a lesson", "no spoken lesson to recap")
_REOPEN_DONE_KEY = "reopened_skipped_clips"


def links_needing_transcript(limit: int = 500) -> list[dict]:
    """Posted link lessons whose recap had no transcript to work from."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"SELECT attachment_id, title FROM tsdr_lessons WHERE attachment_id LIKE "
            f"'{LINK_PREFIX}%' AND status = 'posted' AND redo = 0 "
            f"AND (transcript IS NULL OR transcript = '') ORDER BY posted_at LIMIT ?",
            (int(limit),)).fetchall()
    return [{"video_id": r["attachment_id"][len(LINK_PREFIX):], "title": r["title"]}
            for r in rows]


def store_link_transcript(video_id: str, transcript: str) -> str:
    """Keep a transcript for a link lesson and mark it to be rewritten.
    "queued" | "too short" (nothing to recap; the clip stays) | "unknown"."""
    text = re.sub(r"\s+", " ", transcript or "").strip()[:400_000]
    aid = LINK_PREFIX + str(video_id)
    row = get_lesson(aid)
    if not row:
        return "unknown"
    if len(text.split()) < MIN_WORDS:
        return "too short"
    redo = 1 if row["status"] == "posted" else 0     # an unposted one just uses it
    _update(aid, transcript=text, redo=redo)
    return "queued"


def run_link_redo(*, deadline: float, limit: int = 20) -> dict:
    """Take down the plain clip posts of link lessons that now have a
    transcript and put them back in the queue, so run_lessons writes the full
    recap into the right thread. A post already gone is fine."""
    out = {"requeued": 0, "errors": 0}
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM tsdr_lessons WHERE redo = 1 AND status = 'posted' LIMIT ?",
            (int(limit),)).fetchall()]
    for row in rows:
        if time.time() > deadline:
            break
        try:
            take_down_post(row)
        except Exception as e:  # noqa: BLE001 — try again next tick
            log.warning("[tsdr-lessons] could not take down %s for its rewrite: %s",
                        row["attachment_id"], e)
            out["errors"] += 1
            continue
        _update(row["attachment_id"], status="new", attempts=0, redo=0, last_error=None,
                discord_post_id=None, forward_post_id=None, post_channel_id=None,
                section=None, forum_post_id=None, related=None)
        out["requeued"] += 1
    return out


def take_down_post(row: dict) -> None:
    """Remove a lesson's Discord presence before it is written again: the
    whole forum post when it has one, else the recap and video messages in
    its thread. A post or message already gone is fine."""
    if row.get("forum_post_id"):
        try:
            _discord("DELETE", f"/channels/{row['forum_post_id']}")
        except DiscordError as e:
            if e.status != 404:
                raise
        _mark_index_dirty()
        return
    where = row.get("post_channel_id") or ""
    for mid in (row.get("discord_post_id"), row.get("forward_post_id")):
        if where and mid:
            try:
                _in_thread("DELETE", where, f"/channels/{where}/messages/{mid}", None)
            except DiscordError as e:
                if e.status != 404:
                    raise


_LINK_RESCAN_KEY = "rescanned_for_youtube_links"


def rescan_for_links() -> bool:
    """Once: re-read every source channel's history, which was scanned before
    YouTube links counted as videos. The backfill restarts from the newest
    message; rows already recorded are ignored, so only the links are new."""
    if get_state(_LINK_RESCAN_KEY):
        return False
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        for ch in source_channels():
            newest = c.execute("SELECT value FROM tsdr_lessons_state WHERE key = ?",
                               (f"cursor:{ch}",)).fetchone()
            if not newest:
                continue                      # never scanned: the normal scan reads it all
            c.execute("DELETE FROM tsdr_lessons_state WHERE key = ?", (f"backfill_done:{ch}",))
            c.execute("INSERT INTO tsdr_lessons_state(key, value) VALUES (?, ?) "
                      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                      (f"backfill:{ch}", str(int(newest[0]) + 1)))
        c.commit()
    set_state(_LINK_RESCAN_KEY, "1")
    return True


def reopen_skipped_clips() -> int:
    if get_state(_REOPEN_DONE_KEY):
        return 0
    marks = ",".join("?" * len(_REOPEN_REASONS))
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        n = c.execute(f"UPDATE tsdr_lessons SET status = 'new', attempts = 0, last_error = NULL "
                      f"WHERE status = 'skipped' AND last_error IN ({marks})",
                      _REOPEN_REASONS).rowcount
        c.commit()
    set_state(_REOPEN_DONE_KEY, "1")
    return n


# ── library v2: the Forum channel ────────────────────────────────────────────
# One forum post per lesson, tagged with its section, level and speaker, so
# Discord's own tag filter and sort do the browsing. A pinned "Index" post
# lists every lesson by section. Owner decisions 2026-10-18.

_FORUM = 15                                  # channel type GUILD_FORUM
_PINNED = 1 << 1                             # thread flag
_SORT_BY_CREATION = 1
_LIST_LAYOUT = 1
_MAX_FORUM_TAGS = 20
_SECTION_EMOJI = {"setups": "📐", "management": "🧭", "market": "🌐", "mindset": "🧠",
                  "clips": "🎬"}
_LEVEL_EMOJI = {"beginner": "🌱", "intermediate": "📈", "advanced": "🏔️"}
SPEAKER_TAGS = tuple(label for _, label in AUTHOR_NAMES.values())
INDEX_NAME = "Index"
_INDEX_EMBED_MAX = 3900
RELATED_MAX = 3
RELATED_REFRESH_S = 30 * 24 * 3600
_PENCIL = "%E2%9C%8F%EF%B8%8F"              # ✏️, as Discord's reaction routes want it
FORUM_GUIDELINES = (
    "Every video lesson Patrick and Bracco share in #tsdr and #bracco, one post each: "
    "the recap, the key moments and the video. Filter by tag — the section (Setups & "
    "Entries, Trade Management, Market Read, Mindset & Process, Clips & Quick Takes), the "
    "level (Beginner, Intermediate, Advanced) or the speaker — or open the pinned Index "
    "for every lesson by section.")


def forum_name() -> str:
    return _env("TSDR_LESSONS_FORUM_NAME", "lesson-library")


def reviewer_ids() -> set[str]:
    """Who may mark a post ✏️ for a rewrite: the two speakers unless told otherwise."""
    return set(_csv_env("TSDR_LESSONS_REVIEWER_IDS", ",".join(AUTHOR_NAMES)))


def post_url(post_id: str) -> str:
    return f"https://discord.com/channels/{guild_id()}/{post_id}"


def _mark_index_dirty() -> None:
    set_state("index_dirty", "1")


def forum_tag_specs() -> list[dict]:
    """The tags the forum carries, in order: sections, levels, speakers."""
    specs = [{"name": name, "moderated": False, "emoji_name": _SECTION_EMOJI[key]}
             for key, name, _ in SECTIONS]
    specs += [{"name": lvl.capitalize(), "moderated": False, "emoji_name": _LEVEL_EMOJI[lvl]}
              for lvl in LEVELS]
    specs += [{"name": label, "moderated": False} for label in SPEAKER_TAGS]
    return specs


# The forum overwrite ladder adds the in-post reply bit for the bot first (a
# forum post's video goes up as a reply inside the post); the shared ladder
# then drops bits until Discord accepts one.
_FORUM_OVERWRITE_LADDER = (
    {"bot_bits": _VIEW_CHANNEL | _SEND_MESSAGES | _EMBED_LINKS | _READ_HISTORY
     | _SEND_IN_THREADS},
) + _OVERWRITE_LADDER


def ensure_forum() -> str:
    """The forum channel: TSDR_LESSONS_FORUM_CHANNEL_ID, else the one this
    module made (remembered), else one with the forum's name in the guild,
    else created under the EDUCATION category, members read-only. Raises
    DiscordError (403 = no Manage Channels: make a Forum channel called
    `lesson-library` by hand and the bot finds it)."""
    override = _env("TSDR_LESSONS_FORUM_CHANNEL_ID", "")
    if override:
        return override
    known = get_state("forum_channel_id")
    if known:
        return known
    guild = guild_id()
    channels = _discord("GET", f"/guilds/{guild}/channels") or []
    name = forum_name().lower()
    existing = next((c for c in channels if c.get("type") == _FORUM
                     and str(c.get("name") or "").lower() == name), None)
    if existing:
        set_state("forum_channel_id", str(existing["id"]))
        return str(existing["id"])
    category = next((c for c in channels if c.get("type") == 4
                     and str(c.get("name") or "").lower() == category_name().lower()), None)
    if not category:
        category = _discord("POST", f"/guilds/{guild}/channels",
                            body={"name": category_name(), "type": 4})
    me = _discord("GET", "/users/@me") or {}
    source = _discord("GET", f"/channels/{source_channels()[0]}") or {}
    created, last_error = None, None
    for step in _FORUM_OVERWRITE_LADDER:
        body = {"name": forum_name(), "type": _FORUM, "parent_id": str(category["id"]),
                "topic": FORUM_GUIDELINES, "default_sort_order": _SORT_BY_CREATION,
                "default_forum_layout": _LIST_LAYOUT, "available_tags": forum_tag_specs(),
                "permission_overwrites": _read_only_overwrites(
                    source.get("permission_overwrites") or [], str(me.get("id") or ""),
                    guild, **step)}
        try:
            created = _discord("POST", f"/guilds/{guild}/channels", body=body)
            break
        except DiscordError as e:
            if e.status != 403:
                raise
            last_error = e
    if created is None:
        log.warning("[tsdr-lessons] cannot create the forum (%s): make a Forum channel named "
                    "#%s under %s by hand; the bot finds it by name", last_error, forum_name(),
                    category_name())
        raise last_error
    set_state("forum_channel_id", str(created["id"]))
    log.info("[tsdr-lessons] created the #%s forum (%s)", forum_name(), created["id"])
    return str(created["id"])


def forum_tags() -> dict:
    """{tag name: tag id} for the forum. Tags the forum lacks are added (the
    ones it has are kept as they are); a bot that may not edit the channel
    uses what is there and says which to add by hand."""
    forum = ensure_forum()
    cached = get_state("forum_tags")
    if cached:
        tags = json.loads(cached)
        if all(spec["name"] in tags for spec in forum_tag_specs()):
            return tags
    channel = _discord("GET", f"/channels/{forum}") or {}
    have = list(channel.get("available_tags") or [])
    names = {str(t.get("name")) for t in have}
    missing = [spec for spec in forum_tag_specs() if spec["name"] not in names]
    if missing and len(have) + len(missing) <= _MAX_FORUM_TAGS:
        try:
            channel = _discord("PATCH", f"/channels/{forum}",
                               body={"available_tags": have + missing}) or channel
            have = list(channel.get("available_tags") or have)
        except DiscordError as e:
            log.warning("[tsdr-lessons] could not add forum tags %s (%s): add them by hand",
                        [m["name"] for m in missing], e)
    tags = {str(t.get("name")): str(t.get("id")) for t in have if t.get("id")}
    set_state("forum_tags", json.dumps(tags))
    return tags


def applied_tags(lesson: dict, tags: dict) -> list[str]:
    """The post's tags: its section, its level (when it has one), its speaker."""
    names = [dict((k, n) for k, n, _ in SECTIONS)[section_for(lesson)]]
    if lesson.get("level") in LEVELS:
        names.append(str(lesson["level"]).capitalize())
    names.append(speaker_label(lesson))
    return [tags[n] for n in names if n in tags][:5]


def post_to_forum(lesson: dict, link: str) -> dict:
    """One forum post for a lesson: the recap embed as the starter message,
    then the video (a forward, or the YouTube link) inside the post. Returns
    {post, video}; `video` is "" when Discord refused the forward and there is
    no YouTube copy yet (the refill adds it later)."""
    forum = ensure_forum()
    body = {"name": str(lesson["title"])[:100], "auto_archive_duration": _THREAD_ARCHIVE_MINUTES,
            "applied_tags": applied_tags(lesson, forum_tags()), "message": _lesson_body(lesson, link)}
    post = _discord("POST", f"/channels/{forum}/threads", body=body) or {}
    pid = str(post["id"])
    video_id = ""
    try:
        sent = _in_thread("POST", pid, f"/channels/{pid}/messages",
                          youtube_video_body(lesson) if link_video_id(lesson)
                          else forward_body(lesson)) or {}
        video_id = str(sent.get("id") or "")
    except DiscordError as e:
        log.warning("[tsdr-lessons] could not put the video in post %s: %s", pid, e)
        if lesson.get("youtube_id"):
            try:
                sent = _in_thread("POST", pid, f"/channels/{pid}/messages",
                                  youtube_video_body(lesson)) or {}
                video_id = str(sent.get("id") or "")
            except DiscordError as e2:
                log.warning("[tsdr-lessons] could not post the YouTube copy in %s: %s", pid, e2)
    return {"post": pid, "video": video_id}


def lesson_url(row: dict) -> str:
    """Where a posted lesson lives: its forum post, else its recap message in
    its section thread; "" when it is not posted anywhere."""
    if row.get("forum_post_id"):
        return post_url(row["forum_post_id"])
    if row.get("post_channel_id") and row.get("discord_post_id"):
        return jump_link(guild_id(), row["post_channel_id"], row["discord_post_id"])
    return ""


# ── /lesson: search the library ──────────────────────────────────────────────
# A member types a few words in Discord and gets the two or three lessons that
# answer, each with the moment in the video where the words are said. Private
# to the member (the reply is ephemeral), so the channels stay as they are.

_SEARCH_STOP = frozenset("""a an the and or of to in on for is are was be how what why when do does
did i my me we you your it its this that with about from at as can should would could will
there here any some more most less very just like get got vs""".split())
_SEARCH_MAX = 3
_SNIPPET_CHARS = 150


def search_words(query: str) -> list[str]:
    """The words worth matching: lowercase, letters and digits, 2+ characters,
    stop words out, a leading $ dropped so "$NVDA" and "nvda" are one word."""
    out = []
    for w in re.findall(r"[A-Za-z0-9$&.'-]+", str(query or "").lower()):
        w = w.strip("$.'-&")
        if len(w) >= 2 and w not in _SEARCH_STOP and w not in out:
            out.append(w)
    return out


def _count(hay: str, word: str, cap: int = 5) -> int:
    return min(cap, len(re.findall(rf"(?<![a-z0-9]){re.escape(word)}(?![a-z0-9])", hay)))


def best_moment(row: dict, words: list[str]) -> tuple[Optional[float], str]:
    """The start of the transcript part that says the most of the words, and a
    short quote around the first of them; (None, "") when nothing matches."""
    best, best_hits = None, 0
    for seg in _json_list(row.get("segments")):
        if not (isinstance(seg, (list, tuple)) and len(seg) == 2):
            continue
        start, text = seg
        low = str(text or "").lower()
        hits = sum(1 for w in words if _count(low, w, 1))
        if hits > best_hits:
            best, best_hits = (float(start or 0), str(text or "")), hits
    if not best:
        return None, ""
    start, text = best
    text = re.sub(r"\s+", " ", text).strip()
    low = text.lower()
    at = min((m.start() for w in words for m in [re.search(rf"(?<![a-z0-9]){re.escape(w)}", low)] if m),
             default=0)
    lo = max(0, at - _SNIPPET_CHARS // 3)
    hi = min(len(text), lo + _SNIPPET_CHARS)
    quote = text[lo:hi].strip()
    if lo > 0:
        quote = "…" + quote.lstrip(" ,.;:")
    if hi < len(text):
        quote = quote.rstrip(" ,.;:") + "…"
    return start, quote


def score_lesson(row: dict, words: list[str], phrase: str) -> float:
    """How well a posted lesson answers the words: its title and tickers count
    most, then its tags and recap, then how often the transcript says them. A
    clip counts for less than a lesson. 0 = no match at all."""
    title = clean_title(row.get("title")).lower()
    recap = f"{row.get('recap') or ''} {row.get('takeaway') or ''} {row.get('question') or ''}".lower()
    transcript = str(row.get("transcript") or "").lower()
    tickers = {str(t).lower().lstrip("$") for t in _json_list(row.get("tickers"))}
    tags = " ".join(str(t).lower() for t in _json_list(row.get("tags")))
    score = 0.0
    for w in words:
        score += 6 * _count(title, w, 1) + (6 if w in tickers else 0) + 3 * _count(tags, w, 1)
        score += 3 * _count(recap, w, 1) + _count(transcript, w, 5)
    if phrase and len(words) > 1:
        score += 6 * _count(title, phrase, 1) + 4 * _count(recap, phrase, 1) + 3 * _count(transcript, phrase, 1)
    if row.get("section") == "clips":
        score *= 0.6
    return score


def search_lessons(query: str, limit: int = _SEARCH_MAX) -> list[dict]:
    """The posted lessons that best answer `query`, best first, each with where
    it lives, its level and section, and the moment in the video that says it."""
    words = search_words(query)
    if not words:
        return []
    phrase = " ".join(words)
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT attachment_id, title, recap, takeaway, question, tickers, tags, transcript, "
            "segments, section, level, posted_at, post_channel_id, discord_post_id, forum_post_id, "
            "youtube_id FROM tsdr_lessons WHERE status = 'posted' AND discord_post_id IS NOT NULL "
            "AND post_channel_id IS NOT NULL").fetchall()]
    scored = [(score_lesson(r, words, phrase), r) for r in rows]
    scored = sorted((s for s in scored if s[0] > 0), key=lambda s: (-s[0], -int(s[1]["posted_at"] or 0)))
    names = {k: n for k, n, _ in SECTIONS}
    out = []
    for score, r in scored[:max(1, int(limit))]:
        t, quote = best_moment(r, words)
        day = datetime.fromtimestamp(int(r["posted_at"]), tz=timezone.utc).astimezone(_ET)
        out.append({"attachment_id": r["attachment_id"], "title": clean_title(r["title"]) or "Lesson",
                    "url": lesson_url(r), "level": r.get("level") or "",
                    "section": names.get(r.get("section") or "", ""),
                    "day": f"{day:%b} {day.day}, {day.year}", "score": score,
                    "at": fmt_time(t) if t is not None else "", "watch": seek_link(r, t) if t is not None else "",
                    "quote": quote})
    return out


def format_search_reply(query: str, hits: list[dict]) -> str:
    """The Discord text for a search: one line per lesson with a link to the
    recap, its level, section and date, then the moment in the video that says
    it. Links are wrapped in <> so the reply carries no previews."""
    q = re.sub(r"\s+", " ", str(query or "")).strip()[:80]
    if not hits:
        return (f"Nothing in the lesson library says anything about “{q}” yet. "
                "Try fewer or different words, or a ticker like NVDA.")
    lines = [f"**Lessons on “{q}”**"]
    for i, h in enumerate(hits, 1):
        title = h["title"][:70]
        head = f"{i}. **[{title}](<{h['url']}>)**" if h.get("url") else f"{i}. **{title}**"
        meta = " · ".join(x for x in (h.get("level", "").capitalize(), h.get("section"), h.get("day")) if x)
        lines.append(f"{head} · {meta}" if meta else head)
        if h.get("quote"):
            where = (f"[Watch from {h['at']}](<{h['watch']}>) — " if h.get("watch")
                     else (f"At {h['at']} — " if h.get("at") else ""))
            lines.append(f"   ▸ {where}“{h['quote']}”")
    return "\n".join(lines)[:1900]


def related_lessons(lesson: dict, limit: int = RELATED_MAX) -> list[dict]:
    """Up to `limit` other posted lessons, closest first: 3 points per shared
    ticker, 2 per shared tag, 1 for the same section; newer wins a tie. Clips
    are never related to anything, in either direction. With the forum on,
    only forum lessons count (the threads are being emptied); each entry is
    {title, post} for a forum lesson and {title, url} for a thread one."""
    if section_for(lesson) == "clips":
        return []
    mine_t = set(_json_list(lesson.get("tickers")))
    mine_tags = set(_json_list(lesson.get("tags")))
    mine_sec = section_for(lesson)
    scope = "AND forum_post_id IS NOT NULL " if forum_enabled() else ""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT attachment_id, title, tickers, tags, section, forum_post_id, posted_at, "
            "discord_post_id, post_channel_id FROM tsdr_lessons WHERE status = 'posted' "
            f"AND discord_post_id IS NOT NULL {scope}"
            "AND attachment_id != ? AND (section IS NULL OR section != 'clips')",
            (str(lesson.get("attachment_id") or ""),)).fetchall()
        rows = [dict(r) for r in rows]
    scored = []
    for r in rows:
        score = (3 * len(mine_t & set(_json_list(r["tickers"])))
                 + 2 * len(mine_tags & set(_json_list(r["tags"])))
                 + (1 if r["section"] == mine_sec else 0))
        if score > 0 and lesson_url(r):
            scored.append((-score, -int(r["posted_at"] or 0), r))
    scored.sort(key=lambda x: (x[0], x[1]))
    out = []
    for _, _, r in scored[:limit]:
        if r["forum_post_id"]:
            out.append({"title": r["title"], "post": r["forum_post_id"]})
        else:
            out.append({"title": r["title"], "url": lesson_url(r)})
    return out


_LEVEL_SYS = (
    "You sort trading lessons by who they are for. Answer with ONE word only: beginner "
    "(a first principle every new member needs), advanced (assumes the member already "
    "trades these setups and manages positions), or intermediate (everything else)."
)


def classify_level(title: str, recap: str) -> str:
    """The level of a lesson written before levels existed, from its title and
    recap; intermediate when the model is unavailable or unclear."""
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client().with_options(timeout=60.0)
        msg = client.messages.create(
            model=_model(), max_tokens=10, system=_LEVEL_SYS,
            messages=[{"role": "user", "content": f"TITLE: {title}\nRECAP: {recap}"}],
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default", "output_config": {"effort": "low"}})
        text = "".join(getattr(b, "text", "") for b in msg.content
                       if getattr(b, "type", "") == "text").strip().lower()
        word = re.sub(r"[^a-z]", "", text.split()[0]) if text.split() else ""
        return word if word in LEVELS else "intermediate"
    except Exception as e:  # noqa: BLE001
        log.info("[tsdr-lessons] could not classify a level: %s", e)
        return "intermediate"


def run_forum_migration(*, deadline: float, limit: Optional[int] = None) -> dict:
    """Lessons posted before the forum, oldest first, N per tick: each becomes
    a forum post (with a level worked out if it has none, and its related
    lessons). A lesson whose old post the owner deleted is not moved; one
    that repeats a lesson already in the forum is recorded as a duplicate.
    The old posts are left where they are (the owner deletes the channel)."""
    limit = limit or _int_env("TSDR_LESSONS_FORUM_MIGRATE_PER_TICK", 10)
    out = {"moved": 0, "duplicate": 0, "removed": 0, "errors": 0, "left": 0}
    where = (f"WHERE status = 'posted' AND forum_post_id IS NULL "
             f"AND (section IS NULL OR section != '{REMOVED}')")
    with contextlib.closing(_connect()) as c:
        total = int(c.execute(f"SELECT COUNT(*) FROM tsdr_lessons {where}").fetchone()[0])
        rows = [dict(r) for r in c.execute(
            f"SELECT * FROM tsdr_lessons {where} ORDER BY posted_at LIMIT ?",
            (int(limit),)).fetchall()]
    if not rows:
        return out
    for row in rows:
        if time.time() > deadline:
            break
        aid = row["attachment_id"]
        try:
            if row.get("discord_post_id") and row.get("post_channel_id") and \
                    not lesson_post_exists(row["post_channel_id"], row["discord_post_id"]):
                _update(aid, status="removed")        # "not this one"
                out["removed"] += 1
                continue
            twin = find_duplicate(row.get("transcript") or "", row["author_id"], aid,
                                  in_forum=True)
            if twin:
                _update(aid, status="duplicate", duplicate_of=twin)
                out["duplicate"] += 1
                continue
            level = row.get("level") or ""
            if level not in LEVELS and section_for(row) != "clips":
                level = classify_level(row.get("title") or "", row.get("recap") or "")
                _update(aid, level=level)
            lesson = {**row, "level": level or None}
            related = related_lessons(lesson)
            placed = post_to_forum({**lesson, "related": related},
                                   jump_link(guild_id(), row["channel_id"], row["message_id"]))
            _update(aid, forum_post_id=placed["post"], discord_post_id=placed["post"],
                    post_channel_id=placed["post"], forward_post_id=placed["video"],
                    section=section_for(row), related=json.dumps(related),
                    related_at=int(time.time()))
            _mark_index_dirty()
            out["moved"] += 1
        except Exception as e:  # noqa: BLE001 — retried on the next tick
            log.warning("[tsdr-lessons] could not move %s into the forum: %s", aid, e)
            out["errors"] += 1
        _sleep(1.5)
    out["left"] = max(0, total - out["moved"] - out["duplicate"] - out["removed"])
    return out


def run_related_refresh(*, deadline: float, limit: int = 5) -> dict:
    """Posts whose "See also" is older than RELATED_REFRESH_S (or missing)
    are worked out again and edited in place, so early posts gain links as
    the library grows."""
    out = {"refreshed": 0, "errors": 0}
    cutoff = int(time.time()) - RELATED_REFRESH_S
    scope = "AND forum_post_id IS NOT NULL " if forum_enabled() else ""
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM tsdr_lessons WHERE status = 'posted' AND discord_post_id IS NOT NULL "
            f"AND post_channel_id IS NOT NULL {scope}"
            "AND (related_at IS NULL OR related_at < ?) ORDER BY related_at LIMIT ?",
            (cutoff, int(limit))).fetchall()]
    for row in rows:
        if time.time() > deadline:
            break
        where, mid = row["post_channel_id"], row["discord_post_id"]
        try:
            related = related_lessons(row)
            if json.dumps(related) != (row.get("related") or "[]"):
                link = jump_link(guild_id(), row["channel_id"], row["message_id"])
                _in_thread("PATCH", where, f"/channels/{where}/messages/{mid}",
                           _lesson_body({**row, "related": related}, link))
            _update(row["attachment_id"], related=json.dumps(related), related_at=int(time.time()))
            out["refreshed"] += 1
        except DiscordError as e:
            if e.status == 404:
                _update(row["attachment_id"], status="removed")
                _mark_index_dirty()
                continue
            log.warning("[tsdr-lessons] could not refresh See also on %s: %s", mid, e)
            out["errors"] += 1
    return out


def run_title_repair(*, deadline: float, limit: int = 10) -> dict:
    """A posted lesson whose title is nothing but a link or a mention (a clip
    whose caption was only a URL, posted before clean_title existed) gets a
    real one: the YouTube video's own name for a linked video, else
    "Quick clip, <date>". The post is edited in place and the header index
    refreshed. A renamed row no longer qualifies, so after the first pass
    this finds nothing and costs nothing."""
    out = {"retitled": 0, "errors": 0}
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM tsdr_lessons WHERE status = 'posted' AND discord_post_id IS NOT NULL "
            "AND post_channel_id IS NOT NULL ORDER BY posted_at DESC").fetchall()]
    for row in [r for r in rows if not clean_title(r.get("title"))][:max(0, int(limit))]:
        if time.time() > deadline:
            break
        vid = link_video_id(row)
        title = clean_title(youtube_video_title(vid)) if vid else ""
        if not title:
            posted = datetime.fromtimestamp(int(row["posted_at"]), tz=timezone.utc).astimezone(_ET)
            title = f"Quick clip, {posted:%b} {posted.day}, {posted.year}"
        lesson = {**row, "title": title, "related": _json_list(row.get("related"))}
        where, mid = row["post_channel_id"], row["discord_post_id"]
        try:
            link = jump_link(guild_id(), row["channel_id"], row["message_id"])
            _in_thread("PATCH", where, f"/channels/{where}/messages/{mid}", _lesson_body(lesson, link))
        except DiscordError as e:
            if e.status == 404:
                _update(row["attachment_id"], status="removed")
                _mark_index_dirty()
                continue
            log.warning("[tsdr-lessons] could not retitle %s: %s", mid, e)
            out["errors"] += 1
            continue
        _update(row["attachment_id"], title=title)
        if row.get("edu_video_id"):
            sync_library_row(lesson)
        _mark_index_dirty()
        out["retitled"] += 1
    return out


GONE_FROM_YOUTUBE = "video is no longer on YouTube"


def run_rewrite_requests(*, deadline: float, limit: int = 25) -> dict:
    """A ✏️ reaction from a reviewer on a forum post asks for a rewrite: the
    post comes down and the lesson goes back in the queue (its transcript is
    kept, so no download). Posts are read a slice per tick, least recently
    read first, so every post is looked at within a couple of hours. A post
    that is gone was deleted by hand: the lesson stays out. On the same pass
    a linked lesson whose video YouTube no longer has comes down too: the
    library never points at a dead video."""
    out = {"checked": 0, "rewriting": 0, "removed": 0, "gone": 0, "errors": 0}
    reviewers = reviewer_ids()
    scope = "AND forum_post_id IS NOT NULL " if forum_enabled() else ""
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM tsdr_lessons WHERE status = 'posted' AND discord_post_id IS NOT NULL "
            f"AND post_channel_id IS NOT NULL {scope}"
            "ORDER BY COALESCE(reaction_checked_at, 0), posted_at LIMIT ?",
            (int(limit),)).fetchall()]
    for row in rows:
        if time.time() > deadline:
            break
        aid, where, pid = row["attachment_id"], row["post_channel_id"], row["discord_post_id"]
        try:
            users = _discord("GET", f"/channels/{where}/messages/{pid}/reactions/{_PENCIL}",
                             params={"limit": 100}) or []
        except DiscordError as e:
            if e.status == 404:
                _update(aid, status="removed")
                _mark_index_dirty()
                out["removed"] += 1
                continue
            log.warning("[tsdr-lessons] could not read reactions on %s: %s", pid, e)
            out["errors"] += 1
            continue
        _update(aid, reaction_checked_at=int(time.time()))
        out["checked"] += 1
        vid = link_video_id(row)
        if vid and youtube_video_gone(vid):
            try:
                take_down_post(row)
            except DiscordError as e:
                log.warning("[tsdr-lessons] could not take down %s (video gone): %s", pid, e)
                out["errors"] += 1
                continue
            _update(aid, status="skipped", last_error=GONE_FROM_YOUTUBE, discord_post_id=None,
                    post_channel_id=None, forward_post_id=None, related=None)
            _mark_index_dirty()
            out["gone"] += 1
            continue
        if not any(str(u.get("id")) in reviewers for u in users if isinstance(u, dict)):
            continue
        try:
            take_down_post(row)
        except DiscordError as e:
            log.warning("[tsdr-lessons] could not take down %s for its rewrite: %s", pid, e)
            out["errors"] += 1
            continue
        _update(aid, status="new", attempts=0, redo=0, last_error=None, forum_post_id=None,
                discord_post_id=None, post_channel_id=None, forward_post_id=None,
                section=None, related=None)
        out["rewriting"] += 1
    return out


def _index_lines(section_key: str) -> list[str]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT title, forum_post_id, posted_at FROM tsdr_lessons WHERE status = 'posted' "
            "AND forum_post_id IS NOT NULL AND section = ? ORDER BY posted_at",
            (section_key,)).fetchall()
    out = []
    for r in rows:
        day = datetime.fromtimestamp(int(r["posted_at"]), tz=timezone.utc).astimezone(_ET)
        out.append(f"• [{str(r['title'])[:80]}]({post_url(r['forum_post_id'])}) · "
                   f"{day:%b} {day.day}, {day.year}")
    return out


def _pack(lines: list[str], limit: int = _INDEX_EMBED_MAX) -> list[str]:
    chunks, cur = [], ""
    for line in lines:
        if cur and len(cur) + 1 + len(line) > limit:
            chunks.append(cur)
            cur = ""
        cur = f"{cur}\n{line}" if cur else line
    if cur:
        chunks.append(cur)
    return chunks


def refresh_index(*, force: bool = False) -> dict:
    """The pinned Index post: one embed per section in its thread, every
    lesson as a link, edited in place whenever a lesson was added, rewritten
    or removed since the last run (the dirty mark). A section past one embed's
    worth continues in the next message; messages no longer needed go."""
    if not force and get_state("index_dirty") != "1":
        return {"updated": 0}
    forum = ensure_forum()
    post = get_state("index_post_id")
    if not post:
        intro = {"embeds": [{"title": "How to use this library", "color": _EMBED_COLOR,
                             "description": FORUM_GUIDELINES}],
                 "allowed_mentions": {"parse": []}}
        created = _discord("POST", f"/channels/{forum}/threads",
                           body={"name": INDEX_NAME, "auto_archive_duration": _THREAD_ARCHIVE_MINUTES,
                                 "message": intro}) or {}
        post = str(created["id"])
        set_state("index_post_id", post)
        try:
            _discord("PATCH", f"/channels/{post}", body={"flags": _PINNED})
        except DiscordError as e:
            log.info("[tsdr-lessons] could not pin the index: %s", e)
    msgs = json.loads(get_state("index_messages") or "{}")
    updated = 0
    for key, name, _ in SECTIONS:
        chunks = _pack(_index_lines(key)) or ["Nothing here yet."]
        ids, kept = list(msgs.get(key) or []), []
        for i, chunk in enumerate(chunks):
            body = {"embeds": [{"title": name if i == 0 else f"{name} (continued)",
                                "description": chunk, "color": _EMBED_COLOR}],
                    "allowed_mentions": {"parse": []}}
            mid = ids[i] if i < len(ids) else ""
            if mid:
                try:
                    _in_thread("PATCH", post, f"/channels/{post}/messages/{mid}", body)
                except DiscordError as e:
                    if e.status != 404:
                        raise
                    mid = ""
            if not mid:
                sent = _in_thread("POST", post, f"/channels/{post}/messages", body) or {}
                mid = str(sent.get("id") or "")
            kept.append(mid)
            updated += 1
        for extra in ids[len(chunks):]:
            try:
                _in_thread("DELETE", post, f"/channels/{post}/messages/{extra}", None)
            except DiscordError as e:
                if e.status != 404:
                    log.warning("[tsdr-lessons] could not drop index message %s: %s", extra, e)
        msgs[key] = kept
    set_state("index_messages", json.dumps(msgs))
    set_state("index_dirty", "0")
    return {"updated": updated}


# ── library v2 in the threads: levels for old lessons, the header index ──────
# Without the forum (the owner's choice, 2026-10-18), the five section header
# posts in #video-lessons ARE the table of contents: each is edited into a
# live, level-grouped list of its thread's lessons, newest first, with a jump
# link to every recap.

_INDEX_TOTAL_MAX = 5800          # Discord: 6,000 characters across a message's embeds
_INDEX_DESC_MAX = 4000
_INDEX_TITLE_CHARS = 48
_INDEX_MAX_EMBEDS = 9
_CLIPS_INDEX_MAX = 12            # the Clips header sits at the bottom of the channel: keep it short


def run_level_backfill(*, deadline: float, limit: int = 15) -> dict:
    """Lessons written before levels existed get one from their title and recap,
    a few per tick; clips have no level."""
    out = {"classified": 0}
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            "SELECT attachment_id, title, recap FROM tsdr_lessons WHERE status = 'posted' "
            "AND (level IS NULL OR level = '') AND (section IS NULL OR section != 'clips') "
            "AND title IS NOT NULL ORDER BY posted_at DESC LIMIT ?", (int(limit),)).fetchall()]
    for row in rows:
        if time.time() > deadline:
            break
        _update(row["attachment_id"], level=classify_level(row["title"], row.get("recap") or ""))
        out["classified"] += 1
    if out["classified"]:
        _mark_index_dirty()
    return out


def _index_rows(section_key: str) -> list[dict]:
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(
            "SELECT title, level, posted_at, forum_post_id, post_channel_id, discord_post_id "
            "FROM tsdr_lessons WHERE status = 'posted' AND section = ? AND discord_post_id "
            "IS NOT NULL AND post_channel_id IS NOT NULL ORDER BY posted_at DESC",
            (section_key,)).fetchall()]


def thread_index_embeds(key: str, name: str, blurb: str, rows: list[dict]) -> list[dict]:
    """The header post's embeds: the section's blurb, then one embed per level
    (clips: one list), each lesson a link to its recap, newest first. Stops at
    Discord's size limit and says how many more are in the thread."""
    what = "clips" if key == "clips" else "lessons"
    head = {"title": f"{name} · {len(rows)} {what}" if rows else name, "color": _EMBED_COLOR,
            "description": (f"{blurb}\n\nEvery lesson in this section is in the thread "
                            "below. Click a title to jump to its recap and video.")}
    embeds, used, more = [head], len(head["title"]) + len(head["description"]), 0
    if key == "clips":
        groups = [("Newest first", rows[:_CLIPS_INDEX_MAX])]
        more += max(0, len(rows) - _CLIPS_INDEX_MAX)
    else:
        groups = [(f"{_LEVEL_EMOJI[lvl]} {lvl.capitalize()}",
                   [r for r in rows if r.get("level") == lvl]) for lvl in LEVELS]
        groups.append(("More lessons", [r for r in rows if r.get("level") not in LEVELS]))
    for title, items in groups:
        lines = []
        for r in items:
            day = datetime.fromtimestamp(int(r["posted_at"]), tz=timezone.utc).astimezone(_ET)
            short = clean_title(r["title"]) or "Clip"
            if len(short) > _INDEX_TITLE_CHARS:
                short = short[:_INDEX_TITLE_CHARS - 1].rstrip() + "…"
            line = f"• [{short}]({lesson_url(r)}) · {day:%b} {day.day}"
            room = (used + len(title) + len(line) + 1 <= _INDEX_TOTAL_MAX
                    and len("\n".join(lines + [line])) <= _INDEX_DESC_MAX
                    and len(embeds) < _INDEX_MAX_EMBEDS)
            if not room:
                more += 1
                continue
            lines.append(line)
            used += len(line) + 1
        if lines:
            embeds.append({"title": title, "description": "\n".join(lines), "color": _EMBED_COLOR})
            used += len(title)
    if more:
        embeds[-1]["description"] += f"\n… and {more} more in the thread"
    return embeds


def refresh_thread_index(*, force: bool = False) -> dict:
    """Edit each section's header post into its table of contents whenever a
    lesson was added, moved, rewritten or removed (the dirty mark; a header
    never written counts as dirty). A header the owner deleted is skipped."""
    if not force and get_state("index_dirty") == "0":
        return {"updated": 0}
    channel = ensure_lesson_channel()
    threads = ensure_section_threads()
    updated = 0
    for key, name, blurb in SECTIONS:
        header = threads.get(key)       # a thread started from a message shares its id
        if not header:
            continue
        body = {"embeds": thread_index_embeds(key, name, blurb, _index_rows(key)),
                "allowed_mentions": {"parse": []}}
        try:
            _in_thread("PATCH", header, f"/channels/{channel}/messages/{header}", body)
        except DiscordError as e:
            if e.status != 404:
                raise
            log.info("[tsdr-lessons] the %s header post is gone; no index for it", name)
            continue
        updated += 1
    set_state("index_dirty", "0")
    return {"updated": updated}


# ── the scheduled entry point ────────────────────────────────────────────────

def tick() -> dict:
    """Scan, lessons, regroup, then YouTube. Never raises; never overlaps itself."""
    if not is_enabled():
        return {"ran": False, "reason": "TSDR_LESSONS_ENABLED is not 1"}
    if not _TICK_LOCK.acquire(blocking=False):
        return {"ran": False, "reason": "previous tick still running"}
    deadline = time.time() + TICK_BUDGET_S
    out: dict = {"ran": True}
    try:
        try:
            if rescan_for_links():
                out["rescan_for_links"] = True
        except Exception as e:  # noqa: BLE001
            log.warning("[tsdr-lessons] could not start the link rescan: %s", e)
        for ch in source_channels():
            try:
                out[f"scan:{ch}"] = scan_channel(ch)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] scan of %s failed: %s", ch, e)
                out[f"scan:{ch}"] = {"error": str(e)[:200]}
        try:
            redo = run_link_redo(deadline=deadline)
            if redo["requeued"] or redo["errors"]:
                out["link_redo"] = redo
        except Exception as e:  # noqa: BLE001
            log.warning("[tsdr-lessons] link rewrite stage failed: %s", e)
        try:
            reopened = reopen_skipped_clips()
            if reopened:
                out["reopened"] = reopened
        except Exception as e:  # noqa: BLE001
            log.warning("[tsdr-lessons] could not reopen skipped clips: %s", e)
        try:
            out["lessons"] = run_lessons(limit=_int_env("TSDR_LESSONS_PER_TICK", 3),
                                         deadline=deadline)
        except Exception as e:  # noqa: BLE001 — e.g. the channel could not be created
            log.warning("[tsdr-lessons] lesson stage failed: %s", e)
            out["lessons"] = {"error": str(e)[:200]}
        if threads_enabled() and not forum_enabled():
            for name, stage in (("levels", run_level_backfill),
                                ("titles", run_title_repair),
                                ("rewrites", run_rewrite_requests),
                                ("related", run_related_refresh)):
                try:
                    result = stage(deadline=deadline)
                    if any(result.values()):
                        out[name] = result
                except Exception as e:  # noqa: BLE001
                    log.warning("[tsdr-lessons] %s stage failed: %s", name, e)
                    out[name] = {"error": str(e)[:200]}
            try:
                out["regroup"] = run_regroup(deadline=deadline)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] regroup stage failed: %s", e)
                out["regroup"] = {"error": str(e)[:200]}
        if forum_enabled():
            for name, stage in (("forum_migration", run_forum_migration),
                                ("rewrites", run_rewrite_requests),
                                ("related", run_related_refresh)):
                try:
                    result = stage(deadline=deadline)
                    if any(result.values()):
                        out[name] = result
                except Exception as e:  # noqa: BLE001
                    log.warning("[tsdr-lessons] %s stage failed: %s", name, e)
                    out[name] = {"error": str(e)[:200]}
        if threads_enabled() or forum_enabled():
            try:
                out["refill"] = run_video_refill(deadline=deadline)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] video refill stage failed: %s", e)
                out["refill"] = {"error": str(e)[:200]}
        if forum_enabled() or threads_enabled():
            try:
                index = refresh_index() if forum_enabled() else refresh_thread_index()
                if index["updated"]:
                    out["index"] = index
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] index stage failed: %s", e)
                out["index"] = {"error": str(e)[:200]}
        if youtube_enabled():
            try:
                gone = remove_clips_from_library()
                if gone:
                    out["clips_off_shelf"] = gone
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] could not take clips off the shelf: %s", e)
            try:
                moved = move_library_rows_to_sections()
                if moved:
                    out["shelved_by_section"] = moved
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] could not move library rows to their shelves: %s", e)
            try:
                out["youtube"] = run_youtube(deadline=deadline)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] YouTube stage failed: %s", e)
                out["youtube"] = {"error": str(e)[:200]}
        return out
    finally:
        _TICK_LOCK.release()
