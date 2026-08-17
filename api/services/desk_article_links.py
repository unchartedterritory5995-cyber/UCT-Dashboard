"""Pair a Desk article with that week's Desk video.

The same Sunday produces two artifacts in the same hub, published by two
unrelated pipelines that have never known about each other:

  * the LETTER — a Substack post, ingested by `substack_poller`
  * the SESSION — a Zoom recording auto-published to `edu_videos` by
    `desk_daily_session`, titled "Sunday Scans — August 16, 2026"

They live in different SQLite files (`desk.db` and `education.db`) with no
foreign key between them, so the only thing they share is the DATE.

⛔ THE DATE FORMAT IS A CONTRACT, NOT A GUESS. `desk_daily_session
._session_date_text` renders "{Month} {D}, {YYYY}" in ET, and
`substack_bodies.display_title_for` renders the article's stamp the same way for
the same reason. This module parses THAT format. If either side ever changes how
it writes a date, `test_the_video_title_format_this_parser_assumes_is_the_one_
desk_daily_session_writes` fails — which is the point: a silent reformat would
turn every pairing off with no other symptom.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

# "Sunday Scans — August 16, 2026" / "Live Trading Session - August 16, 2026".
# Accepts an em dash or a hyphen because only the DATE half is the contract.
#
# ⛔ THE TRAILING `(...)` IS LOAD-BEARING. A session that drops and restarts
# produces two recordings for one evening, and the human fix is to retitle them
# "… (Part 1)" / "… (Part 2)". Anchoring the date strictly to end-of-string made
# BOTH parts unparseable the moment that happened, which silently unpaired the
# article — the same shape as the 2026-07-29 workshop bug, where a pinned alias
# that rewrote the name broke every behaviour keyed on that name. An optional
# suffix is what keeps a human-readable rename from switching a feature off.
_TITLE_DATE_RE = re.compile(
    r"[—-]\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s*(?:\([^)]*\))?\s*$"
)

# How far a session may sit from the letter and still be "that week's session".
# The letter lands Sunday afternoon and the session is the same day, so this is
# slack for a recording that finishes after midnight ET or is published late —
# NOT a licence to reach into an adjacent week.
_MAX_DAY_GAP = 2


def parse_session_date(title: str) -> date | None:
    """"Sunday Scans — August 16, 2026" -> date(2026, 8, 16). None if absent."""
    m = _TITLE_DATE_RE.search((title or "").strip())
    if not m:
        return None
    month_name, day, year = m.group(1), int(m.group(2)), int(m.group(3))
    try:
        return datetime.strptime(f"{month_name} {day} {year}", "%B %d %Y").date()
    except ValueError:
        return None


def article_date(published_at: int | None) -> date | None:
    """A post's publish instant -> its ET calendar date (what the title stamps)."""
    if not published_at:
        return None
    try:
        return datetime.fromtimestamp(int(published_at), tz=timezone.utc).astimezone(_ET).date()
    except (ValueError, OSError, OverflowError):
        return None


def _series_of(title: str) -> str:
    """The part before the date — "Sunday Scans" out of the full title."""
    return _TITLE_DATE_RE.sub("", (title or "").strip()).strip(" —-").lower()


def _sort_key(video: dict) -> tuple:
    """Total order over candidate videos: id first, then youtube_id as a
    fallback so rows without a numeric id still compare deterministically."""
    try:
        vid = int(video.get("id") or 0)
    except (TypeError, ValueError):
        vid = 0
    return (vid, str(video.get("youtube_id") or ""))


def pick_related_video(article_title: str, published_at: int | None,
                       videos: list[dict]) -> dict | None:
    """The session that goes with this letter, or None.

    Pure — `videos` is passed in, so this is testable without a second database.

    Matching is by SERIES then DATE: a "Sunday Scans" letter pairs only with a
    "Sunday Scans" session, never with that week's Live Trading Session, which
    would be a confident wrong answer rather than a missing one.
    """
    target = article_date(published_at)
    if not target:
        return None
    series = _series_of(article_title)
    if not series:
        return None

    best, best_gap = None, None
    for v in videos or []:
        vt = (v.get("title") or "")
        if _series_of(vt) != series:
            continue
        vd = parse_session_date(vt)
        if not vd:
            continue
        gap = abs((vd - target).days)
        if gap > _MAX_DAY_GAP:
            continue
        # ⛔ A TIE MUST NOT LEAK THE STORE'S ROW ORDER. Duplicate uploads of one
        # session do happen (production carries three copies of 2026-08-16), and
        # `gap < best_gap` alone would silently hand whichever row the DB
        # returned first — so the same article could pair differently after an
        # unrelated re-sort. Break ties on the highest video id: newest upload,
        # deterministic, and a total order.
        if best_gap is None or gap < best_gap or (
                gap == best_gap and _sort_key(v) > _sort_key(best)):
            best, best_gap = v, gap

    if not best:
        return None
    return {
        "id": best.get("id"),
        "youtube_id": best.get("youtube_id"),
        "title": best.get("title"),
        "category": best.get("category"),
        "duration": best.get("duration"),
        "day_gap": best_gap,
    }


def related_video_for(article_title: str, published_at: int | None) -> dict | None:
    """Same, but reads the education store. Never raises: a missing or broken
    video DB must not stop an article rendering."""
    try:
        from api.services import education_service
        videos = education_service.list_videos()
    except Exception:  # noqa: BLE001
        return None
    return pick_related_video(article_title, published_at, videos)
