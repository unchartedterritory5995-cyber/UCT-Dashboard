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
