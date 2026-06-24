"""Detect the day's archived YouTube webinar and publish it to The Desk.

Polls the channel's completed live broadcasts, skips any whose video id is
already in education.db, and inserts a dated "Daily Session" record. Idempotent
by youtube_id. Pure orchestration — HTTP lives in youtube_client, storage in
education_service.
"""
from __future__ import annotations

import os
from datetime import datetime
from zoneinfo import ZoneInfo

from api.services import education_service
from api.services.youtube_client import YouTubeClient

_ET = ZoneInfo("America/New_York")


def _category() -> str:
    return os.environ.get("DESK_DAILY_SESSION_CATEGORY", "Daily Sessions")


def _to_et(started_at_iso: str | None, *, now: datetime | None = None) -> datetime:
    if not started_at_iso:
        return now or datetime.now(_ET)
    iso = started_at_iso.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return now or datetime.now(_ET)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(_ET)


def _session_title(started_at_iso: str | None, *, now: datetime | None = None) -> str:
    dt = _to_et(started_at_iso, now=now)
    return f"Daily Session — {dt.strftime('%B')} {dt.day}, {dt.year}"


def publish_new_sessions(client=None) -> list[dict]:
    """Publish any completed broadcast not already in the library. Idempotent."""
    client = client or YouTubeClient()
    broadcasts = client.list_completed_broadcasts()
    have = education_service.existing_youtube_ids()
    created: list[dict] = []
    for b in broadcasts:
        vid = (b.get("video_id") or "").strip()
        if not vid or vid in have:
            continue
        row = education_service.create_video({
            "youtube_id": vid,
            "title": _session_title(b.get("started_at")),
            "description": "",
            "category": _category(),
            "sort_order": 0,
        })
        created.append(row)
        have.add(vid)
    return created


def todays_session_exists(now: datetime | None = None) -> bool:
    now = now or datetime.now(_ET)
    expected = _session_title(None, now=now)
    cat = _category()
    return any(v.get("title") == expected and v.get("category") == cat
               for v in education_service.list_videos())


def _alert_owner(now: datetime) -> None:
    from api.services import discord_notify
    discord_notify._send_webhook({
        "title": "⚠️ Daily Session not published",
        "description": (f"No '{_session_title(None, now=now)}' video is in The Desk "
                        f"by {now.strftime('%-I:%M %p ET') if os.name != 'nt' else now.strftime('%I:%M %p ET')}. "
                        "Check that the webinar ran and auto-streamed to YouTube."),
        "color": 0xE0A800,
    })


def check_missing_session_alert(now: datetime | None = None, *, publish: bool = True) -> bool:
    """Weekday EOD guard. Tries one publish, then alerts the owner if today's
    session still isn't in the library. Returns True iff it alerted."""
    now = now or datetime.now(_ET)
    if now.weekday() >= 5:          # Sat/Sun
        return False
    if publish:
        try:
            publish_new_sessions()
        except Exception:
            pass
    if todays_session_exists(now):
        return False
    _alert_owner(now)
    return True
