"""Desk Videos polish (2026-10-14): measured lengths, recorded lengths, the
repolish backfill for sessions stuck with Zoom's raw prose, and same-name show
routing. No network, no LLM: repolish_video is stubbed and the DB is a temp file."""
import json
import os
import tempfile

import pytest

from api.services import desk_daily_session as dds
from api.services import desk_session_insights as si
from api.services import education_service as edu


@pytest.fixture
def db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(edu, "_DB_PATH", os.path.join(d, "education.db"))
        edu._init_db()
        yield edu


def _vid(db, yt, *, category="Live Trading Sessions", duration="", title="Session"):
    return db.create_video({"youtube_id": yt, "title": title, "category": category,
                            "duration": duration, "sort_order": 0})


def _all_videos(payload):
    return {v["youtube_id"]: v for c in payload["categories"] for v in c["videos"]}


# ── format_duration / measured_durations ────────────────────────────────────

def test_format_duration_matches_the_stored_text_form():
    assert edu.format_duration(59) == "0:59"
    assert edu.format_duration(754) == "12:34"
    assert edu.format_duration(3725) == "1:02:05"


def test_payload_fills_a_missing_length_from_the_longest_measured_play(db):
    _vid(db, "aaaaaaaaaaa")
    db.upsert_progress("u1", "aaaaaaaaaaa", 100, duration=6903)
    db.upsert_progress("u2", "aaaaaaaaaaa", 50, duration=6900)
    assert _all_videos(db.grouped_videos_payload())["aaaaaaaaaaa"]["duration"] == "1:55:03"


def test_a_stored_length_always_wins_and_nothing_is_written_back(db):
    v = _vid(db, "bbbbbbbbbbb", duration="10:00")
    db.upsert_progress("u1", "bbbbbbbbbbb", 1, duration=9999)
    assert _all_videos(db.grouped_videos_payload())["bbbbbbbbbbb"]["duration"] == "10:00"
    c = _vid(db, "ccccccccccc")
    db.upsert_progress("u1", "ccccccccccc", 1, duration=1200)
    db.grouped_videos_payload()
    assert (db.get_video(c["id"])["duration"] or "") == ""      # read-time fill only
    assert db.get_video(v["id"])["duration"] == "10:00"


def test_a_sub_minute_measurement_is_not_a_length(db):
    _vid(db, "ddddddddddd")
    db.upsert_progress("u1", "ddddddddddd", 1, duration=12)
    assert not _all_videos(db.grouped_videos_payload())["ddddddddddd"]["duration"]


# ── _record_media_duration (insights pass) ──────────────────────────────────

def _rec(start, end):
    return {"recording_files": [{"file_type": "MP4", "file_size": 10, "download_url": "https://z/x",
                                 "recording_start": start, "recording_end": end}]}


def test_insights_pass_records_the_recording_length_once(db):
    v = _vid(db, "eeeeeeeeeee")
    pending = {"id": v["id"], "duration": None}   # the pending query never selects it
    si._record_media_duration(pending, _rec("2026-10-14T13:30:00Z", "2026-10-14T15:25:03Z"))
    assert db.get_video(v["id"])["duration"] == "1:55:03"


def test_insights_pass_never_overwrites_a_stored_length(db):
    v = _vid(db, "fffffffffff", duration="3:00:00")
    si._record_media_duration({"id": v["id"], "duration": None},
                              _rec("2026-10-14T13:30:00Z", "2026-10-14T13:40:00Z"))
    assert db.get_video(v["id"])["duration"] == "3:00:00"


def test_insights_pass_falls_back_to_zooms_minutes_and_survives_garbage(db):
    v = _vid(db, "ggggggggggg")
    si._record_media_duration({"id": v["id"]}, {"recording_files": [], "duration": 95})
    assert db.get_video(v["id"])["duration"] == "1:35:00"
    si._record_media_duration({"id": 999999}, {"recording_files": "nonsense"})  # never raises


# ── looks_unpolished / repolish backfill ────────────────────────────────────

@pytest.mark.parametrize("h", [
    "The meeting focused on a review of current market conditions and setups.",
    "This was a trading discussion session where Patrick led a review.",
    "Patrick and Brac conducted a detailed market analysis session.",
    "Patrick conducted a trading review session focused on Sunday SCAN market analysis.",
    "x" * 201,
])
def test_raw_zoom_prose_is_recognised(h):
    assert si.looks_unpolished(h)


@pytest.mark.parametrize("h", [
    "Micron's explosive earnings ignite a semiconductor rally amid MAG7 weakness",
    "Semis show relative strength off the 50-day as QQQ gaps up 1%",
    "",
])
def test_polished_headlines_are_left_alone(h):
    assert not si.looks_unpolished(h)


OLD = 1_000_000 - 10 * 86400  # created well past the 3-day hand-off


@pytest.fixture
def ledger(monkeypatch, tmp_path):
    path = str(tmp_path / "desk_repolish_attempts.json")
    monkeypatch.setattr(si, "_repolish_ledger_path", lambda: path)
    monkeypatch.delenv("DESK_REPOLISH_BACKFILL", raising=False)
    monkeypatch.delenv("DESK_REPOLISH_MIN_AGE_SECS", raising=False)
    return path


def _raw(i, created=OLD):
    return {"id": i, "title": f"S{i}", "headline": "The meeting focused on things.", "created_at": created}


