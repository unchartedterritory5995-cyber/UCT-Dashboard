"""Detect the day's archived YouTube webinar and publish it to The Desk.

Polls the channel's completed live broadcasts, skips any whose video id is
already in education.db, and inserts a dated "Daily Session" record. Idempotent
by youtube_id. Pure orchestration — HTTP lives in youtube_client, storage in
education_service.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

from api.services import education_service
from api.services.youtube_client import YouTubeClient, YouTubeAuthError

_ET = ZoneInfo("America/New_York")


def _category() -> str:
    return os.environ.get("DESK_DAILY_SESSION_CATEGORY", "Live Trading Sessions")


# Route a recording to its Desk destination by the Zoom webinar name (topic).
# Each rule: (keyword matched in the topic, lowercased) -> (section, title prefix,
# thumbnail eyebrow). First match wins; an unmatched named topic auto-derives
# everything from the name itself; an empty topic falls back to the default type.
_RULES = [
    ("live trading", "Live Trading Sessions", "Live Trading Session", "LIVE TRADING SESSION"),
]
_DEFAULT_ROUTE = ("Live Trading Sessions", "Live Trading Session", "LIVE TRADING SESSION")


def _route(topic: str | None) -> tuple[str, str, str]:
    """(section, title_prefix, eyebrow_label) for a recording's webinar name."""
    t = (topic or "").strip()
    low = t.lower()
    for kw, section, prefix, eyebrow in _RULES:
        if kw in low:
            return section, prefix, eyebrow
    if not t:
        return _DEFAULT_ROUTE
    return t, t, t.upper()        # auto: the name IS the section + title + eyebrow


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


def _session_date_text(started_at_iso: str | None, *, now: datetime | None = None) -> str:
    """ET date as 'June 24, 2026' — shared by the title and the thumbnail."""
    dt = _to_et(started_at_iso, now=now)
    return f"{dt.strftime('%B')} {dt.day}, {dt.year}"


def _session_title(started_at_iso: str | None, *, now: datetime | None = None) -> str:
    return f"Live Trading Session — {_session_date_text(started_at_iso, now=now)}"


def _start_date_floor():
    """ET date floor — only sessions on/after this publish. Env override, else None."""
    raw = os.environ.get("DESK_DAILY_SESSION_START_DATE")
    if raw:
        try:
            return date.fromisoformat(raw.strip())
        except ValueError:
            return None
    return None


def publish_new_sessions(client=None, *, now=None) -> list[dict]:
    """Publish any completed broadcast not already in the library. Idempotent."""
    now = now or datetime.now(_ET)
    floor = _start_date_floor() or now.date()
    client = client or YouTubeClient()
    broadcasts = client.list_completed_broadcasts()
    have = education_service.existing_youtube_ids()
    created: list[dict] = []
    for b in broadcasts:
        vid = (b.get("video_id") or "").strip()
        if not vid or vid in have:
            continue
        b_dt = _to_et(b.get("started_at"), now=now)
        if b_dt.date() < floor:
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


def _alert_owner(now: datetime, kind: str = "missing") -> None:
    from api.services import discord_notify
    if kind == "stuck":
        title = "⚠️ Live Trading Session stuck in processing"
        desc = ("Today's recording is queued but not published (download/upload/"
                "auth failure). Check Zoom/YouTube credentials + the desk_session_jobs queue.")
    else:
        when = now.strftime('%-I:%M %p ET') if os.name != 'nt' else now.strftime('%I:%M %p ET')
        title = "⚠️ Live Trading Session not published"
        desc = (f"No '{_session_title(None, now=now)}' video is in The Desk by {when}. "
                "Check that the webinar ran and auto-recorded to the Zoom cloud.")
    discord_notify._send_webhook({"title": title, "description": desc, "color": 0xE0A800})


_DESK_VIDEOS_URL = "https://uctintelligence.com/desk?section=videos"


def _alert_recipients() -> list[str]:
    raw = (os.environ.get("DESK_DAILY_SESSION_ALERT_EMAILS")
           or os.environ.get("ADMIN_EMAILS", ""))
    return [e.strip() for e in raw.split(",") if e.strip()]


