"""Archive calls -> Desk session moments ("watch the explanation at m:ss"), 2026-10-17.

SYNTHETIC data only — the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. LOOKAHEAD: a link to a session dated before the call, an after-close call linked to a same-day
   moment before the post (or to a same-day moment with no clock), a link past the NEXT session;
2. the wrong moment: another ticker, a repeat that is not the one closest to the post;
3. the deep link not being https://www.youtube.com/watch?v=ID&t=SECONDS;
4. the gate off still writing the table, opening it, or changing a prompt, citation or payload;
5. a non-paid caller reaching a link (402), or a link written back to education.db;
6. the refresh hooks (insights pass, calls batch) not firing, or failing the thing they ride on.
"""
from __future__ import annotations

import datetime as dt
import json
import random

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import ask_setup, call_moments as cm, service
from api.services.wisdom.archive import askai as archive_askai
from api.services.wisdom.core import store
from tests.authclients import FREE_MEMBER, PAID_MEMBER, authorize

SECRET = "s3cret-call-moments-test"
AUTH = {"Authorization": f"Bearer {SECRET}"}
UTC = dt.timezone.utc


def _session(vid, day, moments, *, start=None, yid=None):
    """A Session on `day` ('YYYY-MM-DD'); `start` 'HH:MM' UTC wall clock of t=0, or None."""
    d = dt.date.fromisoformat(day)
    started = dt.datetime.combine(d, dt.time.fromisoformat(start), UTC) if start else None
    return cm.Session(vid, yid or f"VID{vid:08d}", d, started, tuple(sorted((t, tk) for t, tk in moments)))


def _call(cid, ticker, posted):
    return {"call_id": cid, "ticker": ticker, "posted": posted}


# 2026-06-01 is a Monday. 13:30Z = 09:30 ET = 08:30 CT (EDT).
MON, TUE, WED = "2026-06-01", "2026-06-02", "2026-06-03"


# ── 1. the rule ──────────────────────────────────────────────────────────────

def test_a_same_day_timed_call_links_to_the_repeat_closest_to_the_post():
    s = _session(1, MON, [(600, "ZZTA"), (4500, "ZZTA"), (7000, "ZZTB")], start="13:30")
    # posted 09:40 CT = 14:40Z; t=4500 -> 14:45Z (5 min away) beats t=600 (13:40Z, an hour before)
    [lk] = cm.match([_call("t1#0", "zzta", "2026-06-01 09:40")], [s])
    assert (lk.t, lk.relation, lk.confidence, lk.ticker) == (4500, cm.SAME_DAY, 0.95, "ZZTA")
    assert cm.label(lk.confidence) == "high"


def test_proximity_sets_the_confidence_and_no_clock_is_lower():
    s = _session(1, MON, [(600, "ZZTA")], start="13:30")          # 13:40Z = 08:40 CT
    assert cm.match([_call("a#0", "ZZTA", "2026-06-01 09:30")], [s])[0].confidence == 0.85   # 50 min
    assert cm.match([_call("b#0", "ZZTA", "2026-06-01 13:30")], [s])[0].confidence == 0.75   # ~5 h
    no_clock = _session(2, MON, [(600, "ZZTA")])
    assert cm.match([_call("c#0", "ZZTA", "2026-06-01 13:30")], [no_clock])[0].confidence == 0.7
    assert cm.match([_call("d#0", "ZZTA", MON)], [no_clock])[0].confidence == 0.6           # date only


def test_another_ticker_or_another_day_is_never_linked():
    s = _session(1, MON, [(600, "ZZTB")], start="13:30")
    assert cm.match([_call("t1#0", "ZZTA", "2026-06-01 09:40")], [s]) == []
    tue = _session(2, TUE, [(600, "ZZTA")], start="13:30")
    # Monday HAD a session (it just never named ZZTA): an intraday call stays on its own day
    assert cm.match([_call("t2#0", "ZZTA", "2026-06-01 09:40")], [s, tue]) == []


