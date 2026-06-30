import os
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import desk_daily_session as dds
from api.services import education_service as edu

ET = ZoneInfo("America/New_York")


def test_session_title_formats_et_date():
    # 2026-06-24T13:30:00Z == 09:30 ET, still June 24
    assert dds._session_title("2026-06-24T13:30:00Z") == "Live Trading Session — June 24, 2026"


def test_session_title_handles_utc_midnight_rolling_back_to_prev_et_day():
    # 2026-06-25T02:00:00Z == 2026-06-24 22:00 ET
    assert dds._session_title("2026-06-25T02:00:00Z") == "Live Trading Session — June 24, 2026"


def test_session_title_falls_back_to_now_when_missing():
    fixed = datetime(2026, 6, 24, 12, 0, tzinfo=ET)
    assert dds._session_title(None, now=fixed) == "Live Trading Session — June 24, 2026"


class _FakeClient:
    def __init__(self, rows):
        self._rows = rows
    def list_completed_broadcasts(self, max_results=10):
        return self._rows


@pytest.fixture
def edu_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(edu, "_DB_PATH", os.path.join(d, "education.db"))
        edu._init_db()
        yield edu


_NOW = datetime(2026, 6, 24, 12, 0, tzinfo=ET)  # pin date-floor so tests are time-independent


