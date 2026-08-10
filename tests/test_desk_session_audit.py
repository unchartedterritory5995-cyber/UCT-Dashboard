"""Rails for the published-session audit.

The audit answers "did everything land?" by reading the ARTIFACTS (the edu_videos
row + the announce ledger) rather than a counter. That distinction is the whole
point: `desk_session_insights._FAIL_STREAKS` is an in-memory dict that alerts on
the 4th CONSECUTIVE failure, so on a pod that redeploys several times a day the
streak can never accumulate and the alert is structurally near-silent. An audit
that re-reads the row cannot go quiet that way.
"""
import os
import tempfile
import time

import pytest

from api.services import desk_session_audit as audit
from api.services import education_service as edu

HOUR = 3600


@pytest.fixture
def edu_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(edu, "_DB_PATH", os.path.join(d, "education.db"))
        edu._init_db()
        yield edu


def _session(title="Live Trading Session — August 9, 2026",
             category="Live Trading Sessions", *, chapters=1, tickers=1,
             transcript=True, youtube=True, uuid="U-1"):
    """Create a published session video with the requested artifacts present."""
    row = edu.create_video({"youtube_id": "VID1" if youtube else "",
                            "title": title, "category": category, "sort_order": 0})
    vid = row["id"]
    edu.set_meeting_uuid(vid, uuid)
    edu.set_video_insights(
        vid,
        transcript="[0:03] hello" if transcript else None,
        chapters=[{"t": 0, "title": "Open"}] * chapters if chapters else None,
        ticker_moments=[{"t": 5, "ticker": "MU"}] * tickers if tickers else None,
    )
    return vid


def _report(now_offset=4 * HOUR, **kw):
    """Audit as of `now_offset` after the rows were written (default: past grace)."""
    return audit.audit_sessions(now=time.time() + now_offset, **kw)


def _missing_for(report, vid):
    for s in report["sessions"]:
        if s["id"] == vid:
            return s["missing"]
    return None


def test_a_complete_session_is_not_flagged(edu_db):
    vid = _session()
    r = _report()
    assert r["checked"] == 1
    assert _missing_for(r, vid) == []
    assert r["incomplete"] == []


def test_missing_chapters_is_flagged(edu_db):
    vid = _session(chapters=0)
    r = _report()
    assert "chapters" in _missing_for(r, vid)
    assert [i["id"] for i in r["incomplete"]] == [vid]


def test_missing_ticker_moments_is_flagged(edu_db):
    vid = _session(tickers=0)
    assert "ticker_moments" in _missing_for(_report(), vid)


def test_missing_transcript_is_flagged(edu_db):
    vid = _session(transcript=False)
    assert "transcript" in _missing_for(_report(), vid)


def test_a_session_still_inside_the_grace_window_is_not_flagged(edu_db):
    """Insights legitimately land up to ~3h after publish — flagging a fresh
    session would make this alert cry wolf every single session."""
    _session(chapters=0, tickers=0)
    r = _report(now_offset=5 * 60)          # 5 minutes old
    assert r["checked"] == 0
    assert r["incomplete"] == []


def test_a_session_older_than_the_window_is_ignored(edu_db):
    _session(chapters=0)
    r = _report(now_offset=30 * 24 * HOUR)  # 30 days old
    assert r["checked"] == 0


def test_a_non_allowlisted_show_is_not_flagged_for_being_unannounced(edu_db, monkeypatch):
    """Live Trading Sessions are paywalled and deliberately never announced —
    counting that as a defect would bury the real ones under weekly noise."""
    monkeypatch.setenv("DESK_TSDR_ANNOUNCE_SHOWS", "sunday scans")
    vid = _session(title="Live Trading Session — August 9, 2026",
                   category="Live Trading Sessions")
    r = _report()
    assert "announced" not in (_missing_for(r, vid) or [])
    seen = [s for s in r["sessions"] if s["id"] == vid][0]
    assert "announced" in seen["not_applicable"]


def test_an_allowlisted_show_that_was_never_announced_is_flagged(edu_db, monkeypatch):
    monkeypatch.setenv("DESK_TSDR_ANNOUNCE_ENABLED", "1")
    monkeypatch.setenv("DESK_TSDR_ANNOUNCE_SHOWS", "sunday scans")
    vid = _session(title="Sunday Scans — August 9, 2026", category="Sunday Scans")
    assert "announced" in _missing_for(_report(), vid)


