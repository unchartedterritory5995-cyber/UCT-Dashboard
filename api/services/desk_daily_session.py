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