def test_publish_creates_dated_record(edu_db):
    client = _FakeClient([{"video_id": "VID1", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z", "privacy": "unlisted"}])
    created = dds.publish_new_sessions(client=client, now=_NOW)
    assert len(created) == 1
    assert created[0]["youtube_id"] == "VID1"
    assert created[0]["title"] == "Live Trading Session — June 24, 2026"
    assert created[0]["category"] == "Live Trading Sessions"


def test_publish_is_idempotent(edu_db):
    client = _FakeClient([{"video_id": "VID1", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z"}])
    assert len(dds.publish_new_sessions(client=client, now=_NOW)) == 1
    assert dds.publish_new_sessions(client=client, now=_NOW) == []   # second run no-ops
    assert len(edu.list_videos()) == 1


def test_safety_net_silent_on_weekend(edu_db, monkeypatch):
    fired = []
    monkeypatch.setattr(dds, "_alert_owner", lambda now, **kw: fired.append((now, kw.get("kind", "missing"))))
    sat = datetime(2026, 6, 27, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=sat, publish=False) is False
    assert fired == []


def test_safety_net_silent_when_today_present(edu_db, monkeypatch):
    fired = []
    monkeypatch.setattr(dds, "_alert_owner", lambda now, **kw: fired.append((now, kw.get("kind", "missing"))))
    edu.create_video({"youtube_id": "V", "title": "Live Trading Session — June 24, 2026",
                      "category": "Live Trading Sessions", "sort_order": 0})
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=wed, publish=False) is False
    assert fired == []


def test_safety_net_fires_when_absent_on_weekday(edu_db, jobs_db, monkeypatch):
    fired = []
    monkeypatch.setattr(dds, "_alert_owner", lambda now, **kw: fired.append((now, kw.get("kind", "missing"))))
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=wed, publish=False) is True
    assert len(fired) == 1
    assert fired[0][1] == "missing"


# --- Fix 2 (I3): date floor tests ---

def test_publish_skips_broadcasts_before_floor(edu_db):
    """Default floor = today (ET); yesterday's broadcast is skipped, today's is created."""
    fixed_now = datetime(2026, 6, 24, 18, 0, tzinfo=ET)  # Tuesday
    yesterday_iso = "2026-06-23T13:30:00Z"   # June 23 ET
    today_iso = "2026-06-24T13:30:00Z"       # June 24 ET
    fc = _FakeClient([
        {"video_id": "YEST", "title": "r", "started_at": yesterday_iso},
        {"video_id": "TODAY", "title": "r", "started_at": today_iso},
    ])
    created = dds.publish_new_sessions(client=fc, now=fixed_now)
    assert len(created) == 1
    assert created[0]["youtube_id"] == "TODAY"
    assert created[0]["title"] == "Live Trading Session — June 24, 2026"


def test_publish_respects_start_date_env(edu_db, monkeypatch):
    """When env floor is set to an old date, yesterday's broadcast should be published."""
    monkeypatch.setenv("DESK_DAILY_SESSION_START_DATE", "2020-01-01")
    fixed_now = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    yesterday_iso = "2026-06-23T13:30:00Z"  # June 23 ET — before default floor but after env floor
    fc = _FakeClient([
        {"video_id": "YEST", "title": "r", "started_at": yesterday_iso},
    ])
    created = dds.publish_new_sessions(client=fc, now=fixed_now)
    assert len(created) == 1
    assert created[0]["youtube_id"] == "YEST"


# --- Fix B (review #5): queue-aware safety net tests ---

def test_safety_net_stuck_queue_fires_stuck_alert(edu_db, jobs_db, monkeypatch):
    fired = []
    monkeypatch.setattr(dds, "_alert_owner", lambda now, **kw: fired.append(kw.get("kind", "missing")))
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    jobs_db.claim_next()  # leave it in 'processing' -> stuck
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=wed, publish=False) is True
    assert fired == ["stuck"]

def test_safety_net_missing_when_no_session_and_empty_queue(edu_db, jobs_db, monkeypatch):
    fired = []
    monkeypatch.setattr(dds, "_alert_owner", lambda now, **kw: fired.append(kw.get("kind", "missing")))
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=wed, publish=False) is True
    assert fired == ["missing"]


# ---------------------------------------------------------------------------
# Task 5: process_pending_jobs
# ---------------------------------------------------------------------------

from api.services import desk_session_jobs as q


class _FakeZoom:
    def __init__(self): self.deleted = []
    def stream_download(self, url, token, dest):
        with open(dest, "wb") as f: f.write(b"video")
        return dest
    def delete_recording(self, uuid): self.deleted.append(uuid)


class _FakeYT:
    def __init__(self): self.thumbs = []
    def upload_unlisted(self, path, title, description=""):
        return "VIDX"
    def set_thumbnail(self, video_id, image_bytes):
        self.thumbs.append((video_id, len(image_bytes)))


@pytest.fixture
def jobs_db(monkeypatch):
    import tempfile, os as _os
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(q, "_DB_PATH", _os.path.join(d, "jobs.db")); q._init_db()
        yield q


def test_process_pending_publishes_and_cleans(edu_db, jobs_db):
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    z = _FakeZoom(); yt = _FakeYT()
    out = dds.process_pending_jobs(zoom=z, youtube=yt)
    assert len(out) == 1
    vids = edu.list_videos()
    assert len(vids) == 1 and vids[0]["title"] == "Live Trading Session — June 24, 2026"
    assert vids[0]["youtube_id"] == "VIDX"
    assert z.deleted == ["U1"]                      # Zoom copy trashed
    assert yt.thumbs and yt.thumbs[0][0] == "VIDX" and yt.thumbs[0][1] > 1000  # branded thumb set


def test_thumbnail_failure_is_nonfatal(edu_db, jobs_db):
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    class _ThumbBoomYT(_FakeYT):
        def set_thumbnail(self, video_id, image_bytes):
            raise RuntimeError("thumbnail boom")
    out = dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_ThumbBoomYT())
    assert len(out) == 1                            # publish still succeeds
    assert edu.list_videos()[0]["youtube_id"] == "VIDX"
    assert jobs_db.count_status("done") == 1
    assert jobs_db.count_status("done") == 1


def test_process_idempotent_on_existing_video(edu_db, jobs_db):
    edu.create_video({"youtube_id": "VIDX", "title": "x", "category": "Live Trading Sessions", "sort_order": 0})
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    assert len([v for v in edu.list_videos() if v["youtube_id"] == "VIDX"]) == 1


def test_process_marks_error_on_upload_failure(edu_db, jobs_db, monkeypatch):
    monkeypatch.setattr(q, "_MAX_ATTEMPTS", 1)
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    class _BoomYT:
        def upload_unlisted(self, *a, **k): raise RuntimeError("upload boom")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_BoomYT())
    assert jobs_db.count_status("error") == 1
    assert edu.list_videos() == []