def _notify_published(title: str, video_id: str) -> None:
    """Fire a success alert (Discord + email) when a session posts to The Desk.
    Best-effort — never raises (must not break the processor)."""
    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "✅ Live Trading Session posted",
            "description": f"**{title}** is now live in The Desk → Videos.\n"
                           f"[Open The Desk]({_DESK_VIDEOS_URL})",
            "color": 0x4ADE80,
        })
    except Exception:
        pass
    try:
        from api.services import email_service
        html = (f"<p style='font-size:16px'><b>{title}</b> is now live in "
                f"<b>The Desk → Videos → Live Trading Sessions</b>.</p>"
                f"<p><a href='{_DESK_VIDEOS_URL}' style='color:#c9a84c'>Open The Desk →</a></p>")
        for to in _alert_recipients():
            email_service.send_email(to, f"✅ {title} is posted to The Desk", html)
    except Exception:
        pass


def check_missing_session_alert(now: datetime | None = None, *, publish: bool = True) -> bool:
    """Weekday EOD guard. Drains the queue once, then alerts the owner if today's
    session still isn't in The Desk — distinguishing a stuck/errored queue from a
    genuinely-absent session. Returns True iff it alerted."""
    now = now or datetime.now(_ET)
    if now.weekday() >= 5:
        return False
    if publish:
        try:
            process_pending_jobs()
        except Exception:
            pass
    if todays_session_exists(now):
        return False
    try:
        stuck = (desk_session_jobs.count_status("processing")
                 + desk_session_jobs.count_status("error"))
    except Exception:
        stuck = 0
    _alert_owner(now, kind=("stuck" if stuck else "missing"))
    return True


# ---------------------------------------------------------------------------
# Task 5: Zoom recording processor
# ---------------------------------------------------------------------------

import tempfile
from api.services import desk_session_jobs


def process_pending_jobs(*, zoom=None, youtube=None) -> list[dict]:
    """Drain the recording queue: download -> upload -> publish -> delete.
    One job at a time. Idempotent (youtube_id guard + queue PK). Never raises;
    per-job failures are recorded for retry / the EOD safety net."""
    from api.services.zoom_client import ZoomClient
    from api.services.youtube_client import YouTubeClient
    zoom = zoom or ZoomClient()
    youtube = youtube or YouTubeClient()
    done: list[dict] = []
    while True:
        job = desk_session_jobs.claim_next()
        if not job:
            break
        uuid = job["meeting_uuid"]
        section, title_prefix, eyebrow = _route(job.get("topic"))
        date_text = _session_date_text(job.get("start_time"))
        title = f"{title_prefix} — {date_text}"
        vid = (job.get("youtube_id") or "").strip()
        tmp = None
        try:
            if not vid:
                fd, tmp = tempfile.mkstemp(suffix=".mp4"); os.close(fd)
                zoom.stream_download(job["download_url"], job.get("download_token"), tmp)
                vid = youtube.upload_unlisted(tmp, title)
                desk_session_jobs.mark_uploaded(uuid, vid)   # persist before publish/delete
                try:  # branded thumbnail — cosmetic, NEVER fail publish over it
                    from api.services.desk_thumbnail import render_session_thumbnail
                    youtube.set_thumbnail(
                        vid, render_session_thumbnail(date_text, eyebrow_label=eyebrow))
                except Exception as te:
                    print(f"[desk-sessions] thumbnail set failed (non-fatal): {te}")
            created_now = vid not in education_service.existing_youtube_ids()
            if created_now:
                education_service.create_video({
                    "youtube_id": vid, "title": title, "description": "",
                    "category": section, "sort_order": 0})
            try:
                zoom.delete_recording(uuid)
            except Exception:
                pass
            desk_session_jobs.mark_done(uuid, vid)
            done.append({"meeting_uuid": uuid, "youtube_id": vid, "title": title})
            if created_now:                 # alert once, only on a genuinely-new publish
                _notify_published(title, vid)
        except Exception as e:
            desk_session_jobs.mark_error(uuid, e)
        finally:
            if tmp and os.path.exists(tmp):
                try: os.remove(tmp)
                except OSError: pass
    return done
