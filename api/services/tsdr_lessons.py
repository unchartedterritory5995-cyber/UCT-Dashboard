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
_ET = ZoneInfo("America/New_York")
_DISCORD_EPOCH_MS = 1420070400000

TSDR_CHANNEL_ID = "882459873823043655"        # docs/wisdom/discord-sources.json
PATRICK_USER_ID = "339816805805588480"        # docs/wisdom/authors.json (author tsdr)
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
                  ("section", "TEXT"))


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
)
_SECTION_KEYS = tuple(k for k, _, _ in SECTIONS)
# A lesson's section is the one its FIRST tag belongs to (the model lists the
# main topic first). Every tag in TAGS maps to exactly one section.
_TAG_SECTION = {"setups": "setups", "entries": "setups", "exits": "management",
                "risk": "management", "market": "market", "psychology": "mindset",
                "process": "mindset", "review": "mindset"}
_DEFAULT_SECTION = "mindset"


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
    unlisted YouTube copy, which Discord shows as a playable video in place."""
    return {"content": f"https://youtu.be/{lesson['youtube_id']}"}


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
        fwd = _in_thread("POST", thread, f"/channels/{thread}/messages",
                         forward_body(lesson)) or {}
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


def transcribe(video: Path, work: Path) -> tuple[str, float]:
    """(transcript, seconds) through the voice-notes ffmpeg split + Whisper.
    ('', 0.0) when the file carries no audio."""
    from api.services.journal_two import voice_notes

    seconds = voice_notes.probe_duration(video)
    if not seconds:
        return "", 0.0
    if seconds > MAX_VIDEO_SECONDS:
        raise ValueError(f"video is {int(seconds // 60)} minutes, over the cap")
    parts = voice_notes.split_audio(video, work / "parts", duration=seconds)
    text = " ".join(t.strip() for t in (voice_notes.transcribe_part(p, i)
                                        for i, p in enumerate(parts)) if t and t.strip())
    return text, float(seconds)


# ── the recap ────────────────────────────────────────────────────────────────

# Lowercase single words, the same shape as the library's existing tags
# ("earnings", "macro"), so they become Desk > Videos filter chips as-is.
TAGS = ("setups", "entries", "exits", "risk", "market", "psychology", "process", "review")
_TICKER = re.compile(r"^[A-Z]{1,5}(?:\.[A-Z])?$")

_SYS = (
    "You write the lesson log for a stock-trading community's Discord. The head trader "
    "records short videos during and after the trading day, and each one becomes a "
    "post in an education channel so members can find the lesson later.\n"
    "You get the video's transcript, the caption he posted with it, its date, and, when "
    "the video answered a member's question, that question.\n"
    "Return ONLY a JSON object with these keys:\n"
    '  "title": 4-10 words naming the lesson (not the date, no emoji, no quotes).\n'
    '  "recap": 4 to 6 complete sentences, one paragraph, in third person '
    '("Patrick explains..." is fine). Say what the lesson is, the reasoning, and the '
    "takeaway a member should apply. Name tickers, setups and levels exactly as said.\n"
    '  "question_needed": true only if the recap would not make sense without knowing '
    "what was asked.\n"
    '  "question": when question_needed, a one-sentence anonymous paraphrase of what the '
    'member asked (never a name or handle); otherwise "".\n'
    '  "takeaway": ONE short sentence a member should remember and apply.\n'
    '  "tickers": the stock/ETF symbols actually discussed, uppercase, no "$", at most 8.\n'
    f'  "tags": 1 to 3 topics, chosen ONLY from: {", ".join(TAGS)}.\n'
    '  "is_lesson": false when the clip teaches nothing (a joke, a quick "look at this" '
    "with no explanation, a tech test, an announcement); true otherwise.\n"
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
                   question: str = "") -> dict:
    """{is_lesson, title, recap, question, takeaway, tickers, tags} from Claude.
    Raises on an unusable reply."""
    from api.services.engine import _get_anthropic_client

    et = posted.astimezone(_ET)
    user = f"DATE: {et:%A, %B} {et.day}, {et.year}\n"
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
    if data.get("is_lesson") is False:
        return {"is_lesson": False}
    title = re.sub(r"\s+", " ", str(data.get("title") or "")).strip().strip('"')[:120]
    sentences = split_sentences(str(data.get("recap") or ""))
    if not title or len(sentences) < 3:
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
    return {"is_lesson": True, "title": title, "recap": " ".join(sentences[:6]),
            "question": q[:400], "takeaway": str(data.get("takeaway") or "").strip()[:300],
            "tickers": tickers[:8], "tags": tags[:3]}


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
    parts = [t.capitalize() for t in _json_list(lesson.get("tags"))]
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
            "footer": {"text": f"From #tsdr{minutes}"}}


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


def process_lesson(row: dict, lesson_channel: str) -> str:
    """One video, start to finish. Returns the row's new status."""
    aid = row["attachment_id"]
    msg = fetch_message(row["channel_id"], row["message_id"])
    att = next((a for a in (msg or {}).get("attachments") or []
                if str(a.get("id")) == aid), None)
    if not msg or not att:
        _update(aid, status="skipped", last_error="message or video was deleted")
        return "skipped"
    work = Path(tempfile.mkdtemp(prefix="tsdr-lesson-"))
    try:
        video = work / ("video" + (Path(str(att.get("filename") or "")).suffix or ".mp4"))
        download(str(att.get("url") or att.get("proxy_url")), video)
        transcript, seconds = transcribe(video, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    caption = row.get("caption") or ""
    if len(transcript.split()) < MIN_WORDS and len(caption.split()) < MIN_WORDS:
        _update(aid, status="skipped", duration_s=seconds, transcript=transcript,
                last_error="no spoken lesson to recap")
        return "skipped"
    posted = datetime.fromtimestamp(int(row["posted_at"]), tz=timezone.utc)
    recap = generate_recap(transcript=transcript, caption=caption, posted=posted,
                           question=_question_for(msg) if row.get("is_reply") else "")
    if not recap.pop("is_lesson", True):
        _update(aid, status="skipped", duration_s=seconds, transcript=transcript,
                last_error="not a lesson")
        return "skipped"
    _update(aid, duration_s=seconds, transcript=transcript, title=recap["title"],
            recap=recap["recap"], question=recap["question"], takeaway=recap["takeaway"],
            tickers=json.dumps(recap["tickers"]), tags=json.dumps(recap["tags"]))
    lesson = {**row, **recap, "duration_s": seconds}
    link = jump_link(guild_id(), row["channel_id"], row["message_id"])
    if threads_enabled():
        placed = post_to_section(lesson, link)
        _update(aid, status="posted", discord_post_id=placed["post_id"],
                post_channel_id=placed["thread"], forward_post_id=placed["forward_id"],
                section=placed["section"], lesson_posted_at=int(time.time()),
                last_error=None)
        return "posted"
    post_id = post_lesson(lesson_channel, lesson, link)
    _update(aid, status="posted", discord_post_id=post_id, post_channel_id=lesson_channel,
            lesson_posted_at=int(time.time()), last_error=None)
    return "posted"


def run_lessons(*, limit: int, deadline: float) -> dict:
    out = {"posted": 0, "skipped": 0, "errors": 0}
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
        if old_post:
            try:
                _in_thread("DELETE", thread, f"/channels/{thread}/messages/{old_post}", None)
            except DiscordError as e:
                log.warning("[tsdr-lessons] refilled %s but could not delete the old recap: %s",
                            aid, e)
        out["refilled"] += 1
        _sleep(1.0)
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
    suffix = f" | TSDR {posted.month}/{posted.day}/{posted.year % 100:02d}"
    return lesson["title"][:100 - len(suffix)].rstrip() + suffix


def youtube_description(lesson: dict) -> str:
    posted = datetime.fromtimestamp(int(lesson["posted_at"]), tz=timezone.utc).astimezone(_ET)
    text = ""
    if lesson.get("question"):
        text += f"Question: {lesson['question']}\n\n"
    text += lesson["recap"]
    if lesson.get("takeaway"):
        text += f"\n\nKey takeaway: {lesson['takeaway']}"
    text += (f"\n\nOriginally shared in the Uncharted Territory Discord (#tsdr) on "
             f"{posted:%B} {posted.day}, {posted.year}.")
    return text.replace("<", "").replace(">", "")[:4900]


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
    cat = library_category()
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
    education_service.set_video_insights(
        int(created["id"]), transcript=row.get("transcript") or "",
        headline=row["title"], summary=split_sentences(row["recap"]))
    tags = _json_list(row.get("tags"))
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
            f"AND yt_attempts < ? "
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
        for ch in source_channels():
            try:
                out[f"scan:{ch}"] = scan_channel(ch)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] scan of %s failed: %s", ch, e)
                out[f"scan:{ch}"] = {"error": str(e)[:200]}
        try:
            out["lessons"] = run_lessons(limit=_int_env("TSDR_LESSONS_PER_TICK", 3),
                                         deadline=deadline)
        except Exception as e:  # noqa: BLE001 — e.g. the channel could not be created
            log.warning("[tsdr-lessons] lesson stage failed: %s", e)
            out["lessons"] = {"error": str(e)[:200]}
        if threads_enabled():
            try:
                out["regroup"] = run_regroup(deadline=deadline)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] regroup stage failed: %s", e)
                out["regroup"] = {"error": str(e)[:200]}
            try:
                out["refill"] = run_video_refill(deadline=deadline)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] video refill stage failed: %s", e)
                out["refill"] = {"error": str(e)[:200]}
        if youtube_enabled():
            try:
                out["youtube"] = run_youtube(deadline=deadline)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] YouTube stage failed: %s", e)
                out["youtube"] = {"error": str(e)[:200]}
        return out
    finally:
        _TICK_LOCK.release()