def test_an_after_close_call_links_to_the_next_session_never_back_to_the_morning():
    morning = _session(1, MON, [(600, "ZZTA")], start="13:30")
    nxt = _session(2, TUE, [(900, "ZZTA")], start="13:30")
    links = cm.match([_call("t1#0", "ZZTA", "2026-06-01 15:30")], [morning, nxt])   # 16:30 ET
    assert [(lk.video_id, lk.relation, lk.confidence) for lk in links] == [(2, cm.NEXT_SESSION, 0.6)]


def test_an_after_close_call_links_a_same_day_evening_show_only_after_the_post():
    evening = _session(3, MON, [(60, "ZZTA"), (1800, "ZZTA")], start="22:00")    # 18:00 ET = 17:00 CT
    links = cm.match([_call("t1#0", "ZZTA", "2026-06-01 17:20")], [evening])     # 22:20Z
    assert [(lk.t, lk.relation) for lk in links] == [(1800, cm.SAME_DAY_AFTER_CLOSE)]   # t=60 is 22:01Z
    no_clock = _session(4, MON, [(1800, "ZZTA")])
    assert cm.match([_call("t2#0", "ZZTA", "2026-06-01 17:20")], [no_clock]) == []    # unprovable


def test_a_post_on_a_day_without_a_session_links_to_the_next_one_within_the_bound():
    mon = _session(1, MON, [(900, "ZZTA")], start="13:30")
    sat = "2026-05-30"
    [lk] = cm.match([_call("t1#0", "ZZTA", sat)], [mon])
    assert (lk.relation, lk.session_date, lk.confidence) == (cm.NEXT_SESSION, MON, 0.5)
    far = _session(2, "2026-06-10", [(900, "ZZTA")], start="13:30")
    assert cm.match([_call("t2#0", "ZZTA", "2026-06-04 16:00")], [far]) == []      # 6 days > bound


def test_only_the_NEXT_session_never_the_one_after():
    tue = _session(1, TUE, [(900, "ZZTB")], start="13:30")       # the next session, other ticker
    wed = _session(2, WED, [(900, "ZZTA")], start="13:30")
    assert cm.match([_call("t1#0", "ZZTA", "2026-06-01 15:30")], [tue, wed]) == []


def test_links_are_capped_and_ordered_best_first():
    sessions = [_session(i, MON, [(600 + i, "ZZTA")], start="13:30") for i in range(1, 6)]
    links = cm.match([_call("t1#0", "ZZTA", "2026-06-01 08:45")], sessions)
    assert len(links) == cm.MAX_LINKS_PER_CALL
    assert [lk.confidence for lk in links] == sorted((lk.confidence for lk in links), reverse=True)


def test_NO_LOOKAHEAD_over_random_calendars():
    rng = random.Random(20261017)
    tickers = ["ZZTA", "ZZTB", "ZZTC"]
    base = dt.date(2026, 6, 1)
    for _ in range(60):
        sessions = []
        for vid in range(1, rng.randint(2, 12)):
            day = base + dt.timedelta(days=rng.randint(0, 20))
            start = None if rng.random() < 0.3 else f"{rng.choice([13, 14, 21, 22]):02d}:{rng.choice(['00', '30'])}"
            sessions.append(_session(vid, day.isoformat(),
                                     [(rng.randint(0, 9000), rng.choice(tickers)) for _ in range(rng.randint(1, 6))],
                                     start=start))
        dates = sorted({s.session_date for s in sessions})
        calls = []
        for i in range(40):
            day = base + dt.timedelta(days=rng.randint(-2, 22))
            posted = day.isoformat() if rng.random() < 0.3 else \
                f"{day.isoformat()} {rng.randint(0, 23):02d}:{rng.choice(['00', '15', '45'])}"
            calls.append(_call(f"t{i}#0", rng.choice(tickers), posted))
        by_id = {c["call_id"]: c for c in calls}
        by_vid = {s.video_id: s for s in sessions}
        for lk in cm.match(calls, sessions):
            when, pday = cm.parse_posted(by_id[lk.call_id]["posted"])
            sday = dt.date.fromisoformat(lk.session_date)
            assert sday >= pday, "a link may never point at a session before the call"
            s = by_vid[lk.video_id]
            assert (lk.t, lk.ticker) in s.moments
            if lk.relation == cm.NEXT_SESSION:
                assert sday == next(d for d in dates if d > pday), "only the NEXT session"
                assert (sday - pday).days <= cm.NEXT_SESSION_MAX_DAYS
            else:
                assert sday == pday
            if lk.relation != cm.SAME_DAY and when is not None and s.started_at is not None:
                assert s.started_at + dt.timedelta(seconds=lk.t) >= when, "a later link must follow the post"
            if lk.relation == cm.SAME_DAY_AFTER_CLOSE:
                assert cm.after_close(when) and s.started_at is not None