def test_nothing_is_flagged_as_unannounced_while_announcing_is_globally_off(edu_db, monkeypatch):
    """With the announcer disabled, an absent announcement is the configured
    behaviour, not a defect — flagging it would make the audit argue with the
    very flag that silenced it."""
    monkeypatch.delenv("DESK_TSDR_ANNOUNCE_ENABLED", raising=False)
    monkeypatch.setenv("DESK_TSDR_ANNOUNCE_SHOWS", "sunday scans")
    vid = _session(title="Sunday Scans — August 9, 2026", category="Sunday Scans")
    r = _report()
    assert "announced" not in _missing_for(r, vid)
    assert "announced" in [s for s in r["sessions"] if s["id"] == vid][0]["not_applicable"]


def test_the_alert_text_names_every_incomplete_session_and_what_it_lacks(edu_db):
    """A rail that exists to report WHICH session broke must put the names in the
    message itself — a count sends you back to the database to find out who."""
    a = _session(title="Sunday Scans — August 9, 2026", category="Sunday Scans",
                 chapters=0, uuid="U-A")
    b = _session(title="Live Trading Session — August 7, 2026", uuid="U-B", tickers=0)
    text = audit.format_alert(_report())
    assert "Sunday Scans — August 9, 2026" in text
    assert "Live Trading Session — August 7, 2026" in text
    assert "chapters" in text and "ticker_moments" in text
    assert str(a) in text and str(b) in text        # ids, so it's actionable


def test_audit_never_raises_when_the_store_is_broken(edu_db, monkeypatch):
    monkeypatch.setattr(edu, "list_videos", lambda: (_ for _ in ()).throw(RuntimeError("db gone")))
    r = audit.audit_sessions(now=time.time())
    assert r["checked"] == 0 and r["incomplete"] == []
    assert r.get("error")


def test_run_audit_and_alert_stays_silent_when_everything_landed(edu_db, monkeypatch):
    _session()
    sent = []
    monkeypatch.setattr(audit, "_send_alert", lambda text: sent.append(text))
    audit.run_audit_and_alert(now=time.time() + 4 * HOUR)
    assert sent == []


def test_run_audit_and_alert_fires_once_with_the_names(edu_db, monkeypatch):
    _session(title="Sunday Scans — August 9, 2026", category="Sunday Scans", chapters=0)
    sent = []
    monkeypatch.setattr(audit, "_send_alert", lambda text: sent.append(text))
    audit.run_audit_and_alert(now=time.time() + 4 * HOUR)
    assert len(sent) == 1
    assert "Sunday Scans — August 9, 2026" in sent[0]


def test_a_discord_failure_never_escapes_the_scheduler_job(edu_db, monkeypatch):
    _session(chapters=0)
    monkeypatch.setattr(audit, "_send_alert",
                        lambda text: (_ for _ in ()).throw(RuntimeError("discord down")))
    audit.run_audit_and_alert(now=time.time() + 4 * HOUR)   # must not raise


# ── IS IT ACTUALLY WIRED? ───────────────────────────────────────────────────
# Everything above proves a correct component. This repo's 2026-08-08 audit found
# 8 features that were built, tested, green and connected to NOTHING — and the
# Desk session-insights pass itself was "written, documented as scheduled, wired
# into no scheduler" for weeks. An audit that never runs is worse than none: it
# reads as coverage. These two go RED when the wire is cut while every test above
# stays green.

import ast          # noqa: E402
import pathlib      # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent
MAIN = REPO / "api/main.py"
JOB_ID = "desk_session_audit"


def _add_job_ids(tree) -> list[str]:
    """Every literal `id=` on an `add_job(...)` call. An AST, never a grep —
    a grep matches the comment above the call and the job id in this docstring
    (`lesson_probe_names_must_be_derived_not_typed`)."""
    out = []
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "add_job"):
            continue
        for kw in n.keywords:
            if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                out.append(kw.value.value)
    return out


def test_the_audit_is_registered_on_the_scheduler_in_main():
    ids = _add_job_ids(ast.parse(MAIN.read_text(encoding="utf-8")))
    # ⛔ NON-VACUITY: the probe must see a sibling it is not looking for, or an
    # AST walk that silently matched nothing would "pass" for both of them.
    assert "desk_session_insights" in ids, (
        "the add_job AST scan found no sibling desk job — the probe is broken, "
        "so its verdict on desk_session_audit means nothing")
    assert JOB_ID in ids, (
        f"desk_session_audit.run_audit_and_alert is defined and scheduled nowhere. "
        f"Registered desk-adjacent job ids: {[i for i in ids if 'desk' in str(i)]}")


def test_the_audit_endpoint_is_mounted_on_the_desk_router():
    from api.routers import desk_zoom_webhook as dzw
    paths = [getattr(r, "path", "") for r in dzw.router.routes]
    assert any(p.endswith("/sessions-status") for p in paths), (
        "the route probe found no sibling diagnostic endpoint; it is broken")
    assert any(p.endswith("/session-audit") for p in paths), (
        f"GET /session-audit is not mounted. Router paths: {paths}")
