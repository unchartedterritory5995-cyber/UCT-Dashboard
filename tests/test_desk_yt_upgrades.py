"""2026-10-05 YouTube upgrades to the Desk pipeline: tracked footer link +
backfill, title guard, series playlists, first comment. Every network call is
mocked; every new call is fail-soft (an upload never fails because of these)."""
import json

import pytest

from api.services import desk_daily_session as dds
from api.services import desk_footer_link_backfill as bf
from api.services import desk_title_guard as guard
from api.services import education_service as edu
from api.services import youtube_client as yc
from api.services import desk_session_jobs as q


# ---------------------------------------------------------------------------
# fixtures (mirrors tests/test_desk_daily_session.py)
# ---------------------------------------------------------------------------

@pytest.fixture
def edu_db(monkeypatch, tmp_path):
    monkeypatch.setattr(edu, "_DB_PATH", str(tmp_path / "edu.db"))
    edu._init_db()
    yield edu


@pytest.fixture
def jobs_db(monkeypatch, tmp_path):
    monkeypatch.setattr(q, "_DB_PATH", str(tmp_path / "jobs.db"))
    q._init_db()
    yield q


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    """No Discord, no email, no Zoom delete, no R2 from the publish path."""
    sent = []
    monkeypatch.setattr("api.services.discord_notify._send_webhook",
                        lambda embed, url=None: sent.append(embed))
    monkeypatch.setattr(dds, "_alert_recipients", lambda: [])
    from api.services import desk_session_insights
    monkeypatch.setattr(desk_session_insights, "is_enabled", lambda: True)
    for k in ("DESK_YT_PLAYLISTS", "DESK_YT_FIRST_COMMENT", "DESK_CREATIVE_TITLES",
              "DESK_CREATIVE_THUMBS", "DESK_KNOWN_SHOWS", "DESK_TITLE_EXTRA_WORDS"):
        monkeypatch.delenv(k, raising=False)
    return sent


class _FakeZoom:
    def stream_download(self, url, token, dest):
        with open(dest, "wb") as f:
            f.write(b"\x00" * 2048)

    def delete_recording(self, uuid):
        pass


class _YT:
    """Records every call; optional failures per method."""
    def __init__(self, fail=()):
        self.fail = set(fail)
        self.uploads, self.playlist_adds, self.comments, self.thumbs = [], [], [], []

    def upload(self, path, title, description="", privacy="unlisted"):
        self.uploads.append({"title": title, "description": description})
        return "VIDX"

    def set_thumbnail(self, video_id, image_bytes):
        self.thumbs.append(video_id)

    def add_to_playlist(self, video_id, playlist_id):
        if "playlist" in self.fail:
            raise yc.YouTubeApiError("playlistItems.insert 403: forbidden")
        self.playlist_adds.append((video_id, playlist_id))
        return "PLI1"

    def post_comment(self, video_id, text):
        if "comment" in self.fail:
            raise yc.YouTubeApiError("commentThreads.insert 403: commentsDisabled")
        self.comments.append((video_id, text))
        return "CT1"


def _publish(jobs_db, yt, topic="Live Trading Session", uuid="U1"):
    jobs_db.enqueue(uuid, topic, "2026-10-05T13:30:00Z", "http://dl", "tok")
    return dds.process_pending_jobs(zoom=_FakeZoom(), youtube=yt)


# ---------------------------------------------------------------------------
# youtube_client: the two new calls, mocked HTTP
# ---------------------------------------------------------------------------

