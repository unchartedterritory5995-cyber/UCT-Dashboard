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


# ── Liveness: does the video STILL EXIST on YouTube? ─────────────────────────
# ⚰️ 2026-09-25: the Day 7 walkthrough found three published Desk videos that had
# been removed from the channel AFTER the pipeline published them (ids 324/353/354
# — every card thumbnail 404'd for weeks; the owner deleted the rows by hand). The
# audit above checks that artifacts LANDED and never that they still EXIST, and
# its 3-day window could not have seen them anyway: they were weeks old. So this
# is a separate, BOUNDED, RESUMABLE sweep over the WHOLE library — a round-robin
# of `DESK_VIDEO_LIVENESS_PER_RUN` videos per daily run, asking YouTube's oEmbed
# endpoint (the same probe that named the three) — and it reports a video ONCE,
# the first run that sees it gone, by name. State lives beside the cover-retry
# ledger on the volume so a redeploy neither re-alerts nor restarts the cursor.
# ⛔ UNKNOWN (network error, 5xx, rate limit) is never GONE: an outage at YouTube
# must not manufacture a library's worth of findings.

_DEFAULT_LIVENESS_PER_RUN = 40
_LIVENESS_TIMEOUT_S = 6.0
# ⛔ THE ON-DEMAND DOOR GETS A SMALLER CEILING THAN THE DAILY JOB, AND THE REASON
# IS THE EDGE, NOT THE POD. The sweep is sequential and each probe may burn
# `_LIVENESS_TIMEOUT_S`, so 40 is up to ~4 minutes — past Cloudflare's ~100 s
# proxy budget, which would 524 the caller while the pod worked on. 15 keeps the
# worst case under that and is typically a few seconds. The ledger is resumable,
# so walking the whole library on demand is "POST it again", never a longer POST.
ENDPOINT_LIVENESS_MAX = 15
_OEMBED_URL = ("https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}"
               "&format=json")
_OEMBED_UA = "Mozilla/5.0 (compatible; UCT-Desk-liveness/1.0)"


def liveness_enabled() -> bool:
    return os.environ.get("DESK_VIDEO_LIVENESS_ENABLED", "1") != "0"


def _liveness_per_run() -> int:
    try:
        return max(1, int(os.environ.get("DESK_VIDEO_LIVENESS_PER_RUN", _DEFAULT_LIVENESS_PER_RUN)))
    except ValueError:
        return _DEFAULT_LIVENESS_PER_RUN


def clamp_liveness_limit(limit, ceiling: int = ENDPOINT_LIVENESS_MAX) -> int:
    """Bound a caller-supplied sweep size. Pure, so the ceiling is provable
    without a browser or a socket: `None` → the ceiling, junk → the ceiling,
    anything below 1 → 1, anything above → the ceiling."""
    try:
        n = int(limit)
    except (TypeError, ValueError):
        return ceiling
    return max(1, min(ceiling, n))


def _liveness_path(override=None) -> str:
    from api.services import desk_creative
    return override or os.path.join(desk_creative._data_dir(), "desk_video_liveness.json")