def test_repolish_backfill_is_bounded_per_pass_and_per_day(monkeypatch, ledger):
    rows = [_raw(i) for i in range(1, 6)]
    rows.append({"id": 99, "title": "ok", "headline": "Semis lead as QQQ reclaims the 50-day", "created_at": OLD})
    monkeypatch.setattr(edu, "session_videos_with_headlines", lambda: rows)
    called = []
    monkeypatch.setattr(si, "repolish_video", lambda vid: called.append(vid) or {"headline": "new"})
    res, errs = [], []
    si._run_repolish_backfill(res, errs, now=1_000_000)
    assert called == [1, 2]                               # two per pass, newest first
    si._run_repolish_backfill(res, errs, now=1_000_100)
    assert called == [1, 2, 3, 4]                         # next pass moves on
    si._run_repolish_backfill(res, errs, now=1_000_200)
    assert called == [1, 2, 3, 4, 5]
    si._run_repolish_backfill(res, errs, now=1_000_300)
    assert called == [1, 2, 3, 4, 5]                      # all on cooldown; 99 never touched
    si._run_repolish_backfill(res, errs, now=1_000_000 + 24 * 3600 + 1)
    assert called[-2:] == [1, 2]                          # retried after a day


def test_repolish_leaves_a_fresh_session_to_the_off_box_polish_script(monkeypatch, ledger):
    now = 1_000_000
    rows = [_raw(1, created=now - 2 * 86400), _raw(2, created=now - 4 * 86400)]
    monkeypatch.setattr(edu, "session_videos_with_headlines", lambda: rows)
    called = []
    monkeypatch.setattr(si, "repolish_video", lambda vid: called.append(vid) or {"headline": "new"})
    si._run_repolish_backfill([], [], now=now)
    assert called == [2]                                  # 2 days old waits, 4 days old is fixed


def test_repolish_runs_while_server_polish_is_off(monkeypatch, ledger):
    # Production runs DESK_RECAP_POLISH=0 (the PC script polishes); the safety
    # net must still cover what that script missed.
    monkeypatch.setenv("DESK_RECAP_POLISH", "0")
    monkeypatch.setattr(edu, "session_videos_with_headlines", lambda: [_raw(5)])
    called = []
    monkeypatch.setattr(si, "repolish_video", lambda vid: called.append(vid) or {"headline": "new"})
    si._run_repolish_backfill([], [], now=1_000_000)
    assert called == [5]


def test_repolish_attempts_survive_a_restart_and_stop_after_three(monkeypatch, ledger):
    monkeypatch.setattr(edu, "session_videos_with_headlines", lambda: [_raw(7)])
    calls = []

    def boom(vid):
        calls.append(vid)
        raise RuntimeError("thin recap")
    monkeypatch.setattr(si, "repolish_video", boom)
    day = 24 * 3600 + 1
    for k in range(6):                                    # six days of passes
        si._run_repolish_backfill([], [], now=1_000_000 + k * day)
        si._run_repolish_backfill([], [], now=1_000_000 + k * day + 900)  # a restart's fresh pass
    assert calls == [7, 7, 7]                             # once a day, three times ever
    assert json.loads(open(ledger, encoding="utf-8").read())["7"]["attempts"] == 3


def test_repolish_attempts_nothing_when_its_record_cannot_be_written(monkeypatch, ledger):
    from api.services import desk_cover_retry
    monkeypatch.setattr(edu, "session_videos_with_headlines", lambda: [_raw(8)])

    def cannot_write(_path, _data):
        raise OSError("read-only volume")
    monkeypatch.setattr(desk_cover_retry, "_write", cannot_write)
    monkeypatch.setattr(si, "repolish_video", lambda vid: pytest.fail("an unrecorded attempt is unbounded"))
    si._run_repolish_backfill([], [], now=1_000_000)


def test_repolish_failure_is_recorded_not_raised(monkeypatch, ledger):
    monkeypatch.setattr(edu, "session_videos_with_headlines",
                        lambda: [{"id": 7, "title": "S", "headline": "The meeting was long.", "created_at": OLD}])

    def boom(_vid):
        raise RuntimeError("llm down")
    monkeypatch.setattr(si, "repolish_video", boom)
    res, errs = [], []
    si._run_repolish_backfill(res, errs, now=1_000_000)
    assert errs and errs[0]["id"] == 7 and "llm down" in errs[0]["error"]


def test_repolish_backfill_kill_switch(monkeypatch, ledger):
    monkeypatch.setenv("DESK_REPOLISH_BACKFILL", "0")
    monkeypatch.setattr(edu, "session_videos_with_headlines", lambda: [_raw(9)])
    monkeypatch.setattr(si, "repolish_video", lambda vid: pytest.fail("must not run"))
    si._run_repolish_backfill([], [], now=1_000_000)


def test_session_videos_with_headlines_lists_only_enriched_sessions(db):
    a = _vid(db, "hhhhhhhhhhh")
    b = _vid(db, "iiiiiiiiiii")
    _vid(db, "jjjjjjjjjjj", category="Interviews")
    db.set_meeting_uuid(a["id"], "uuid-a")
    db.set_meeting_uuid(b["id"], "uuid-b")
    db.set_video_insights(a["id"], chapters=[{"t": 0, "title": "Open"}], headline="The meeting x")
    ids = [r["id"] for r in db.session_videos_with_headlines()]
    assert ids == [a["id"]]


# ── same-name show routing ──────────────────────────────────────────────────

def test_a_new_webinar_name_joins_an_existing_shelf_spelled_differently(db):
    _vid(db, "kkkkkkkkkkk", category="Sharpen Your Trading Skills")
    assert dds._route("Sharpen your trading skills")[0] == "Sharpen Your Trading Skills"
    assert dds._route("sharpen  your trading-skills")[0] == "Sharpen Your Trading Skills"


def test_a_genuinely_new_show_name_still_creates_its_own_shelf(db):
    _vid(db, "lllllllllll", category="Sharpen Your Trading Skills")
    assert dds._route("Options Office Hours")[0] == "Options Office Hours"