class _Resp:
    def __init__(self, status, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload or {}, text

    def json(self):
        return self._payload


def _client(monkeypatch, status, payload, captured):
    def fake_post(url, params=None, headers=None, json=None, timeout=None, data=None):
        if data is not None:          # token refresh
            return _Resp(200, {"access_token": "AT", "expires_in": 3600})
        captured.update(url=url, params=params, headers=headers, json=json)
        return _Resp(status, payload, text="boom")
    monkeypatch.setattr(yc.httpx, "post", fake_post)
    return yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")


def test_add_to_playlist_posts_playlistItems_insert(monkeypatch):
    cap = {}
    c = _client(monkeypatch, 200, {"id": "PLI9"}, cap)
    assert c.add_to_playlist("VID1", "PL123") == "PLI9"
    assert cap["url"].endswith("/youtube/v3/playlistItems")
    assert cap["params"] == {"part": "snippet"}
    assert cap["headers"]["Authorization"] == "Bearer AT"
    assert cap["json"] == {"snippet": {"playlistId": "PL123", "resourceId": {
        "kind": "youtube#video", "videoId": "VID1"}}}


def test_add_to_playlist_raises_on_non_2xx(monkeypatch):
    c = _client(monkeypatch, 403, {}, {})
    with pytest.raises(yc.YouTubeApiError, match="playlistItems.insert 403"):
        c.add_to_playlist("VID1", "PL123")


def test_post_comment_posts_commentThreads_insert(monkeypatch):
    cap = {}
    c = _client(monkeypatch, 200, {"id": "CT9"}, cap)
    assert c.post_comment("VID1", "hello") == "CT9"
    assert cap["url"].endswith("/youtube/v3/commentThreads")
    assert cap["json"] == {"snippet": {"videoId": "VID1", "topLevelComment": {
        "snippet": {"textOriginal": "hello"}}}}


def test_post_comment_raises_on_non_2xx(monkeypatch):
    c = _client(monkeypatch, 400, {}, {})
    with pytest.raises(yc.YouTubeApiError, match="commentThreads.insert 400"):
        c.post_comment("VID1", "hello")


# ---------------------------------------------------------------------------
# 1. tracked footer link + guarded backfill
# ---------------------------------------------------------------------------

def test_new_descriptions_carry_the_tracked_link_only():
    for desc in (dds._compose_description("Live Trading Session"),
                 dds.compose_description_with_chapters("Sunday Scans",
                                                       [{"t": 0, "title": "Open"}])):
        assert "https://whop.com/c/uncharted/yt-desk" in desc
        assert "whop.com/uncharted/uncharted" not in desc


def test_rewrite_swaps_only_the_legacy_link():
    old = ("Sunday Scans — full session replay.\n\n⏱️ Chapters:\n0:00 Start\n\n"
           "🔗 Join Uncharted Territory: https://whop.com/uncharted/uncharted\n"
           "🌐 Website: https://uctintelligence.com\n")
    new = bf.rewrite_footer_link(old)
    assert new == old.replace("https://whop.com/uncharted/uncharted",
                              "https://whop.com/c/uncharted/yt-desk")
    assert bf.rewrite_footer_link(new) is None              # idempotent
    assert bf.rewrite_footer_link("") is None
    assert bf.rewrite_footer_link(None) is None
    # a longer URL that merely starts with the legacy one is not touched
    assert bf.rewrite_footer_link("x https://whop.com/uncharted/uncharted-pro y") is None


class _BackfillYT:
    def __init__(self, descs, fail=()):
        self.descs, self.fail, self.updates = dict(descs), set(fail), []

    def get_video_snippet(self, vid):
        if vid in self.fail:
            raise yc.YouTubeApiError("videos.list 404")
        return {"title": "t", "description": self.descs[vid]}

    def update_description(self, vid, desc):
        self.updates.append((vid, desc))


_VIDS = [{"youtube_id": "A", "title": "a"}, {"youtube_id": "B", "title": "b"},
         {"youtube_id": "C", "title": "c"}]
_DESCS = {"A": "join https://whop.com/uncharted/uncharted now",
          "B": "already https://whop.com/c/uncharted/yt-desk",
          "C": "join https://whop.com/uncharted/uncharted"}


def test_backfill_is_a_dry_run_by_default(monkeypatch):
    monkeypatch.setenv("DESK_SESSION_DESCRIPTION_CHAPTERS", "1")
    yt = _BackfillYT(_DESCS)
    out = bf.run(youtube=yt, videos=_VIDS, sleep_secs=0)
    assert out["mode"] == "dry-run"
    assert yt.updates == []                                  # nothing written
    assert (out["checked"], out["would_update"], out["unchanged"]) == (3, 2, 1)


def test_backfill_apply_writes_through_update_description(monkeypatch):
    monkeypatch.setenv("DESK_SESSION_DESCRIPTION_CHAPTERS", "1")
    yt = _BackfillYT(_DESCS)
    out = bf.run(apply=True, youtube=yt, videos=_VIDS, sleep_secs=0)
    assert out["updated"] == 2 and out["unchanged"] == 1
    assert yt.updates == [("A", "join https://whop.com/c/uncharted/yt-desk now"),
                          ("C", "join https://whop.com/c/uncharted/yt-desk")]


def test_backfill_apply_refuses_without_the_videos_update_flag(monkeypatch):
    monkeypatch.delenv("DESK_SESSION_DESCRIPTION_CHAPTERS", raising=False)
    yt = _BackfillYT(_DESCS)
    out = bf.run(apply=True, youtube=yt, videos=_VIDS, sleep_secs=0)
    assert "refused" in out and yt.updates == []


def test_backfill_one_bad_video_never_stops_the_sweep(monkeypatch):
    monkeypatch.setenv("DESK_SESSION_DESCRIPTION_CHAPTERS", "1")
    yt = _BackfillYT(_DESCS, fail={"A"})
    out = bf.run(apply=True, youtube=yt, videos=_VIDS, sleep_secs=0)
    assert out["errors"] == 1 and out["updated"] == 1
    assert [u[0] for u in yt.updates] == ["C"]


def test_backfill_cli_defaults_to_dry_run(monkeypatch, capsys):
    seen = {}
    monkeypatch.setattr(bf, "run", lambda **kw: seen.update(kw) or {"mode": "dry-run"})
    assert bf.main([]) == 0
    assert seen["apply"] is False


def test_backfill_candidates_are_show_videos_with_a_youtube_id(edu_db):
    edu.register_category_if_missing("Live Trading Sessions", kind="show")
    edu.create_video({"youtube_id": "Y1", "title": "x", "category": "Live Trading Sessions"})
    edu.create_video({"youtube_id": "", "title": "no id", "category": "Live Trading Sessions"})
    edu.create_video({"youtube_id": "Y3", "title": "lib", "category": "Some Library Shelf"})
    assert [v["youtube_id"] for v in bf.candidate_videos()] == ["Y1"]


# ---------------------------------------------------------------------------
# 2. title + thumbnail validation
# ---------------------------------------------------------------------------

def test_live_traidng_folds_to_the_canonical_show():
    assert dds._route_checked("LIVE TRAIDNG") == (
        "Live Trading Sessions", "Live Trading Session", "LIVE TRADING SESSION", None)


def test_close_typo_of_a_known_show_folds():
    assert dds._route_checked("Sunday Scnas")[:3] == ("Sunday Scans", "Sunday Scans", "SUNDAY SCANS")
    assert dds._route_checked("Live Tradng Sesion")[0] == "Live Trading Sessions"


def test_allowlisted_show_passes_in_its_canonical_spelling():
    assert dds._route_checked("sharpen your  trading skills")[:2] == (
        "Sharpen Your Trading Skills", "Sharpen Your Trading Skills")


def test_unrecognised_misspelled_name_falls_back_to_a_generic_title():
    sec, prefix, eyebrow, problem = dds._route_checked("Tradnig Plann Sesh")
    assert (sec, prefix, eyebrow) == dds._DEFAULT_ROUTE
    assert problem and "Tradnig" in problem


def test_tickers_in_caps_are_allowed():
    sec, prefix, _e, problem = dds._route_checked("NVDA AMD Earnings Special")
    assert problem is None and prefix == "NVDA AMD Earnings Special"


def test_long_all_caps_typo_is_not_a_ticker():
    assert guard.misspelled("TRAIDNG Session") == ["TRAIDNG"]


def test_host_aware_typo_keeps_the_shelf_and_drops_the_text():
    sec, prefix, eyebrow, problem = dds._route_checked("Workshop wiht Zen")
    assert (sec, prefix, eyebrow) == ("Workshops & Fireside Chats",
                                      "Workshops & Fireside Chats",
                                      "WORKSHOPS & FIRESIDE CHATS")
    assert problem and "wiht" in problem


def test_host_aware_guest_name_is_not_spell_checked():
    assert dds._route_checked("Workshop with Somebodyneu")[3] is None


def test_env_extends_words_and_shows(monkeypatch):
    assert dds._route_checked("Quantumflux Hour")[3] is not None
    monkeypatch.setenv("DESK_TITLE_EXTRA_WORDS", "quantumflux")
    assert dds._route_checked("Quantumflux Hour")[:2] == ("Quantumflux Hour", "Quantumflux Hour")
    monkeypatch.delenv("DESK_TITLE_EXTRA_WORDS")
    monkeypatch.setenv("DESK_KNOWN_SHOWS", "Zzyzx Roundtable")
    assert dds._route_checked("zzyzx roundtable")[:2] == ("Zzyzx Roundtable", "Zzyzx Roundtable")


def test_em_dash_in_a_hand_typed_name_never_reaches_the_title():
    sec, prefix, eyebrow, _p = dds._route_checked("Sector Rotation — Briefing")
    assert "—" not in prefix and "—" not in eyebrow and "–" not in prefix


def test_route_stays_a_pure_three_tuple():
    assert dds._route("LIVE TRAIDNG") == dds._route_checked("LIVE TRAIDNG")[:3]


def test_guard_falls_back_to_spellcheck_if_the_wisdom_fold_is_unimportable(monkeypatch):
    import builtins
    real = builtins.__import__

    def no_tools(name, *a, **kw):
        if name.startswith("tools.wisdom"):
            raise ImportError("not packaged")
        return real(name, *a, **kw)
    monkeypatch.setattr(builtins, "__import__", no_tools)
    # the close-match fold still catches it without the alias table
    assert dds._route_checked("LIVE TRAIDNG")[0] == "Live Trading Sessions"


def test_fallback_publishes_generic_title_and_alerts_ops_once(edu_db, jobs_db, _quiet):
    yt = _YT()
    _publish(jobs_db, yt, topic="Tradnig Plann Sesh")
    assert yt.uploads[0]["title"] == "Live Trading Session: October 5, 2026"
    assert "Tradnig" not in yt.uploads[0]["title"]
    guard_alerts = [e for e in _quiet if e.get("title", "").startswith("Desk title guard")]
    assert len(guard_alerts) == 1
    assert "Tradnig Plann Sesh" in guard_alerts[0]["description"]
    assert "Live Trading Session: October 5, 2026" in guard_alerts[0]["description"]
    v = edu.list_videos()[0]
    assert v["title"] == "Live Trading Session: October 5, 2026"
    assert v["category"] == "Live Trading Sessions"


def test_a_clean_name_raises_no_guard_alert(edu_db, jobs_db, _quiet):
    _publish(jobs_db, _YT(), topic="live trading today")
    assert not [e for e in _quiet if e.get("title", "").startswith("Desk title guard")]


def test_new_titles_use_a_colon_not_an_em_dash(edu_db, jobs_db):
    yt = _YT()
    _publish(jobs_db, yt, topic="Sunday Scans")
    assert yt.uploads[0]["title"] == "Sunday Scans: October 5, 2026"
    assert "—" not in yt.uploads[0]["title"]


# ---------------------------------------------------------------------------
# 3. playlists by series
# ---------------------------------------------------------------------------

def test_playlist_map_reads_json_and_normalizes_keys(monkeypatch):
    monkeypatch.setenv("DESK_YT_PLAYLISTS", json.dumps(
        {"Live Trading  Sessions": "PL_LTS", "sunday scans": "PL_SS", "x": ""}))
    assert dds.playlist_for_section("live trading sessions") == "PL_LTS"
    assert dds.playlist_for_section("Sunday Scans") == "PL_SS"
    assert dds.playlist_for_section("x") is None
    assert dds.playlist_for_section("Evening Update") is None


@pytest.mark.parametrize("raw", ["", "   ", "{not json", "[1,2]"])
def test_playlist_map_unset_or_malformed_is_empty(monkeypatch, raw):
    monkeypatch.setenv("DESK_YT_PLAYLISTS", raw)
    assert dds._playlist_map() == {}


def test_upload_adds_to_the_mapped_series_playlist(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_YT_PLAYLISTS", json.dumps({"Sunday Scans": "PL_SS"}))
    yt = _YT()
    _publish(jobs_db, yt, topic="Sunday Scans")
    assert yt.playlist_adds == [("VIDX", "PL_SS")]


def test_no_mapping_skips_silently(edu_db, jobs_db):
    yt = _YT()
    done = _publish(jobs_db, yt)
    assert yt.playlist_adds == [] and done and done[0]["youtube_id"] == "VIDX"


def test_playlist_failure_never_fails_the_job(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_YT_PLAYLISTS", json.dumps({"Live Trading Sessions": "PL"}))
    yt = _YT(fail={"playlist"})
    done = _publish(jobs_db, yt)
    assert done and done[0]["youtube_id"] == "VIDX"
    assert edu.get_video_by_youtube_id("VIDX") is not None
    # ⛔ The UPLOADING attempt carried on to the thumbnail. A raise would have sent the
    # job to mark_error, and the immediate re-claim (youtube_id already stored) would
    # still publish, so "the job finished" alone cannot tell fail-soft from fail-loud.
    assert yt.thumbs == ["VIDX"]


def test_a_client_without_the_method_is_fail_soft_too(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_YT_PLAYLISTS", json.dumps({"Live Trading Sessions": "PL"}))
    monkeypatch.setenv("DESK_YT_FIRST_COMMENT", "1")

    class _Old:
        def upload(self, *a, **kw): return "VIDX"
        def set_thumbnail(self, *a): pass
    done = _publish(jobs_db, _Old())
    assert done and done[0]["youtube_id"] == "VIDX"


# ---------------------------------------------------------------------------
# 4. first comment
# ---------------------------------------------------------------------------

def test_first_comment_is_off_by_default(edu_db, jobs_db):
    yt = _YT()
    _publish(jobs_db, yt)
    assert yt.comments == []


def test_first_comment_posts_the_exact_text_when_enabled(edu_db, jobs_db, monkeypatch):
    monkeypatch.setenv("DESK_YT_FIRST_COMMENT", "1")
    yt = _YT()
    _publish(jobs_db, yt)
    assert yt.comments == [("VIDX", "Join the live trading room: "
                            "https://whop.com/c/uncharted/yt-desk  "
                            "Education only, not financial advice.")]
    assert "—" not in dds.FIRST_COMMENT_TEXT


def test_comment_failure_never_fails_the_job(edu_db, jobs_db, monkeypatch, _quiet):
    monkeypatch.setenv("DESK_YT_FIRST_COMMENT", "1")
    yt = _YT(fail={"comment"})
    done = _publish(jobs_db, yt)
    assert done and done[0]["youtube_id"] == "VIDX"
    assert yt.thumbs == ["VIDX"]          # the uploading attempt carried on
    published = [e for e in _quiet if str(e.get("title", "")).startswith("🎬")]
    assert published and "pin" not in published[0]["description"].lower()


def test_publish_notice_asks_to_pin_when_the_comment_landed(edu_db, jobs_db, monkeypatch, _quiet):
    monkeypatch.setenv("DESK_YT_FIRST_COMMENT", "1")
    _publish(jobs_db, _YT())
    published = [e for e in _quiet if str(e.get("title", "")).startswith("🎬")]
    assert len(published) == 1
    desc = published[0]["description"]
    assert "pin it" in desc and "studio.youtube.com/video/VIDX" in desc
    assert "—" not in desc.split("\n")[-1]


def test_publish_notice_has_no_pin_line_when_comment_is_off(edu_db, jobs_db, _quiet):
    _publish(jobs_db, _YT())
    published = [e for e in _quiet if str(e.get("title", "")).startswith("🎬")]
    assert published and "pin" not in published[0]["description"].lower()


def test_extras_run_only_on_the_uploading_attempt(edu_db, jobs_db, monkeypatch):
    # A re-claimed job that already has a youtube_id skips upload AND the extras:
    # no duplicate playlist item, no duplicate comment.
    monkeypatch.setenv("DESK_YT_PLAYLISTS", json.dumps({"Live Trading Sessions": "PL"}))
    monkeypatch.setenv("DESK_YT_FIRST_COMMENT", "1")
    monkeypatch.setattr(q, "_STALE_SECS", -1)   # the row is always reclaimable
    jobs_db.enqueue("U9", "Live Trading Session", "2026-10-05T13:30:00Z", "http://dl", "tok")
    jobs_db.claim_next(); jobs_db.mark_uploaded("U9", "VIDPRE")
    yt = _YT()
    dds.process_pending_jobs(zoom=_FakeZoom(), youtube=yt)
    assert yt.uploads == [] and yt.playlist_adds == [] and yt.comments == []