def _read_state(path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_state(path, data: dict) -> None:
    import tempfile
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=os.path.basename(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def youtube_live(youtube_id: str, *, timeout: float = _LIVENESS_TIMEOUT_S):
    """True = YouTube serves the video. False = YouTube says it is gone (404),
    private/blocked (401/403) or the id is malformed (400) — in every one of those
    the member's card cannot play. None = UNKNOWN (network error, 5xx, 429) and is
    deliberately NOT a verdict."""
    import requests
    try:
        r = requests.get(_OEMBED_URL.format(vid=youtube_id), timeout=timeout,
                         headers={"User-Agent": _OEMBED_UA})
    except Exception:
        return None
    if r.status_code == 200:
        return True
    if r.status_code in (400, 401, 403, 404):
        return False
    return None


def sweep_liveness(*, now: float | None = None, path: str | None = None,
                   check=None, limit: int | None = None) -> dict:
    """Check the next `limit` library videos (round-robin by id, cursor persisted)
    and report the ones YouTube no longer serves — NEW ones by name, the running
    total by count. `check` is late-bound so a test can inject a verdict table
    without a socket. Never raises."""
    now = float(now if now is not None else time.time())
    path = _liveness_path(path)
    check = check or youtube_live
    limit = int(limit if limit is not None else _liveness_per_run())
    out: dict = {"checked": 0, "library": 0, "unknown": 0, "gone_new": [],
                 "recovered": [], "gone_total": 0, "cursor": None}
    try:
        from api.services import education_service
        rows = [v for v in education_service.list_videos() if (v.get("youtube_id") or "").strip()]
        rows.sort(key=lambda v: int(v.get("id") or 0))
        out["library"] = len(rows)
        state = _read_state(path)
        try:
            cursor = int(state.get("cursor") or 0)
        except (TypeError, ValueError):
            cursor = 0
        gone = state.get("gone") if isinstance(state.get("gone"), dict) else {}
        ordered = [v for v in rows if int(v.get("id") or 0) > cursor] + \
                  [v for v in rows if int(v.get("id") or 0) <= cursor]
        last_id = cursor
        for v in ordered[:limit]:
            vid, yid = int(v.get("id") or 0), (v.get("youtube_id") or "").strip()
            title = (v.get("title") or "").strip()
            try:
                verdict = check(yid)
            except Exception:
                verdict = None
            out["checked"] += 1
            last_id = vid
            if verdict is False:
                if yid not in gone:
                    gone[yid] = {"id": vid, "title": title, "first_seen": int(now)}
                    out["gone_new"].append({"id": vid, "title": title, "youtube_id": yid})
            elif verdict is True:
                if yid in gone:
                    out["recovered"].append({"id": vid, "title": title, "youtube_id": yid})
                    del gone[yid]
            else:
                out["unknown"] += 1
        out["gone_total"] = len(gone)
        out["cursor"] = last_id
        _write_state(path, {"cursor": last_id, "gone": gone, "checked_at": int(now),
                            "library": len(rows)})
    except Exception as e:                                   # a diagnostic never raises
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def format_alert(report: dict) -> str:
    """One Discord-ready block NAMING each incomplete session and what it lacks,
    and each library video YouTube no longer serves."""
    lines = [f"Checked {report.get('checked', 0)} published session(s) from the last "
             f"{report.get('window_days', 0):.0f} day(s):"]
    for s in report.get("incomplete", []):
        lines.append(f"• **{s['title']}** (video {s['id']}) — missing: "
                     f"{', '.join(s['missing'])}")
    live = report.get("liveness") or {}
    if live.get("gone_new"):
        lines.append(f"No longer on YouTube (library sweep, {live.get('checked', 0)} of "
                     f"{live.get('library', 0)} checked this run, {live.get('gone_total', 0)} "
                     f"gone in total) — the card cannot play; delete the row "
                     f"(admin `DELETE /api/education/videos/{{id}}`) or re-upload:")
        for g in live["gone_new"]:
            lines.append(f"• **{g['title']}** (video {g['id']}, YouTube `{g['youtube_id']}`)")
    return "\n".join(lines)


def _send_alert(text: str) -> None:
    from api.services import discord_notify
    discord_notify._send_webhook({
        "title": "⚠️ Desk session pipeline — something didn't land",
        "description": text, "color": 0xE0A800})


def run_audit_and_alert(*, now: float | None = None) -> dict:
    """Scheduler entry point. Silent when everything landed AND every checked
    video still plays; one message naming every gap when it didn't. NEVER raises
    — a failing alert channel must not take down the scheduler thread it shares."""
    if not is_enabled():
        return {"skipped": "disabled"}
    report = audit_sessions(now=now)
    if liveness_enabled():
        try:
            report["liveness"] = sweep_liveness(now=now)
        except Exception as e:                               # belt and braces
            report["liveness"] = {"error": f"{type(e).__name__}: {e}"}
    if report.get("incomplete") or (report.get("liveness") or {}).get("gone_new"):
        try:
            _send_alert(format_alert(report))
        except Exception as e:
            print(f"[session-audit] alert failed (non-fatal): {e}")
    return report
