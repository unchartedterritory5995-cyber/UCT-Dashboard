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
    def upload(self, path, title, description="", privacy="unlisted"):
        return "VIDX"
    def set_thumbnail(self, video_id, image_bytes):
        self.thumbs.append((video_id, len(image_bytes)))


@pytest.fixture
def jobs_db(monkeypatch):
    import tempfile, os as _os
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(q, "_DB_PATH", _os.path.join(d, "jobs.db")); q._init_db()
        yield q


# ---------------------------------------------------------------------------
# YouTube privacy routing — Sunday Scans is public, EVERY other show is unlisted.
#
# The paywalled shows (Live Trading Sessions above all) reach YouTube through this
# exact call, so a routing bug here does not read as "wrong metadata" — it PUBLISHES
# A PAID SESSION. These tests are the rail on that, and they are deliberately
# derived from the routing registry rather than a typed list of show names: a show
# added to _RULES/_HOST_AWARE tomorrow is covered the day it lands, and defaults to
# unlisted without anyone remembering to come back here.
# ---------------------------------------------------------------------------


class _RecordingYT(_FakeYT):
    """Records the privacy each upload was asked for."""
    def __init__(self):
        super().__init__()
        self.uploads = []

    def upload(self, path, title, description="", privacy="unlisted"):
        self.uploads.append({"title": title, "privacy": privacy})
        return "VIDX"


def _privacy_after_publishing(topic, edu_db, jobs_db, uuid="UP1"):
    """Run the real pipeline for a webinar name; return the privacy YouTube got."""
    jobs_db.enqueue(uuid, topic, "2026-08-09T21:50:00Z", "http://dl", "tok")
    yt = _RecordingYT()
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=yt)
    assert yt.uploads, f"nothing was uploaded for topic {topic!r}"
    return yt.uploads[0]["privacy"]


def test_sunday_scans_uploads_public(edu_db, jobs_db):
    assert _privacy_after_publishing("SUNDAY SCANS", edu_db, jobs_db) == "public"


def test_sunday_scans_name_variants_all_upload_public(edu_db, jobs_db):
    # The name is hand-typed into Zoom every week; casing and pluralisation drift.
    for i, topic in enumerate(["Sunday Scans", "sunday scan", "SUNDAY  SCANS"]):
        assert _privacy_after_publishing(topic, edu_db, jobs_db, uuid=f"UV{i}") == "public", topic


def test_live_trading_session_is_never_public(edu_db, jobs_db):
    # THE safety rail: Live Trading Sessions are paywalled.
    assert _privacy_after_publishing("LIVE TRADING TODAY", edu_db, jobs_db) == "unlisted"


def test_every_routed_show_except_sunday_scans_stays_unlisted(edu_db, jobs_db):
    # Derived from the registry the router actually iterates — never a typed list.
    topics = [kw for kw, _section in dds._HOST_AWARE]
    topics += [kw for kw, _s, _p, _e in dds._RULES]
    topics += ["Some Brand New Show", ""]          # auto-derived + default routes
    leaked = []
    for i, topic in enumerate(topics):
        section, _prefix, _eyebrow = dds._route(topic)
        privacy = _privacy_after_publishing(topic, edu_db, jobs_db, uuid=f"UR{i}")
        if privacy == "public" and section != "Sunday Scans":
            leaked.append(f"{topic!r} -> section {section!r} -> {privacy}")
    assert not leaked, "these shows would publish PUBLICLY on YouTube:\n  " + "\n  ".join(leaked)


def test_blank_public_shows_env_makes_nothing_public(edu_db, jobs_db, monkeypatch):
    # Failure direction is private, never a leak — mirrors DESK_TSDR_ANNOUNCE_SHOWS.
    monkeypatch.setenv("DESK_PUBLIC_SHOWS", "")
    assert _privacy_after_publishing("SUNDAY SCANS", edu_db, jobs_db) == "unlisted"


def test_wildcard_public_shows_makes_every_show_public(edu_db, jobs_db, monkeypatch):
    # Owner decision 2026-08-19: DESK_PUBLIC_SHOWS="*" uploads EVERY show public.
    # Derived from the routing registry, same as the unlisted-default rail above.
    monkeypatch.setenv("DESK_PUBLIC_SHOWS", "*")
    topics = [kw for kw, _section in dds._HOST_AWARE]
    topics += [kw for kw, _s, _p, _e in dds._RULES]
    topics += ["Some Brand New Show", ""]          # auto-derived + default routes
    still_private = []
    for i, topic in enumerate(topics):
        if _privacy_after_publishing(topic, edu_db, jobs_db, uuid=f"UW{i}") != "public":
            still_private.append(repr(topic))
    assert not still_private, "wildcard left these unlisted: " + ", ".join(still_private)


