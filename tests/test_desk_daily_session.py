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
    # "Post Market Recap" is now a curated alias -> Post-Market Recaps section
    # (see test_route_aliases below); an UNLISTED name still auto-derives.
    assert dds._route("Thoughts on Current Market") == (
        "Thoughts on Current Market", "Thoughts on Current Market", "THOUGHTS ON CURRENT MARKET")
    assert dds._route("") == ("Live Trading Sessions", "Live Trading Session", "LIVE TRADING SESSION")


@pytest.mark.parametrize("topic,section", [
    ("Live Trading Today", "Live Trading Sessions"),
    ("Daily Session", "Live Trading Sessions"),
    ("Thoughts on the Market", "Thoughts on the Market"),
    ("Market thoughts w/ Bracco & BucketHead", "Thoughts on the Market"),
    ("Thoughts on the mkt TSDR", "Thoughts on the Market"),
    ("Post Market Recap", "Post-Market Recaps"),
    ("Post-Market Wrap", "Post-Market Recaps"),
    ("Workshop with Zen", "Workshops & Fireside Chats"),
    ("Evening Update from Bracco", "Evening Update"),
    ("", "Live Trading Sessions"),
    ("Brand New Show", "Brand New Show"),   # auto-derive stays
])
def test_route_aliases(topic, section):
    assert dds._route(topic)[0] == section


def test_route_evening_update_is_host_aware():
    # Any "Evening Update from <host>" shares the "Evening Update" section; the host
    # rides in the title prefix + the thumbnail eyebrow (which trips the evening theme).
    assert dds._route("Evening Update from TSDR") == (
        "Evening Update", "Evening Update from TSDR", "EVENING UPDATE FROM TSDR")
    assert dds._route("Evening Update from Bracco") == (
        "Evening Update", "Evening Update from Bracco", "EVENING UPDATE FROM BRACCO")


def test_route_collapses_a_double_space_instead_of_forking_the_shelf():
    # The webinar name is hand-typed into Zoom. "Evening  Update from TSDR" (a REAL
    # double space, 2026-07-27) missed the `evening update` substring, auto-derived,
    # and created a SECOND one-video shelf beside the real "Evening Update" —
    # the show was split in two on the Desk landing until 2026-07-30.
    assert dds._route("Evening  Update from TSDR") == (
        "Evening Update", "Evening Update from TSDR", "EVENING UPDATE FROM TSDR")
    # Normalizing `t` itself keeps the double space out of the published title +
    # the thumbnail eyebrow, not just out of the matching.
    assert "  " not in dds._route("Evening  Update from TSDR")[1]
    # Every other match arm is a substring test too — they all get the same benefit.
    assert dds._route("Workshop   with Zen")[0] == "Workshops & Fireside Chats"
    assert dds._route("  Sunday   Scans  ")[0] == "Sunday Scans"
    assert dds._route("Live  Trading Today")[0] == "Live Trading Sessions"
    # A tab/newline pasted from a calendar invite behaves the same as a space.
    assert dds._route("Evening\tUpdate from TSDR")[0] == "Evening Update"
    # Auto-derive still works, and its section is the CLEAN name.
    assert dds._route("Brand   New  Show")[0] == "Brand New Show"


def test_normalized_route_still_satisfies_the_public_announce_allowlist():
    # The routing fix must not move a show OUT of (or INTO) the paywall guard on
    # the PUBLIC TSDR Discord. desk_session_announce.show_allowed() is what gates
    # it; assert the labels _route now emits still resolve the same way.
    from api.services import desk_session_announce as ann

    section, prefix, _ = dds._route("Evening  Update from TSDR")
    assert ann.show_allowed(section, prefix) is True, "evening update must stay announceable"
    # And the paywalled shows stay silent — the failure direction that matters.
    lt_section, lt_prefix, _ = dds._route("Live Trading Today")
    assert ann.show_allowed(lt_section, lt_prefix) is False, "live trading must never announce"


def test_route_workshop_is_host_aware():
    # Workshops are per-HOST events. The section stays pinned (one shelf for every
    # workshop) but the host MUST survive into the title + the eyebrow — the eyebrow
    # is what `desk_thumbnail._resolve_theme` keys the bespoke per-host cards off.
    # Flattening it to "WORKSHOP" silently downgraded ChartMaster/Zen to the default
    # card and stripped the host from the published title (2026-07-29, video 307).
    assert dds._route("Workshop with ChartMaster") == (
        "Workshops & Fireside Chats", "Workshop with ChartMaster",
        "WORKSHOP WITH CHARTMASTER")
    assert dds._route("Workshop with Zen") == (
        "Workshops & Fireside Chats", "Workshop with Zen", "WORKSHOP WITH ZEN")
    # A bare "Workshop" still reads exactly as before.
    assert dds._route("Workshop") == (
        "Workshops & Fireside Chats", "Workshop", "WORKSHOP")


def test_route_workshop_eyebrow_reaches_the_bespoke_thumbnail_theme():
    # End-to-end on the seam that actually broke: the eyebrow _route emits must be
    # the one that trips the per-host card. Asserts the ARTIFACT (resolved theme),
    # not that the string merely contains the host name.
    from api.services import desk_thumbnail as dt
    _, _, eyebrow = dds._route("Workshop with ChartMaster")
    assert dt._resolve_theme(None, eyebrow).layout == "plate"
    _, _, zen_eyebrow = dds._route("Workshop with Zen")
    assert dt._resolve_theme(None, zen_eyebrow).layout == "zen"


