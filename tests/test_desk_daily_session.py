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
    assert dds._session_title("2026-06-24T13:30:00Z") == "Daily Session — June 24, 2026"


def test_session_title_handles_utc_midnight_rolling_back_to_prev_et_day():
    # 2026-06-25T02:00:00Z == 2026-06-24 22:00 ET
    assert dds._session_title("2026-06-25T02:00:00Z") == "Daily Session — June 24, 2026"


def test_session_title_falls_back_to_now_when_missing():
    fixed = datetime(2026, 6, 24, 12, 0, tzinfo=ET)
    assert dds._session_title(None, now=fixed) == "Daily Session — June 24, 2026"


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


def test_publish_creates_dated_record(edu_db):
    client = _FakeClient([{"video_id": "VID1", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z", "privacy": "unlisted"}])
    created = dds.publish_new_sessions(client=client)
    assert len(created) == 1
    assert created[0]["youtube_id"] == "VID1"
    assert created[0]["title"] == "Daily Session — June 24, 2026"
    assert created[0]["category"] == "Daily Sessions"


def test_publish_is_idempotent(edu_db):
    client = _FakeClient([{"video_id": "VID1", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z"}])
    assert len(dds.publish_new_sessions(client=client)) == 1
    assert dds.publish_new_sessions(client=client) == []   # second run no-ops
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
    edu.create_video({"youtube_id": "V", "title": "Daily Session — June 24, 2026",
                      "category": "Daily Sessions", "sort_order": 0})
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    assert dds.check_missing_session_alert(now=wed, publish=False) is False
    assert fired == []


def test_safety_net_fires_when_absent_on_weekday(edu_db, monkeypatch):
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
    assert created[0]["title"] == "Daily Session — June 24, 2026"


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


# --- Fix 3 (I2): distinct auth-failure alert tests ---

def test_safety_net_auth_failure_fires_auth_alert(edu_db, monkeypatch):
    """When publish_new_sessions raises YouTubeAuthError, kind='auth' alert is fired."""
    fired = []
    monkeypatch.setattr(dds, "publish_new_sessions",
                        lambda **kw: (_ for _ in ()).throw(dds.YouTubeAuthError("boom")))
    monkeypatch.setattr(dds, "_alert_owner",
                        lambda now, **kw: fired.append((now, kw.get("kind", "missing"))))
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    result = dds.check_missing_session_alert(now=wed, publish=True)
    assert result is True
    assert len(fired) == 1
    assert fired[0][1] == "auth"


def test_safety_net_generic_publish_error_still_checks(edu_db, monkeypatch):
    """A generic RuntimeError from publish is swallowed; missing session fires kind='missing'."""
    fired = []
    monkeypatch.setattr(dds, "publish_new_sessions",
                        lambda **kw: (_ for _ in ()).throw(RuntimeError("oops")))
    monkeypatch.setattr(dds, "_alert_owner",
                        lambda now, **kw: fired.append((now, kw.get("kind", "missing"))))
    wed = datetime(2026, 6, 24, 18, 0, tzinfo=ET)
    result = dds.check_missing_session_alert(now=wed, publish=True)
    assert result is True
    assert len(fired) == 1
    assert fired[0][1] == "missing"