def test_process_skips_reupload_when_job_has_youtube_id(edu_db, jobs_db, monkeypatch):
    from api.services import desk_session_jobs as q2
    monkeypatch.setattr(q2, "_STALE_SECS", -1)  # cutoff = now+1 -> row is always stale/reclaimable
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    jobs_db.claim_next(); jobs_db.mark_uploaded("U1", "VIDZ")  # simulate prior successful upload
    class _BoomZoom:
        def stream_download(self, *a, **k): raise AssertionError("should not download")
        def delete_recording(self, uuid): pass
    class _BoomYT:
        def upload_unlisted(self, *a, **k): raise AssertionError("should not upload")
    out = dds.process_pending_jobs(zoom=_BoomZoom(), youtube=_BoomYT())
    assert len(out) == 1
    vids = [v for v in edu.list_videos() if v["youtube_id"] == "VIDZ"]
    assert len(vids) == 1


def test_process_notifies_on_new_publish(edu_db, jobs_db, monkeypatch):
    calls = []
    monkeypatch.setattr(dds, "_notify_published",
                        lambda title, vid, section=None: calls.append((title, vid, section)))
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    assert calls == [("Live Trading Session — June 24, 2026", "VIDX", "Live Trading Sessions")]


def test_process_does_not_notify_on_idempotent_rerun(edu_db, jobs_db, monkeypatch):
    calls = []
    monkeypatch.setattr(dds, "_notify_published",
                        lambda title, vid, section=None: calls.append(vid))
    edu.create_video({"youtube_id": "VIDX", "title": "x",
                      "category": "Live Trading Sessions", "sort_order": 0})
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    assert calls == []   # video already existed -> no duplicate alert


def test_route_known_auto_and_default():
    assert dds._route("live trading today") == (
        "Live Trading Sessions", "Live Trading Session", "LIVE TRADING SESSION")
    assert dds._route("Post Market Recap") == (
        "Post Market Recap", "Post Market Recap", "POST MARKET RECAP")
    assert dds._route("Thoughts on Current Market") == (
        "Thoughts on Current Market", "Thoughts on Current Market", "THOUGHTS ON CURRENT MARKET")
    assert dds._route("") == ("Live Trading Sessions", "Live Trading Session", "LIVE TRADING SESSION")


def test_route_evening_update_from_tsdr():
    # The new daily show: section "Evening Update", title "Evening Update", and an
    # eyebrow that keeps "FROM TSDR" so the thumbnail's evening theme + subline fire.
    assert dds._route("Evening Update from TSDR") == (
        "Evening Update", "Evening Update", "EVENING UPDATE FROM TSDR")


def test_process_routes_by_webinar_name(edu_db, jobs_db):
    jobs_db.enqueue("U2", "Post Market Recap", "2026-06-24T20:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    v = edu.list_videos()[0]
    assert v["title"] == "Post Market Recap — June 24, 2026"
    assert v["category"] == "Post Market Recap"


def test_process_evening_update_publishes_with_section(edu_db, jobs_db):
    jobs_db.enqueue("U3", "Evening Update from TSDR", "2026-06-29T21:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    v = edu.list_videos()[0]
    assert v["title"] == "Evening Update — June 29, 2026"
    assert v["category"] == "Evening Update"


def test_notify_published_embeds_thumbnail_and_section(monkeypatch):
    # The Discord announcement carries the video thumbnail, the show title, the
    # section name, and a website Watch link.
    sent = {}
    monkeypatch.setattr("api.services.discord_notify._send_webhook",
                        lambda embed: sent.update(embed))
    monkeypatch.setattr(dds, "_alert_recipients", lambda: [])   # skip email path
    dds._notify_published("Evening Update — June 29, 2026", "VIDXYZ", "Evening Update")
    assert "VIDXYZ" in sent["image"]["url"]
    assert "Evening Update — June 29, 2026" in sent["title"]
    assert "Evening Update" in sent["description"]
    assert "uctintelligence.com" in sent["description"]