def test_process_routes_by_webinar_name(edu_db, jobs_db):
    # "Sector Rotation Briefing" isn't a curated alias -> auto-derives its own section.
    jobs_db.enqueue("U2", "Sector Rotation Briefing", "2026-06-24T20:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    v = edu.list_videos()[0]
    assert v["title"] == "Sector Rotation Briefing — June 24, 2026"
    assert v["category"] == "Sector Rotation Briefing"


def test_process_routes_curated_alias_to_shared_section(edu_db, jobs_db):
    # "Post Market Recap" is a curated alias -> canonical "Post-Market Recaps" section.
    jobs_db.enqueue("U2b", "Post Market Recap", "2026-06-24T20:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    v = edu.list_videos()[0]
    assert v["title"] == "Post-Market Recap — June 24, 2026"
    assert v["category"] == "Post-Market Recaps"


def test_process_evening_update_publishes_with_section(edu_db, jobs_db):
    # A second host (Bracco) lands in the shared "Evening Update" section with the
    # host in the title.
    jobs_db.enqueue("U3", "Evening Update from Bracco", "2026-06-29T21:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    v = edu.list_videos()[0]
    assert v["title"] == "Evening Update from Bracco — June 29, 2026"
    assert v["category"] == "Evening Update"


def test_is_test_recording():
    assert dds._is_test_recording("TEST")
    assert dds._is_test_recording("test recording")
    assert dds._is_test_recording("  Demo run")
    assert not dds._is_test_recording("Evening Update from TSDR")
    assert not dds._is_test_recording("Latest Market Update")   # 'Lat…' != 'test'
    assert not dds._is_test_recording("")


def test_process_skips_test_recording(edu_db, jobs_db):
    # A webinar named "TEST" is a dry run: nothing published, no alert, and the job
    # ends terminal ('skipped') so it's never re-processed.
    jobs_db.enqueue("UT", "TEST", "2026-06-30T21:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    assert edu.list_videos() == []
    assert jobs_db.count_status("skipped") == 1
    assert jobs_db.count_status("done") == 0


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


# ---------------------------------------------------------------------------
# Task 3: show auto-registration (guarded register_category_if_missing before publish)
# ---------------------------------------------------------------------------

def test_process_pending_jobs_registers_show_category(edu_db, jobs_db):
    jobs_db.enqueue("U4", "Post Market Recap", "2026-06-24T20:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    cats = {c["name"]: c["kind"] for c in edu.list_category_meta()}
    assert cats.get("Post-Market Recaps") == "show"


def test_process_pending_jobs_survives_register_category_failure(edu_db, jobs_db, monkeypatch):
    # Meta registration must never break publish, even if it raises.
    monkeypatch.setattr(edu, "register_category_if_missing",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    jobs_db.enqueue("U5", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    out = dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    assert len(out) == 1
    assert edu.list_videos()[0]["youtube_id"] == "VIDX"


def test_process_pending_jobs_preserves_existing_library_kind(edu_db, jobs_db):
    # Admin has re-taxonomized "Workshops & Fireside Chats" to 'library' — the
    # publish path must NEVER flip it back to 'show' on the next matching
    # recording (that's the whole point of the create-only registration).
    edu.upsert_category("Workshops & Fireside Chats", kind="library")
    jobs_db.enqueue("U6", "Workshop with X", "2026-06-24T20:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_FakeYT())
    cats = {c["name"]: c["kind"] for c in edu.list_category_meta()}
    assert cats.get("Workshops & Fireside Chats") == "library"


def test_publish_new_sessions_registers_show_category(edu_db):
    client = _FakeClient([{"video_id": "VIDL", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z"}])
    dds.publish_new_sessions(client=client, now=_NOW)
    cats = {c["name"]: c["kind"] for c in edu.list_category_meta()}
    assert cats.get("Live Trading Sessions") == "show"


def test_publish_new_sessions_survives_register_category_failure(edu_db, monkeypatch):
    monkeypatch.setattr(edu, "register_category_if_missing",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    client = _FakeClient([{"video_id": "VIDM", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z"}])
    created = dds.publish_new_sessions(client=client, now=_NOW)
    assert len(created) == 1
    assert created[0]["youtube_id"] == "VIDM"


def test_publish_new_sessions_preserves_existing_library_kind(edu_db, monkeypatch):
    # Live Trading Sessions was re-taxonomized to 'library' by an admin — the
    # daily publish job must never flip it back to 'show'.
    edu.upsert_category("Live Trading Sessions", kind="library")
    client = _FakeClient([{"video_id": "VIDN", "title": "raw",
                           "started_at": "2026-06-24T13:30:00Z"}])
    dds.publish_new_sessions(client=client, now=_NOW)
    cats = {c["name"]: c["kind"] for c in edu.list_category_meta()}
    assert cats.get("Live Trading Sessions") == "library"


def test_sunday_scans_routes_to_its_own_section():
    # The Zoom webinar name drives everything. Pinning "sunday scan" keeps the
    # section/title stable across the plural and any capitalisation the host
    # types, instead of auto-deriving a new section per spelling.
    for topic in ("Sunday Scans", "sunday scans", "SUNDAY SCAN"):
        assert dds._route(topic) == (
            "Sunday Scans", "Sunday Scans", "SUNDAY SCANS"), topic


def test_sunday_scans_title_uses_the_pinned_prefix():
    section, prefix, eyebrow = dds._route("Sunday Scans")
    assert f"{prefix} — {dds._session_date_text('2026-07-26T14:00:00Z')}".startswith(
        "Sunday Scans — July 26, 2026")
