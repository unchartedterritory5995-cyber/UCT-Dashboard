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
        # The liveness sweep asks YouTube over the network and persists a cursor;
        # the artifact-audit cases above it are offline by construction, so the
        # sweep is OFF here and switched on, with an injected verdict table and a
        # temp state file, by its own cases below.
        monkeypatch.setenv("DESK_VIDEO_LIVENESS_ENABLED", "0")
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


# ── DOES THE VIDEO STILL EXIST? — the library liveness sweep ────────────────
# 2026-09-25: three published Desk videos (ids 324/353/354) had been removed from
# YouTube weeks after publish; every card thumbnail 404'd and this audit, which only
# checks that artifacts LANDED inside a 3-day window, could not see them. The sweep
# below is bounded, resumable and offline-testable through its injected `check`.

def _video(title, yid):
    return edu.create_video({"youtube_id": yid, "title": title,
                             "category": "Sunday Scans", "sort_order": 0})["id"]


@pytest.fixture
def liveness_state(tmp_path):
    return str(tmp_path / "desk_video_liveness.json")


def test_a_video_youtube_no_longer_serves_is_reported_by_name_ONCE(edu_db, liveness_state):
    keep = _video("Sunday Scans — August 9, 2026", "LIVE1")
    dead = _video("Evening Update — September 10, 2026", "GONE1")
    table = {"LIVE1": True, "GONE1": False}
    first = audit.sweep_liveness(path=liveness_state, check=table.get, now=1000)
    assert first["checked"] == 2 and first["library"] == 2 and "error" not in first
    assert [g["id"] for g in first["gone_new"]] == [dead]
    assert first["gone_new"][0]["title"] == "Evening Update — September 10, 2026"
    assert first["gone_total"] == 1
    # The same video is never reported twice — the state file remembers it.
    second = audit.sweep_liveness(path=liveness_state, check=table.get, now=2000)
    assert second["gone_new"] == [] and second["gone_total"] == 1
    assert keep not in [g["id"] for g in first["gone_new"]]


def test_an_UNKNOWN_verdict_is_never_gone(edu_db, liveness_state):
    """A YouTube outage must not manufacture a library's worth of findings —
    and the control proves the same rows ARE reported when the verdict is real."""
    _video("Sunday Scans — August 16, 2026", "MAYBE1")
    r = audit.sweep_liveness(path=liveness_state, check=lambda yid: None, now=1000)
    assert r["checked"] == 1 and r["unknown"] == 1 and r["gone_new"] == []
    r2 = audit.sweep_liveness(path=liveness_state, check=lambda yid: False, now=2000)
    assert [g["youtube_id"] for g in r2["gone_new"]] == ["MAYBE1"]


def test_a_video_that_comes_back_is_dropped_from_the_gone_set(edu_db, liveness_state):
    _video("Workshop — August 2, 2026", "FLAP1")
    audit.sweep_liveness(path=liveness_state, check=lambda yid: False, now=1000)
    r = audit.sweep_liveness(path=liveness_state, check=lambda yid: True, now=2000)
    assert [g["youtube_id"] for g in r["recovered"]] == ["FLAP1"] and r["gone_total"] == 0


def test_the_sweep_is_BOUNDED_and_resumes_round_robin_across_runs(edu_db, liveness_state):
    ids = [_video(f"Video {i}", f"V{i}") for i in range(1, 6)]
    seen = []
    check = lambda yid: seen.append(yid) or True
    for _ in range(3):
        audit.sweep_liveness(path=liveness_state, check=check, limit=2, now=1000)
    # 5 videos, 2 per run: run 1 = V1 V2, run 2 = V3 V4, run 3 = V5 then wraps to V1.
    assert seen == ["V1", "V2", "V3", "V4", "V5", "V1"], seen
    assert len(ids) == 5


def test_youtube_live_classifies_what_youtube_answers(monkeypatch):
    import requests

    class R:
        def __init__(self, code): self.status_code = code
    answers = {}
    monkeypatch.setattr(requests, "get", lambda url, **kw: answers[url.split("v=")[1].split("&")[0]])
    answers.update({"ok": R(200), "gone": R(404), "private": R(401), "bad": R(400), "outage": R(503)})
    assert audit.youtube_live("ok") is True
    assert audit.youtube_live("gone") is False
    assert audit.youtube_live("private") is False
    assert audit.youtube_live("bad") is False
    assert audit.youtube_live("outage") is None
    monkeypatch.setattr(requests, "get", lambda url, **kw: (_ for _ in ()).throw(OSError("dns")))
    assert audit.youtube_live("ok") is None


