"""Retro-apply the new YouTube description format (evergreen links+disclaimer,
plus real per-session chapters where already stored) to the back catalog
(owner-approved 2026-08-28). Every video published before Phase 1 shipped
with `description=""` — this brings past sessions in line with what new
uploads now get automatically.

Mechanics mirror desk_cover_backfill.py: a PUSH_SECRET-gated endpoint fires
ONE background daemon thread, a JSON ledger on the volume (written
atomically: tmp + os.replace) makes the sweep idempotent and resumable
across redeploys. Terminal outcomes (done / skipped) are never retried;
ERRORS are transient by default (quota, OAuth blips) and stay eligible for
up to 3 attempts. Gated on DESK_SESSION_DESCRIPTION_CHAPTERS — the same flag
that gates videos.update everywhere else — so turning it off stops a sweep
in flight, the same in-band stop button as the cover backfill. Chapters (when
a video has them stored) come ONLY from that video's own real transcript-
derived data — never invented, never today's wire brief. Today's videos
belong to the live publish pipeline, not this.
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, time as dtime
from pathlib import Path
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

_MAX_ERROR_ATTEMPTS = 3

_run_lock = threading.Lock()
_running = False


def _ledger_path(override=None) -> str:
    return (override
            or os.environ.get("DESK_DESCRIPTION_BACKFILL_LEDGER",
                              "/data/desk_description_backfill.json"))


def _ledger_read(path) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _ledger_write(path, youtube_id: str, status: str) -> None:
    led = _ledger_read(path)
    attempts = int((led.get(youtube_id) or {}).get("attempts", 0)) + 1
    led[youtube_id] = {"status": status, "at": int(time.time()),
                       "attempts": attempts}
    p = Path(path)
    if p.parent and not p.parent.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(led, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)   # atomic — a SIGTERM mid-write can't truncate the ledger


def _skip_per_ledger(entry: dict | None) -> bool:
    """Terminal outcomes stay skipped; transient errors retry up to the cap."""
    if not entry:
        return False
    status = str(entry.get("status") or "")
    if status.startswith("error"):
        return int(entry.get("attempts", 1)) >= _MAX_ERROR_ATTEMPTS
    return True


def eligible_videos(*, now=None, ledger_path=None) -> list[dict]:
    """Show-kind videos with a YouTube id, published BEFORE today (ET — never
    race the live pipeline uploading today's session), whose title parses,
    and not ledger-skipped. Newest first. Registry-derived: the show list is
    edu_categories.kind, never a typed list."""
    from api.services import desk_creative, education_service
    now = now or datetime.now(_ET)
    today_start = int(datetime.combine(now.date(), dtime.min, tzinfo=_ET).timestamp())
    shows = {c["name"] for c in education_service.list_category_meta()
             if c.get("kind") == "show"}
    led = _ledger_read(_ledger_path(ledger_path))
    out = []
    for v in education_service.list_video_creative_stubs():
        yid = (v.get("youtube_id") or "").strip()
        if (not yid or _skip_per_ledger(led.get(yid))
                or v.get("category") not in shows
                or int(v.get("created_at") or 0) >= today_start
                or not desk_creative.parse_session_title(v.get("title") or "")):
            continue
        out.append(v)
    return out


def backfill_one(v: dict, *, youtube=None, ledger_path=None) -> str:
    """One video: compose from its OWN stored chapters (links-only when it has
    none yet) and PATCH the description. Records the outcome in the ledger
    either way; never raises."""
    from api.services import desk_creative, desk_daily_session, education_service
    path = _ledger_path(ledger_path)
    yid = (v.get("youtube_id") or "").strip()
    try:
        parsed = desk_creative.parse_session_title(v.get("title") or "")
        if not parsed:
            _ledger_write(path, yid, "skipped")
            return "skipped"
        show, _date_text = parsed
        chapters = education_service.get_insights(int(v["id"])).get("chapters") or []
        description = desk_daily_session.compose_description_with_chapters(show, chapters)
        if youtube is None:
            from api.services.youtube_client import YouTubeClient
            youtube = YouTubeClient()
        youtube.update_description(yid, description)
        _ledger_write(path, yid, "done")
        return "done"
    except Exception as e:  # noqa: BLE001 — one bad video never stops the sweep
        msg = f"error: {type(e).__name__}: {e}"[:200]
        try:
            _ledger_write(path, yid, msg)
        except Exception:
            pass
        return msg


def run_backfill(*, limit=None, sleep_secs=2, youtube=None,
                 ledger_path=None, now=None) -> dict:
    """The sweep. Serialized calls with a courtesy sleep between videos;
    resumable via the ledger. The flag is re-checked per video, so clearing
    DESK_SESSION_DESCRIPTION_CHAPTERS stops it in-band."""
    from api.services import desk_daily_session
    if not desk_daily_session.chapters_description_enabled():
        return {"skipped": "DESK_SESSION_DESCRIPTION_CHAPTERS is off"}
    todo = eligible_videos(now=now, ledger_path=ledger_path)
    summary = {"eligible": len(todo), "done": 0, "skipped": 0, "errors": 0}
    if limit is not None:
        todo = todo[:max(0, int(limit))]   # limit=0 = dry-run probe, never "all"
    for v in todo:
        if not desk_daily_session.chapters_description_enabled():
            summary["stopped"] = "flag turned off"
            break
        got = backfill_one(v, youtube=youtube, ledger_path=ledger_path)
        key = got if got in ("done", "skipped") else "errors"
        summary[key] += 1
        print(f"[description-backfill] {v.get('youtube_id')}: {got} "
              f"({v.get('title', '')[:60]!r})")
        if sleep_secs:
            time.sleep(sleep_secs)
    return summary


def start_background(*, limit=None) -> bool:
    """Fire ONE daemon sweep; False when already running or the flag is off."""
    from api.services import desk_daily_session
    global _running
    if not desk_daily_session.chapters_description_enabled():
        return False
    with _run_lock:
        if _running:
            return False
        _running = True

    def _run():
        global _running
        try:
            out = run_backfill(limit=limit)
            print(f"[description-backfill] sweep finished: {out}")
        finally:
            with _run_lock:
                _running = False

    threading.Thread(target=_run, name="desk-description-backfill", daemon=True).start()
    return True


def status(*, ledger_path=None) -> dict:
    from api.services import desk_daily_session
    led = _ledger_read(_ledger_path(ledger_path))
    counts: dict = {"done": 0, "skipped": 0, "errors": 0}
    for entry in led.values():
        s = str(entry.get("status") or "")
        if not s:
            continue
        counts[s if s in ("done", "skipped") else "errors"] += 1
    remaining = len(eligible_videos(ledger_path=ledger_path))
    return {"running": _running,
            "chapters_enabled": desk_daily_session.chapters_description_enabled(),
            "recorded": len(led), "counts": counts, "remaining": remaining}