def test_the_rule_itself_can_fail_control():
    """Control: the property above is not vacuous - a matcher that ignores the close DOES link an
    after-close call back to the morning, and the property's own predicate catches it."""
    morning = _session(1, MON, [(600, "ZZTA")], start="13:30")
    when, day = cm.parse_posted("2026-06-01 15:30")
    assert cm.after_close(when)
    assert morning.started_at + dt.timedelta(seconds=600) < when      # what a wrong link would point at
    assert cm.candidate_dates(when, day, [morning.session_date]) == [(morning.session_date,
                                                                     cm.SAME_DAY_AFTER_CLOSE)]
    assert cm.match([_call("t1#0", "ZZTA", "2026-06-01 15:30")], [morning]) == []


# ── 2. parsing and display ───────────────────────────────────────────────────

def test_posted_is_read_as_central_time():
    when, day = cm.parse_posted("2026-06-01 15:30")
    assert when.astimezone(cm.EASTERN).time() == dt.time(16, 30) and day == dt.date(2026, 6, 1)
    assert cm.parse_posted("2026-06-01T09:40:00")[0].tzinfo is not None
    assert cm.parse_posted("2026-06-01") == (None, dt.date(2026, 6, 1))
    assert cm.parse_posted("") == (None, None) and cm.parse_posted("garbage!!") == (None, None)


def test_the_deep_link_and_the_clock_text():
    assert cm.watch_url("abcDEF12345", 4500) == "https://www.youtube.com/watch?v=abcDEF12345&t=4500"
    assert (cm.at(5), cm.at(75), cm.at(4500)) == ("0:05", "1:15", "1:15:00")


def test_a_session_is_dated_by_its_clock_in_eastern_then_its_title():
    late = cm.session_from_video({"id": 1, "youtube_id": "Y1", "title": "Evening Update — June 1, 2026",
                                  "media_started_at": "2026-06-02T01:30:00Z",     # 21:30 ET June 1
                                  "ticker_moments": json.dumps([{"t": 30, "ticker": "$zzta"}])})
    assert late.session_date == dt.date(2026, 6, 1) and late.moments == ((30, "ZZTA"),)
    titled = cm.session_from_video({"id": 2, "youtube_id": "Y2", "title": "Live Trading Session — June 3, 2026",
                                    "created_at": 0, "ticker_moments": [{"t": "12", "ticker": "zztb"}]})
    assert titled.session_date == dt.date(2026, 6, 3) and titled.started_at is None
    assert cm.session_from_video({"id": 3, "youtube_id": "Y3", "title": "x", "ticker_moments": "[]"}) is None
    assert cm.session_from_video({"id": 4, "youtube_id": "", "title": TITLE_MON,
                                  "ticker_moments": [{"t": 1, "ticker": "ZZTA"}]}) is None


TITLE_MON = "Live Trading Session — June 1, 2026"


# ── 3. storage, gating, surfaces ─────────────────────────────────────────────

VIDEOS = [
    {"id": 501, "youtube_id": "VIDZZTA0001", "title": TITLE_MON, "category": "Live Trading Sessions",
     "created_at": 0, "media_started_at": "2026-06-01T13:30:00Z",
     "ticker_moments": json.dumps([{"t": 600, "ticker": "ZZTB"}, {"t": 4500, "ticker": "ZZTA"}])},
]


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def sessions(monkeypatch):
    """education.db is never opened: the matcher's one read is stubbed, and any WRITE to it fails."""
    from api.services import education_service

    monkeypatch.setattr(education_service, "session_moment_rows", lambda: [dict(v) for v in VIDEOS])

    def _no_write(*a, **k):
        raise AssertionError("call moments must never write education.db")
    monkeypatch.setattr(education_service, "set_video_insights", _no_write)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("WISDOM_ARCHIVE_ASK_ENABLED", "1")
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