def test_wildcard_must_be_the_whole_entry_not_a_substring(edu_db, jobs_db, monkeypatch):
    # A stray "*" inside a real entry must not blow the doors open on every show.
    monkeypatch.setenv("DESK_PUBLIC_SHOWS", "sunday scans*")
    assert _privacy_after_publishing("LIVE TRADING TODAY", edu_db, jobs_db) == "unlisted"


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
        def upload(self, *a, **k): raise RuntimeError("upload boom")
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
        def upload(self, *a, **k): raise AssertionError("should not upload")
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

# ---------------------------------------------------------------------------
# Creative titles + covers (DESK_CREATIVE_TITLES / DESK_CREATIVE_THUMBS)
#
# The flags default OFF and blank env = byte-for-byte today's behavior; when
# ON, the composed title must reach BOTH the YouTube upload and the library
# row (the "computed but never applied" failure this repo keeps paying for),
# and any creative failure must land exactly on the classic path.
# ---------------------------------------------------------------------------

from api.services import desk_creative


class _ByteThumbYT(_RecordingYT):
    """Also records the actual thumbnail bytes each set_thumbnail received."""
    def __init__(self):
        super().__init__()
        self.thumb_bytes = []

    def set_thumbnail(self, video_id, image_bytes):
        super().set_thumbnail(video_id, image_bytes)
        self.thumb_bytes.append(image_bytes)


def _publish_one(jobs_db, yt, topic="Live Trading Session", uuid="UC1"):
    jobs_db.enqueue(uuid, topic, "2026-06-24T13:30:00Z", "http://dl", "tok")
    return dds.process_pending_jobs(zoom=_FakeZoom(), youtube=yt)


def test_flags_off_creative_is_never_consulted(edu_db, jobs_db, monkeypatch):
    monkeypatch.delenv("DESK_CREATIVE_TITLES", raising=False)
    monkeypatch.delenv("DESK_CREATIVE_THUMBS", raising=False)
    def boom(**kw):
        raise AssertionError("creative composer called while flags are off")
    monkeypatch.setattr(desk_creative, "compose_title", boom)
    monkeypatch.setattr(desk_creative, "render_cover", boom)
    yt = _ByteThumbYT()
    out = _publish_one(jobs_db, yt)
    assert len(out) == 1
    assert yt.uploads[0]["title"] == "Live Trading Session — June 24, 2026"
    assert yt.thumbs and yt.thumbs[0][1] > 1000            # themed card still set


