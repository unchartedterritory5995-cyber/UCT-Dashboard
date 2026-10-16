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

Stages, each run by `tick()` every 15 minutes on the web pod:
  1. scan     — REST-poll the source channels (forward + resumable backfill),
                record one row per video attachment. No downloads.
  2. lessons  — at most TSDR_LESSONS_PER_TICK videos: re-fetch the message (a
                Discord CDN url expires, the message hands out a fresh one),
                download, transcribe, recap, post.        TSDR_LESSONS_ENABLED
  3. youtube  — at most TSDR_LESSONS_YT_PER_DAY uploads per ET day (the Data API
                quota is shared with the daily session uploads), then the
                edu_videos row.                    TSDR_LESSONS_YOUTUBE_ENABLED

Both gates default OFF and are read per call, so a flag flip is the only lever.
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
MAX_PAGES_PER_TICK = 5
MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024       # Discord's own ceiling is 500 MB
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
_DESCRIPTION_MAX = 4000

_WRITE_LOCK = threading.Lock()
_TICK_LOCK = threading.Lock()
_sleep = time.sleep  # injectable for tests


# ── config (read at call time) ───────────────────────────────────────────────

def is_enabled() -> bool:
    return os.environ.get("TSDR_LESSONS_ENABLED", "") == "1"


def youtube_enabled() -> bool:
    return os.environ.get("TSDR_LESSONS_YOUTUBE_ENABLED", "") == "1"


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
    return _env("TSDR_LESSONS_DB_PATH", "/data/tsdr_lessons.db")


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
  discord_post_id TEXT,
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


def _connect() -> sqlite3.Connection:
    path = _db_path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
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


def scan_channel(channel_id: str, *, max_pages: int = MAX_PAGES_PER_TICK) -> dict:
    """Forward pages first (new posts), the rest of the budget on the backfill
    down to TSDR_LESSONS_SINCE. A cursor moves only after its page is recorded."""
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
            set_state(done_key, "1")
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
    while out["pages"] < max_pages and get_state(done_key) != "1":
        before = get_state(back_key)
        if before is None or int(before) <= floor:
            set_state(done_key, "1")
            break
        page = _discord("GET", f"/channels/{channel_id}/messages",
                        params={"limit": 100, "before": before}) or []
        out["pages"] += 1
        for m in page:
            out["added"] += record_message(m, channel_id)
        if not page:
            set_state(done_key, "1")
            break
        oldest = min(int(m["id"]) for m in page)
        set_state(back_key, str(oldest))
        if oldest <= floor or len(page) < 100:
            set_state(done_key, "1")
    return out


# ── the lesson channel ───────────────────────────────────────────────────────

def _read_only_overwrites(source: list[dict], bot_id: str, guild: str) -> list[dict]:
    """The source channel's audience, with posting removed for everyone but the
    bot. Admins bypass overwrites, so Patrick can still post or pin."""
    out, seen_everyone = [], False
    for ow in source or []:
        oid = str(ow.get("id") or "")
        if not oid or oid == bot_id:
            continue
        allow = int(ow.get("allow") or 0) & ~_POSTING_BITS
        deny = int(ow.get("deny") or 0) | _POSTING_BITS
        seen_everyone |= oid == guild
        out.append({"id": oid, "type": int(ow.get("type") or 0),
                    "allow": str(allow), "deny": str(deny)})
    if not seen_everyone:
        out.append({"id": guild, "type": 0, "allow": "0", "deny": str(_POSTING_BITS)})
    out.append({"id": bot_id, "type": 1, "deny": "0",
                "allow": str(_VIEW_CHANNEL | _SEND_MESSAGES | _EMBED_LINKS | _READ_HISTORY)})
    return out


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
    overwrites = _read_only_overwrites(source.get("permission_overwrites") or [],
                                       str(me.get("id") or ""), guild)
    body = {"name": channel_name(), "type": 0, "parent_id": str(category["id"]),
            "topic": ("Every video lesson from #tsdr, recapped in a few sentences. "
                      "Click a title to watch the original video."),
            "permission_overwrites": overwrites}
    try:
        created = _discord("POST", f"/guilds/{guild}/channels", body=body)
    except DiscordError as e:
        if e.status != 403:
            raise
        # The bot can only deny permissions it holds itself; fall back to the
        # one that matters (no posting) if it lacks the thread ones.
        for ow in overwrites:
            if ow["id"] != str(me.get("id") or ""):
                ow["allow"] = str(int(ow["allow"]) & ~_SEND_MESSAGES)
                ow["deny"] = str(_SEND_MESSAGES | (int(ow["deny"]) & ~_POSTING_BITS))
        created = _discord("POST", f"/guilds/{guild}/channels", body=body)
    set_state("lesson_channel_id", str(created["id"]))
    log.info("[tsdr-lessons] created #%s (%s) under %s", channel_name(), created["id"],
             category_name())
    return str(created["id"])


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
                if written > MAX_DOWNLOAD_BYTES:
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
    post_id = post_lesson(lesson_channel, lesson, link)
    _update(aid, status="posted", discord_post_id=post_id,
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
    lesson_channel = ensure_lesson_channel()
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
            _discord("PATCH", f"/channels/{lesson_channel}/messages/{row['discord_post_id']}",
                     body=_lesson_body({**row, "youtube_id": vid}, link))
        except Exception as e:  # noqa: BLE001
            log.warning("[tsdr-lessons] could not add the website link to %s: %s",
                        row["discord_post_id"], e)
    return "uploaded"


def run_youtube(*, deadline: float) -> dict:
    out = {"uploaded": 0, "errors": 0}
    left = _yt_quota_left()
    if left <= 0:
        return out
    with contextlib.closing(_connect()) as c:
        rows = [dict(r) for r in c.execute(
            f"SELECT * FROM tsdr_lessons WHERE status = 'posted' AND youtube_id IS NULL "
            f"AND yt_attempts < ? {_queue_order_sql()} LIMIT ?",
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
    """Scan, then lessons, then YouTube. Never raises; never overlaps itself."""
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
        if youtube_enabled():
            try:
                out["youtube"] = run_youtube(deadline=deadline)
            except Exception as e:  # noqa: BLE001
                log.warning("[tsdr-lessons] YouTube stage failed: %s", e)
                out["youtube"] = {"error": str(e)[:200]}
        return out
    finally:
        _TICK_LOCK.release()