_STATS = {"n": 40, "n_scored": 40, "win20": 0.55, "med_r20": 0.01, "mean_r20": 0.02, "med_edge20": 0.01,
          "mean_simR": 0.4, "mean_edgeR": 0.3, "edgeR_z": 1.0, "thin": False}


def _seed():
    setups = [{"setup_id": "launch_pad", "name": "Launch Pad", "family": "breakout base", "aliases": [],
               "used_by": ["tsdr"], "stats": _STATS, "stats_trades": _STATS, "context": {}, "teachings": [],
               "winners": [{"call_id": "t9310#0", "record_id": "t9310", "ticker": "ZZTA", "author_id": "tsdr",
                            "posted": "2026-06-01 09:40", "direction": "long", "action": "entry",
                            "evidence": "synthetic", "r20": 0.12, "sim_R": 1.0, "regime": "uptrend"}],
               "failures": []}]
    records = [{"record_id": "t9310", "author_id": "tsdr", "stated_date": MON, "record_type": "CALL",
                "tickers": ["ZZTA"], "note": "synthetic launch pad call on the ticker", "quote": "",
                "image_count": 0},
               {"record_id": "t9311", "author_id": "tsdr", "stated_date": "2026-05-01", "record_type": "CALL",
                "tickers": ["ZZTC"], "note": "synthetic call with no session", "quote": "", "image_count": 0}]
    calls = [{"call_id": "t9310#0", "record_id": "t9310", "author_id": "tsdr", "ticker": "ZZTA",
              "direction": "long", "setup": "launch_pad", "posted": "2026-06-01 09:40", "entry": 12.34,
              "stop": 11.11, "outcome": {"r20": 0.12, "status": "scored"}},
             {"call_id": "t9311#0", "record_id": "t9311", "author_id": "tsdr", "ticker": "ZZTC",
              "direction": "long", "setup": "launch_pad", "posted": "2026-05-01 09:40",
              "outcome": {"r20": 0.02, "status": "scored"}}]
    with store.write() as conn:
        for kind, items in (("setups", setups), ("records", records), ("calls", calls)):
            assert service.upsert_batch(conn, kind, items)["rejected"] == 0


URL = "https://www.youtube.com/watch?v=VIDZZTA0001&t=4500"


def test_refresh_stores_full_and_partial_and_lookup_reads_best_first(wisdom_db, on, sessions):
    _seed()
    out = cm.refresh_all()
    assert (out["links"], out["calls_linked"], out["full"]) == (1, 1, True)
    with store.read() as conn:
        found = cm.lookup(conn, ["t9310#0", "t9311#0"])
    [w] = found["t9310#0"]
    assert "t9311#0" not in found
    assert (w["url"], w["at"], w["label"], w["relation"], w["confidence_label"]) == (
        URL, "1:15:00", "watch at 1:15:00", cm.SAME_DAY, "high")
    with store.write() as conn:
        conn.execute(f"DELETE FROM {cm.TABLE}")
    assert cm.refresh_calls(["t9310#0"])["links"] == 1          # partial rebuild
    assert cm.refresh_calls([]) is None


def test_gate_off_writes_nothing_and_opens_nothing(wisdom_db, sessions, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "0")
    opened = []
    real_write, real_read = store.write, store.read
    monkeypatch.setattr(store, "write", lambda *a, **k: opened.append("w") or real_write(*a, **k))
    monkeypatch.setattr(store, "read", lambda *a, **k: opened.append("r") or real_read(*a, **k))
    assert cm.refresh_all() is None and cm.refresh_calls(["t9310#0"]) is None
    payload = {"calls": [{"call_id": "t9310#0"}]}
    assert cm.attach(payload) == {"calls": [{"call_id": "t9310#0"}]}
    assert opened == []
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "1")       # control: on, the probes see the store
    cm.refresh_all()
    assert "w" in opened