def test_creative_title_reaches_upload_and_library(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_TITLES", "1")
    creative = "MU Holds the Line | Live Trading Session — June 24, 2026"
    seen = {}
    def fake(**kw):
        seen.update(kw)
        return creative
    monkeypatch.setattr(desk_creative, "compose_title", fake)
    yt = _RecordingYT()
    _publish_one(jobs_db, yt)
    assert yt.uploads[0]["title"] == creative              # not the classic format
    assert edu.list_videos()[0]["title"] == creative
    assert seen["title_prefix"] == "Live Trading Session"  # routed name passed through
    assert seen["date_text"] == "June 24, 2026"


def test_creative_title_crash_ships_the_classic_title(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_TITLES", "1")
    def boom(**kw):
        raise RuntimeError("title desk down")
    monkeypatch.setattr(desk_creative, "compose_title", boom)
    yt = _RecordingYT()
    out = _publish_one(jobs_db, yt)
    assert len(out) == 1                                   # publish survives
    assert yt.uploads[0]["title"] == "Live Trading Session — June 24, 2026"


def test_creative_cover_bytes_reach_youtube(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    marker = b"CREATIVE-JPEG" * 200
    monkeypatch.setattr(desk_creative, "render_cover", lambda **kw: marker)
    yt = _ByteThumbYT()
    _publish_one(jobs_db, yt)
    assert yt.thumb_bytes == [marker]


def test_creative_cover_none_falls_back_to_themed_card(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(desk_creative, "render_cover", lambda **kw: None)
    yt = _ByteThumbYT()
    _publish_one(jobs_db, yt)
    assert yt.thumb_bytes and len(yt.thumb_bytes[0]) > 1000
    assert yt.thumb_bytes[0][:4] == b"\xff\xd8\xff\xe0"    # a real rendered JPEG


def test_creative_cover_crash_still_sets_themed_card(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    def boom(**kw):
        raise RuntimeError("cover director down")
    monkeypatch.setattr(desk_creative, "render_cover", boom)
    yt = _ByteThumbYT()
    out = _publish_one(jobs_db, yt)
    assert len(out) == 1
    assert yt.thumb_bytes and len(yt.thumb_bytes[0]) > 1000


# ---------------------------------------------------------------------------
# todays_session_exists — the 18:00 safety net must recognize BOTH title styles
# (exact-title equality would false-alert every day once creative titles ship).
# ---------------------------------------------------------------------------

_WED_EOD = datetime(2026, 6, 24, 18, 0, tzinfo=ET)


def test_safety_net_recognizes_the_classic_title(edu_db):
    edu.create_video({"youtube_id": "V1", "title": "Live Trading Session — June 24, 2026",
                      "category": "Live Trading Sessions", "sort_order": 0})
    assert dds.todays_session_exists(now=_WED_EOD) is True


def test_safety_net_recognizes_a_creative_title(edu_db):
    edu.create_video({"youtube_id": "V1",
                      "title": "MU Holds the Line | Live Trading Session — June 24, 2026",
                      "category": "Live Trading Sessions", "sort_order": 0})
    assert dds.todays_session_exists(now=_WED_EOD) is True


def test_safety_net_still_fires_on_a_stale_date(edu_db):
    edu.create_video({"youtube_id": "V1",
                      "title": "Whatever | Live Trading Session — June 23, 2026",
                      "category": "Live Trading Sessions", "sort_order": 0})
    assert dds.todays_session_exists(now=_WED_EOD) is False


def test_safety_net_ignores_other_show_categories(edu_db):
    edu.create_video({"youtube_id": "V1", "title": "Sunday Scans — June 24, 2026",
                      "category": "Sunday Scans", "sort_order": 0})
    assert dds.todays_session_exists(now=_WED_EOD) is False


# ---------------------------------------------------------------------------
# Review fixes (2026-08-19): a creative title is composed exactly once, on the
# attempt that uploads; recorded only after the upload confirms; and a
# re-claimed job recalls the SHIPPED title instead of recomposing a new one.
# ---------------------------------------------------------------------------

def test_reclaimed_job_recalls_shipped_title_never_recomposes(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_TITLES", "1")
    monkeypatch.setattr(q, "_STALE_SECS", -1)   # processing row instantly reclaimable
    recalled = "MU Holds 767 | Live Trading Session — June 24, 2026"
    def boom(**kw):
        raise AssertionError("compose_title must not run for a re-claimed job")
    monkeypatch.setattr(desk_creative, "compose_title", boom)
    monkeypatch.setattr(desk_creative, "recall_title",
                        lambda prefix, date_text, **kw: recalled)
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    jobs_db.claim_next(); jobs_db.mark_uploaded("U1", "VIDZ")   # crashed after upload
    class _NoDownloadZoom(_FakeZoom):
        def stream_download(self, *a, **k):
            raise AssertionError("re-claimed job must not re-download")
    out = dds.process_pending_jobs(zoom=_NoDownloadZoom(), youtube=_FakeYT())
    assert len(out) == 1
    assert edu.list_videos()[0]["title"] == recalled            # matches the video


def test_shipped_title_is_recorded_only_after_successful_upload(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_TITLES", "1")
    creative = "MU Holds 767 | Live Trading Session — June 24, 2026"
    recorded = []
    monkeypatch.setattr(desk_creative, "compose_title", lambda **kw: creative)
    monkeypatch.setattr(desk_creative, "record_shipped_title",
                        lambda title, **kw: recorded.append(title))
    yt = _RecordingYT()
    _publish_one(jobs_db, yt)
    assert recorded == [creative]


def test_failed_upload_records_nothing_in_title_history(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_TITLES", "1")
    monkeypatch.setattr(q, "_MAX_ATTEMPTS", 1)
    recorded = []
    monkeypatch.setattr(desk_creative, "compose_title", lambda **kw: "H | X — June 24, 2026")
    monkeypatch.setattr(desk_creative, "record_shipped_title",
                        lambda title, **kw: recorded.append(title))
    class _BoomYT2:
        def upload(self, *a, **k):
            raise RuntimeError("upload boom")
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=_BoomYT2())
    assert recorded == []


def test_failed_download_never_composes_a_title(edu_db, jobs_db, monkeypatch):
    # An LLM call per retry of a broken download = history pollution + spend.
    monkeypatch.setenv("DESK_CREATIVE_TITLES", "1")
    monkeypatch.setattr(q, "_MAX_ATTEMPTS", 1)
    composed = []
    monkeypatch.setattr(desk_creative, "compose_title",
                        lambda **kw: composed.append(1) or "H | X — June 24, 2026")
    class _DownBoomZoom(_FakeZoom):
        def stream_download(self, *a, **k):
            raise RuntimeError("download boom")
    jobs_db.enqueue("U1", "Live Trading Session", "2026-06-24T13:30:00Z", "http://dl", "tok")
    dds.process_pending_jobs(zoom=_DownBoomZoom(), youtube=_FakeYT())
    assert composed == []
