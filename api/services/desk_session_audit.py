"""Did everything land? — an artifact-reading audit of the session pipeline.

A published session is supposed to end up with six things: a YouTube video, a
stored transcript, chapters, ticker moments, and — for the shows that opt in — a
community announcement in Discord. Five separate subsystems produce those, on
three different schedules, and each one fails quietly by design so a hiccup can
never block publishing. The cost of that (correct) choice is that nobody finds
out when one of them silently didn't happen.

This module answers the question an owner actually asks — *did everything land?*
— by RE-READING THE ARTIFACTS: the `edu_videos` row and the announce ledger. It
deliberately does not consult a counter. `desk_session_insights._FAIL_STREAKS` is
an in-memory dict that alerts on the 4th CONSECUTIVE failure, which needs an
uninterrupted hour of 15-minute passes; this pod redeploys several times a day,
so that streak resets before it can ever fire. A proxy that resets on redeploy
reports healthy straight through a total failure — see
`lesson_health_check_reads_a_proxy_not_the_artifact`. Re-reading the row cannot
go quiet that way.

Two design points that keep it honest:

* **Grace window.** Insights arrive 2 minutes to ~3 hours after publish (Zoom
  transcribes asynchronously and the insights cron is on its own `:07/:22/:37/:52`
  schedule). A session younger than `DESK_SESSION_AUDIT_GRACE_SECS` is NOT
  checked at all. Without that, this alert fires on every healthy session and is
  muted within a week.
* **Names, not counts.** The alert text carries every incomplete session's id,
  title and the specific artifacts it lacks. A rail whose whole job is to report
  *which* thing broke must build the names into the message
  (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).

KNOWN LIMITATION, deliberately not solved here: a quiet run and a run that found
nothing to check look the same in Discord. The endpoint always reports `checked`
so the distinction is one curl away, but "no sessions were published this week"
is a different alarm and belongs with the existing EOD safety net, which already
owns it (`desk_daily_session.check_missing_session_alert`).
"""
from __future__ import annotations

import json
import os
import time

_DEFAULT_WINDOW_DAYS = 3.0
_DEFAULT_GRACE_SECS = 3 * 3600      # insights land up to ~3h after publish

# Artifacts checked on every published session, in report order.
_ARTIFACTS = ("youtube", "transcript", "chapters", "ticker_moments", "announced")


def is_enabled() -> bool:
    return os.environ.get("DESK_SESSION_AUDIT_ENABLED", "1") != "0"


def _window_secs() -> float:
    try:
        days = float(os.environ.get("DESK_SESSION_AUDIT_WINDOW_DAYS", _DEFAULT_WINDOW_DAYS))
    except ValueError:
        days = _DEFAULT_WINDOW_DAYS
    return max(0.0, days) * 86400.0


def _grace_secs() -> int:
    try:
        return max(0, int(os.environ.get("DESK_SESSION_AUDIT_GRACE_SECS", _DEFAULT_GRACE_SECS)))
    except ValueError:
        return _DEFAULT_GRACE_SECS


def _count(v: dict, field: str) -> int:
    """Length of a JSON list column, defensively — a corrupt or legacy row must
    never break the diagnostic that exists to tell you something is wrong."""
    try:
        arr = json.loads(v.get(field) or "[]")
        return len(arr) if isinstance(arr, list) else 0
    except Exception:
        return 0


def _announce_expected(title: str, category: str) -> bool:
    """Whether this show opts in to the public TSDR announcement. Read from the
    SAME allowlist the announcer itself consults, so the audit can never disagree
    with the thing it audits — a second copy of that list would drift and start
    flagging paywalled shows for not leaking."""
    try:
        from api.services import desk_session_announce
        return bool(desk_session_announce.is_enabled()
                    and desk_session_announce.show_allowed(title, category))
    except Exception:
        return False


def _was_announced(video_id: int) -> bool:
    try:
        from api.services import desk_session_announce
        return bool(desk_session_announce.get_announcement(int(video_id)))
    except Exception:
        return False


def _inspect(v: dict) -> tuple[list[str], list[str]]:
    """(missing, not_applicable) for one published session row."""
    missing: list[str] = []
    na: list[str] = []
    title = (v.get("title") or "").strip()
    category = (v.get("category") or "").strip()

    if not (v.get("youtube_id") or "").strip():
        missing.append("youtube")
    if not (v.get("transcript") or "").strip():
        missing.append("transcript")
    if _count(v, "chapters") == 0:
        missing.append("chapters")
    if _count(v, "ticker_moments") == 0:
        missing.append("ticker_moments")

    if _announce_expected(title, category):
        if not _was_announced(v.get("id")):
            missing.append("announced")
    else:
        na.append("announced")
    return missing, na


def audit_sessions(*, now: float | None = None) -> dict:
    """Re-read every published session inside the window and past the grace
    period. Never raises: a diagnostic that can crash is worse than none."""
    now = float(now if now is not None else time.time())
    grace = _grace_secs()
    window = _window_secs()
    report: dict = {
        "checked_at": int(now), "grace_secs": grace,
        "window_days": window / 86400.0, "checked": 0,
        "sessions": [], "incomplete": [],
    }
    try:
        from api.services import education_service
        videos = education_service.list_videos()
    except Exception as e:
        report["error"] = f"{type(e).__name__}: {e}"
        return report

    for v in videos:
        if not (v.get("meeting_uuid") or "").strip():
            continue                                    # not a session recording
        created = int(v.get("created_at") or 0)
        age = now - created
        if age < grace or age > window:
            continue
        try:
            missing, na = _inspect(v)
        except Exception as e:                          # one bad row can't end the pass
            missing, na = [f"audit_error:{type(e).__name__}"], []
        entry = {"id": v.get("id"), "title": (v.get("title") or "").strip(),
                 "age_secs": int(age), "ok": not missing,
                 "missing": missing, "not_applicable": na}
        report["sessions"].append(entry)
        report["checked"] += 1
        if missing:
            report["incomplete"].append(
                {"id": v.get("id"), "title": entry["title"], "missing": missing})

    report["sessions"].sort(key=lambda s: s["age_secs"])
    report["incomplete"].sort(key=lambda s: s["id"] or 0)
    return report


def format_alert(report: dict) -> str:
    """One Discord-ready block NAMING each incomplete session and what it lacks."""
    lines = [f"Checked {report.get('checked', 0)} published session(s) from the last "
             f"{report.get('window_days', 0):.0f} day(s):"]
    for s in report.get("incomplete", []):
        lines.append(f"• **{s['title']}** (video {s['id']}) — missing: "
                     f"{', '.join(s['missing'])}")
    return "\n".join(lines)


def _send_alert(text: str) -> None:
    from api.services import discord_notify
    discord_notify._send_webhook({
        "title": "⚠️ Desk session pipeline — something didn't land",
        "description": text, "color": 0xE0A800})


def run_audit_and_alert(*, now: float | None = None) -> dict:
    """Scheduler entry point. Silent when everything landed; one message naming
    every gap when it didn't. NEVER raises — a failing alert channel must not
    take down the scheduler thread it shares."""
    if not is_enabled():
        return {"skipped": "disabled"}
    report = audit_sessions(now=now)
    if report.get("incomplete"):
        try:
            _send_alert(format_alert(report))
        except Exception as e:
            print(f"[session-audit] alert failed (non-fatal): {e}")
    return report