def test_lookup_before_the_migration_is_empty_not_an_error(tmp_path):
    import sqlite3

    conn = sqlite3.connect(str(tmp_path / "bare.db"))
    assert cm.lookup(conn, ["t1#0"]) == {} and cm.lookup_by_record(conn, ["t1"]) == {}


def test_ask_setup_block_carries_the_link_and_off_is_byte_identical(wisdom_db, on, sessions, monkeypatch):
    _seed()
    today = dt.date(2026, 6, 10)
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "0")
    before = ask_setup.setup_block("how does the team trade launch pads?", today=today)
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "1")
    cm.refresh_all()
    text, cites = ask_setup.setup_block("how does the team trade launch pads?", today=today)
    assert f"watch 1:15:00 {URL}" in text and cm.WATCH_NOTE.strip() in text
    [ex] = [c for c in cites if c.get("call_id") == "t9310#0"]
    assert ex["watch"][0]["url"] == URL
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "0")       # table populated, gate off
    assert ask_setup.setup_block("how does the team trade launch pads?", today=today) == before
    assert "watch" not in before[0] and all("watch" not in c for c in before[1])


def test_trader_archive_block_carries_the_link_and_off_is_byte_identical(wisdom_db, on, sessions, monkeypatch):
    _seed()
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "0")
    before = archive_askai.archive_block("what did they say about ZZTA", query_tickers=["ZZTA"])
    assert before[0] and "watch" not in before[0]
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "1")
    cm.refresh_all()
    text, cites = archive_askai.archive_block("what did they say about ZZTA", query_tickers=["ZZTA"])
    assert f"ZZTA long launch_pad r20 +12.0% watch 1:15:00 {URL}" in text
    [cite] = [c for c in cites if c.get("record_id") == "t9310"]
    assert cite["watch"][0]["url"] == URL and cite["watch"][0]["ticker"] == "ZZTA"
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "0")
    assert archive_askai.archive_block("what did they say about ZZTA", query_tickers=["ZZTA"]) == before


def _client(user):
    app = FastAPI()
    app.include_router(wisdom_archive.member_router)
    app.include_router(wisdom_archive.internal_router)
    if user is not None:
        authorize(app, user)
    return TestClient(app, raise_server_exceptions=False)


def test_member_routes_carry_the_link_for_paid_only(wisdom_db, on, sessions, monkeypatch):
    _seed()
    cm.refresh_all()
    paid = _client(PAID_MEMBER)
    calls = paid.get("/api/wisdom/archive/ticker/ZZTA").json()["calls"]
    assert calls[0]["watch"][0]["url"] == URL
    best = paid.get("/api/wisdom/archive/setup/launch_pad").json()["best"]
    assert [c["watch"][0]["at"] for c in best if c["call_id"] == "t9310#0"] == ["1:15:00"]
    assert _client(FREE_MEMBER).get("/api/wisdom/archive/ticker/ZZTA").status_code == 402
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "0")
    assert "watch" not in paid.get("/api/wisdom/archive/ticker/ZZTA").json()["calls"][0]


def test_a_calls_batch_refreshes_its_links_and_the_route_rebuilds_all(wisdom_db, on, sessions, monkeypatch):
    c = _client(None)
    _seed()
    call = {"call_id": "t9320#0", "record_id": "t9320", "author_id": "tsdr", "ticker": "ZZTB",
            "direction": "long", "posted": "2026-06-01 08:35", "outcome": {"r20": 0.01}}
    res = c.post("/api/internal/wisdom/archive/batch", json={"kind": "calls", "items": [call]}, headers=AUTH)
    assert res.status_code == 200 and res.json()["call_moments"]["links"] == 1
    with store.read() as conn:
        assert cm.lookup(conn, ["t9320#0"])["t9320#0"][0]["t"] == 600
    assert c.post("/api/internal/wisdom/archive/call-moments/refresh").status_code in (401, 403)
    full = c.post("/api/internal/wisdom/archive/call-moments/refresh", headers=AUTH).json()
    assert full["links"] == 2 and full["full"] is True
    monkeypatch.setenv("WISDOM_CALL_MOMENTS_ENABLED", "0")
    res = c.post("/api/internal/wisdom/archive/batch", json={"kind": "calls", "items": [call]}, headers=AUTH)
    assert "call_moments" not in res.json()
    assert c.post("/api/internal/wisdom/archive/call-moments/refresh", headers=AUTH).status_code == 404