def test_run_audit_and_alert_names_a_video_that_is_no_longer_on_youtube(edu_db, liveness_state, monkeypatch):
    _session()                                         # a complete session: nothing missing
    _video("Evening Update — September 10, 2026", "GONE2")
    monkeypatch.setenv("DESK_VIDEO_LIVENESS_ENABLED", "1")
    monkeypatch.setattr(audit, "_liveness_path", lambda override=None: liveness_state)
    monkeypatch.setattr(audit, "youtube_live", lambda yid, **kw: yid != "GONE2")
    sent = []
    monkeypatch.setattr(audit, "_send_alert", lambda text: sent.append(text))
    report = audit.run_audit_and_alert(now=time.time() + 4 * HOUR)
    assert report["incomplete"] == [] and report["liveness"]["gone_total"] == 1
    assert len(sent) == 1
    assert "Evening Update — September 10, 2026" in sent[0]
    assert "No longer on YouTube" in sent[0] and "GONE2" in sent[0]
    # And the second daily run stays silent about the same video.
    sent.clear()
    audit.run_audit_and_alert(now=time.time() + 28 * HOUR)
    assert sent == []


def test_a_liveness_failure_never_escapes_the_scheduler_job(edu_db, monkeypatch):
    _session()
    monkeypatch.setenv("DESK_VIDEO_LIVENESS_ENABLED", "1")
    monkeypatch.setattr(audit, "sweep_liveness",
                        lambda **kw: (_ for _ in ()).throw(RuntimeError("volume gone")))
    report = audit.run_audit_and_alert(now=time.time() + 4 * HOUR)   # must not raise
    assert "error" in report["liveness"]


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


def test_the_liveness_sweep_has_an_ON_DEMAND_door_and_it_is_a_POST():
    """The sweep shipped reachable only from the 09:00 ET job, so "has a video
    been pulled?" was answerable once a day. It MUTATES (cursor + gone-set), so
    the door is a POST, never a query param on the read-only GET."""
    from api.routers import desk_zoom_webhook as dzw
    routes = [(getattr(r, "path", ""), set(getattr(r, "methods", ()) or ())) for r in dzw.router.routes]
    assert any(p.endswith("/session-audit") for p, _ in routes), "the route probe is broken"
    hit = [(p, m) for p, m in routes if p.endswith("/video-liveness")]
    assert hit, f"POST /video-liveness is not mounted. Router paths: {[p for p, _ in routes]}"
    assert "POST" in hit[0][1], f"/video-liveness must be a POST (it mutates); methods={hit[0][1]}"
    # ⛔ and the read path stays a read: no GET may advance the cursor.
    audit_methods = {m for p, ms in routes if p.endswith("/session-audit") for m in ms}
    assert "POST" not in audit_methods, "GET /session-audit must not have grown a mutating verb"


def test_the_on_demand_sweep_size_is_CLAMPED_under_the_edge_proxy_budget():
    """Sequential probes × the 6 s timeout must stay under Cloudflare's ~100 s,
    or a caller gets a 524 while the pod works on."""
    c = audit.clamp_liveness_limit
    assert c(None) == audit.ENDPOINT_LIVENESS_MAX
    assert c("not a number") == audit.ENDPOINT_LIVENESS_MAX
    assert c(9999) == audit.ENDPOINT_LIVENESS_MAX
    assert c(0) == 1 and c(-5) == 1
    assert c(5) == 5
    assert audit.ENDPOINT_LIVENESS_MAX * audit._LIVENESS_TIMEOUT_S < 100, (
        "the on-demand ceiling × the per-probe timeout now exceeds the edge proxy budget")
    # The DAILY job keeps its own, larger default — it has no client waiting.
    assert audit._liveness_per_run() > audit.ENDPOINT_LIVENESS_MAX


def test_the_on_demand_door_refuses_without_the_bearer(edu_db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import desk_zoom_webhook as dzw
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    called = []
    monkeypatch.setattr(audit, "sweep_liveness", lambda **kw: called.append(kw) or {"checked": 0})
    app = FastAPI(); app.include_router(dzw.router)
    client = TestClient(app)
    assert client.post("/api/desk/video-liveness").status_code == 401
    assert called == [], "the sweep ran for an unauthenticated caller"
    ok = client.post("/api/desk/video-liveness?limit=3", headers={"Authorization": "Bearer s3cret"})
    assert ok.status_code == 200, ok.text
    assert called == [{"limit": 3}], f"the clamped limit did not reach the sweep: {called}"
    # ⛔ THE ENDPOINT MUST APPLY THE CLAMP, not merely have one available: a caller
    # asking for the whole library gets the ceiling, so no single POST can outlive
    # the edge proxy. Without this the pure-function test above passes while the
    # call site hands 9999 straight through.
    called.clear()
    client.post("/api/desk/video-liveness?limit=9999", headers={"Authorization": "Bearer s3cret"})
    assert called == [{"limit": audit.ENDPOINT_LIVENESS_MAX}], (
        f"the endpoint did not clamp an oversized limit: {called}")