def test_a_failed_refresh_never_fails_the_batch(wisdom_db, on, sessions, monkeypatch):
    def boom(_ids):
        raise RuntimeError("synthetic refresh failure")
    monkeypatch.setattr(cm, "refresh_calls", boom)
    call = {"call_id": "t9321#0", "record_id": "t9321", "author_id": "tsdr", "ticker": "ZZTA", "posted": MON}
    res = _client(None).post("/api/internal/wisdom/archive/batch", json={"kind": "calls", "items": [call]},
                             headers=AUTH)
    assert res.status_code == 200 and res.json()["inserted"] == 1
    assert "synthetic refresh failure" in res.json()["call_moments"]["error"]


def test_the_insights_pass_refreshes_only_when_it_wrote_moments_and_never_raises(monkeypatch):
    from api.services import desk_session_insights as dsi

    assert cm.refresh_after_insights in dsi._MOMENTS_CHANGED       # registered by importing the archive side
    calls = []
    monkeypatch.setattr(cm, "refresh_all", lambda: calls.append(1) or {"links": 3, "calls_linked": 2, "sessions": 1})
    dsi._refresh_call_moments([{"id": 1, "action": "waiting_transcript"}], [])
    assert calls == []
    dsi._refresh_call_moments([{"id": 1, "action": "generated"}], [])
    dsi._refresh_call_moments([{"id": 2, "action": "ticker_backfill"}], [])
    assert calls == [1, 1]

    def boom():
        raise RuntimeError("synthetic")
    monkeypatch.setattr(cm, "refresh_all", boom)
    errors: list = []
    dsi._refresh_call_moments([{"id": 1, "action": "generated"}], errors)
    assert errors and "refresh_after_insights" in errors[0]["error"]


def test_the_pass_runs_the_hook_end_to_end_and_registration_is_idempotent(monkeypatch):
    """The pass itself calls the hook (not only the helper), and re-importing cannot double it."""
    from api.services import desk_session_insights as dsi

    cm._register()
    assert dsi._MOMENTS_CHANGED.count(cm.refresh_after_insights) == 1
    seen = []
    monkeypatch.setattr(dsi, "is_enabled", lambda: True)
    monkeypatch.setattr(dsi.education_service, "videos_pending_insights", lambda *_: [])
    monkeypatch.setattr(dsi, "_run_ticker_backfill", lambda results, errors: results.append(
        {"id": 9, "action": "ticker_backfill", "tickers": 1}))
    monkeypatch.setattr(dsi, "_run_repolish_backfill", lambda results, errors: None)
    monkeypatch.setattr(cm, "refresh_all", lambda: seen.append(1) or None)
    out = dsi.process_pending_session_insights()
    assert seen == [1] and [r["action"] for r in out] == ["ticker_backfill"]


def test_session_moment_rows_reads_only_videos_with_moments_and_no_transcript(tmp_path, monkeypatch):
    from api.services import education_service as es

    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    a = es.create_video({"youtube_id": "VIDZZTA0001", "title": TITLE_MON, "category": "Live Trading Sessions"})
    es.create_video({"youtube_id": "VIDZZTA0002", "title": "no moments"})
    es.set_video_insights(a["id"], transcript="synthetic transcript", ticker_moments=[{"t": 5, "ticker": "ZZTA"}])
    rows = es.session_moment_rows()
    assert [r["youtube_id"] for r in rows] == ["VIDZZTA0001"]
    assert "transcript" not in rows[0] and json.loads(rows[0]["ticker_moments"]) == [{"t": 5, "ticker": "ZZTA"}]
    [s] = cm.sessions_from_videos(rows)
    assert s.session_date == dt.date(2026, 6, 1)
