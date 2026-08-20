"""desk_cover_backfill — retro-apply creative covers to the back catalog.

Contract: eligibility is REGISTRY-derived (edu_categories.kind == 'show'),
every render is fed the VIDEO'S OWN story (its stored headline + tickers +
date), never today's wire brief; the ledger makes the run idempotent and
resumable; one bad video never stops the sweep; today's videos belong to the
live pipeline, not the backfill.
"""
import contextlib
import json
import os
import tempfile
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import desk_cover_backfill as bf
from api.services import desk_creative
from api.services import education_service as edu

ET = ZoneInfo("America/New_York")
NOW = datetime(2026, 8, 20, 1, 0, tzinfo=ET)          # "today" = Aug 20
OLD_TS = int((NOW - timedelta(days=5)).timestamp())    # comfortably past


@pytest.fixture
def edu_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(edu, "_DB_PATH", os.path.join(d, "education.db"))
        edu._init_db()
        yield edu


@pytest.fixture
def ledger(tmp_path):
    return str(tmp_path / "backfill.json")


def _seed(edu_db, *, youtube_id="YT1", title="Evening Update — August 15, 2026",
          category="Evening Update", kind="show", created_at=OLD_TS,
          headline="MU breakout dissected", tickers=({"ticker": "MU"}, {"ticker": "DELL"})):
    edu_db.register_category_if_missing(category, kind=kind)
    row = edu_db.create_video({"youtube_id": youtube_id, "title": title,
                               "description": "", "category": category, "sort_order": 0})
    with contextlib.closing(edu._connect()) as c:
        c.execute("UPDATE edu_videos SET created_at=?, headline=?, ticker_moments=? WHERE id=?",
                  (created_at, headline, json.dumps(list(tickers)), row["id"]))
        c.commit()
    return row


class _YT:
    def __init__(self):
        self.calls = []
    def set_thumbnail(self, video_id, image_bytes):
        self.calls.append((video_id, image_bytes))


# ---------------------------------------------------------------------------
# eligibility — registry-derived, ledger-aware, never today's videos
# ---------------------------------------------------------------------------

def test_eligible_takes_show_videos_only(edu_db, ledger):
    _seed(edu_db, youtube_id="SHOW1")
    _seed(edu_db, youtube_id="LIB1", category="Trading Course", kind="library",
          title="Lesson 3 — Position Sizing")
    got = [v["youtube_id"] for v in bf.eligible_videos(now=NOW, ledger_path=ledger)]
    assert got == ["SHOW1"]


def test_eligible_skips_blank_ids_todays_and_unparseable(edu_db, ledger):
    _seed(edu_db, youtube_id="OK1")
    _seed(edu_db, youtube_id="", title="Evening Update — August 14, 2026")
    _seed(edu_db, youtube_id="TODAY1", created_at=int(NOW.timestamp()),
          title="Evening Update — August 20, 2026")
    _seed(edu_db, youtube_id="WEIRD1", title="no structural separator")
    got = [v["youtube_id"] for v in bf.eligible_videos(now=NOW, ledger_path=ledger)]
    assert got == ["OK1"]


def test_eligible_skips_videos_already_in_ledger(edu_db, ledger):
    _seed(edu_db, youtube_id="DONE1")
    _seed(edu_db, youtube_id="NEW1", title="Evening Update — August 14, 2026")
    bf._ledger_write(ledger, "DONE1", "done")
    got = [v["youtube_id"] for v in bf.eligible_videos(now=NOW, ledger_path=ledger)]
    assert got == ["NEW1"]


# ---------------------------------------------------------------------------
# backfill_one — the video's OWN story, never today's wire
# ---------------------------------------------------------------------------

def test_backfill_one_renders_from_the_videos_own_story(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    v = dict(_seed(edu_db))
    v.update(edu_db.get_video(v["id"]))
    def boom():
        raise AssertionError("backfill must never read today's wire brief")
    monkeypatch.setattr(desk_creative, "day_context", boom)
    seen = {}
    marker = b"BACKFILL" * 200
    def fake_render(**kw):
        seen.update(kw)
        return marker
    monkeypatch.setattr(desk_creative, "render_cover", fake_render)
    yt = _YT()
    assert bf.backfill_one(v, youtube=yt, ledger_path=ledger) == "done"
    assert yt.calls == [("YT1", marker)]
    assert seen["ctx"]["this_sessions_headline"] == "MU breakout dissected"
    assert seen["ctx"]["tickers_discussed_in_session"] == ["MU", "DELL"]
    assert seen["ctx"]["date"] == "August 15, 2026"
    assert seen["eyebrow"] == "EVENING UPDATE"
    assert json.loads(open(ledger, encoding="utf-8").read())["YT1"]["status"] == "done"


def test_backfill_one_none_render_records_and_skips_thumbnail(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    v = dict(_seed(edu_db)); v.update(edu_db.get_video(v["id"]))
    monkeypatch.setattr(desk_creative, "render_cover", lambda **kw: None)
    yt = _YT()
    assert bf.backfill_one(v, youtube=yt, ledger_path=ledger) == "no_render"
    assert yt.calls == []
    assert json.loads(open(ledger, encoding="utf-8").read())["YT1"]["status"] == "no_render"


def test_backfill_one_set_thumbnail_error_is_recorded_not_raised(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    v = dict(_seed(edu_db)); v.update(edu_db.get_video(v["id"]))
    monkeypatch.setattr(desk_creative, "render_cover", lambda **kw: b"X" * 2000)
    class _BoomYT:
        def set_thumbnail(self, *a):
            raise RuntimeError("quota")
    got = bf.backfill_one(v, youtube=_BoomYT(), ledger_path=ledger)
    assert got.startswith("error")
    assert json.loads(open(ledger, encoding="utf-8").read())["YT1"]["status"].startswith("error")


# ---------------------------------------------------------------------------
# run_backfill — resumable sweep, one bad video never stops it
# ---------------------------------------------------------------------------

def test_run_backfill_processes_all_and_survives_one_bad_video(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    _seed(edu_db, youtube_id="A1", title="Evening Update — August 13, 2026")
    _seed(edu_db, youtube_id="B1", title="Evening Update — August 14, 2026")
    _seed(edu_db, youtube_id="C1", title="Evening Update — August 15, 2026")
    calls = []
    def render(**kw):
        if kw["ctx"]["date"] == "August 14, 2026":
            raise RuntimeError("boom")      # swallowed by render_cover normally;
        calls.append(kw["ctx"]["date"])     # here it exercises backfill's guard
        return b"J" * 2000
    monkeypatch.setattr(desk_creative, "render_cover", render)
    yt = _YT()
    out = bf.run_backfill(youtube=yt, ledger_path=ledger, now=NOW, sleep_secs=0)
    assert out["done"] == 2 and out["errors"] == 1
    led = json.loads(open(ledger, encoding="utf-8").read())
    assert set(led) == {"A1", "B1", "C1"}
    # resume retries ONLY the transient error (done entries are terminal) —
    # and after the attempt cap, the sweep is genuinely finished.
    again = bf.run_backfill(youtube=yt, ledger_path=ledger, now=NOW, sleep_secs=0)
    assert again["eligible"] == 1 and again["errors"] == 1
    final = bf.run_backfill(youtube=yt, ledger_path=ledger, now=NOW, sleep_secs=0)
    assert final["eligible"] == 1 and final["errors"] == 1     # attempt 3
    assert bf.run_backfill(youtube=yt, ledger_path=ledger, now=NOW,
                           sleep_secs=0)["eligible"] == 0      # capped out


def test_run_backfill_respects_limit_and_flag(edu_db, ledger, monkeypatch):
    _seed(edu_db, youtube_id="A1")
    monkeypatch.delenv("DESK_CREATIVE_THUMBS", raising=False)
    out = bf.run_backfill(youtube=_YT(), ledger_path=ledger, now=NOW, sleep_secs=0)
    assert out.get("skipped") == "DESK_CREATIVE_THUMBS is off"
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    _seed(edu_db, youtube_id="B1", title="Evening Update — August 14, 2026")
    monkeypatch.setattr(desk_creative, "render_cover", lambda **kw: b"J" * 2000)
    out = bf.run_backfill(youtube=_YT(), ledger_path=ledger, now=NOW,
                          sleep_secs=0, limit=1)
    assert out["done"] == 1 and out["eligible"] == 2


# ---------------------------------------------------------------------------
# router — PUSH_SECRET-gated fire-and-return + status (mirrors sessions-status)
# ---------------------------------------------------------------------------

@pytest.fixture
def client(monkeypatch, edu_db):
    from api.routers import desk_zoom_webhook as wh
    monkeypatch.setenv("ZOOM_WEBHOOK_SECRET_TOKEN", "shh")
    monkeypatch.setenv("PUSH_SECRET", "ppp")
    app = FastAPI(); app.include_router(wh.router)
    return TestClient(app)


def test_backfill_endpoints_require_the_bearer(client):
    assert client.post("/api/desk/creative-cover-backfill").status_code == 401
    assert client.get("/api/desk/creative-cover-backfill").status_code == 401


def test_backfill_post_fires_background_and_get_reports(client, ledger, monkeypatch):
    monkeypatch.setenv("DESK_COVER_BACKFILL_LEDGER", ledger)
    started = {}
    monkeypatch.setattr(bf, "start_background", lambda **kw: started.update(kw) or True)
    r = client.post("/api/desk/creative-cover-backfill?limit=5",
                    headers={"Authorization": "Bearer ppp"})
    assert r.status_code == 200 and r.json()["started"] is True
    assert started["limit"] == 5
    bf._ledger_write(ledger, "YTX", "done")
    g = client.get("/api/desk/creative-cover-backfill",
                   headers={"Authorization": "Bearer ppp"})
    assert g.status_code == 200
    assert g.json()["counts"]["done"] == 1


# ---------------------------------------------------------------------------
# Review fixes (2026-08-20): tombstones retry, no paid contentless renders,
# separate history, atomic ledger, lean queries, honest gates
# ---------------------------------------------------------------------------

def test_transient_errors_are_retried_up_to_three_attempts(edu_db, ledger):
    _seed(edu_db, youtube_id="ERR1")
    bf._ledger_write(ledger, "ERR1", "error: quota")
    assert [v["youtube_id"] for v in bf.eligible_videos(now=NOW, ledger_path=ledger)] == ["ERR1"]
    bf._ledger_write(ledger, "ERR1", "error: quota")
    bf._ledger_write(ledger, "ERR1", "error: quota")
    assert bf.eligible_videos(now=NOW, ledger_path=ledger) == []   # 3 strikes


def test_empty_story_video_is_skipped_without_a_paid_render(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    v = dict(_seed(edu_db, headline=None, tickers=()))
    with contextlib.closing(edu._connect()) as c:
        c.execute("UPDATE edu_videos SET headline=NULL, ticker_moments=NULL WHERE id=?",
                  (v["id"],)); c.commit()
    v.update(edu_db.get_video(v["id"]))
    rendered = []
    monkeypatch.setattr(desk_creative, "render_cover",
                        lambda **kw: rendered.append(1) or b"X" * 2000)
    yt = _YT()
    assert bf.backfill_one(v, youtube=yt, ledger_path=ledger) == "no_story"
    assert rendered == [] and yt.calls == []
    assert json.loads(open(ledger, encoding="utf-8").read())["YT1"]["status"] == "no_story"


def test_backfill_uses_its_own_cover_history_not_the_live_one(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    v = dict(_seed(edu_db)); v.update(edu_db.get_video(v["id"]))
    seen = {}
    monkeypatch.setattr(desk_creative, "render_cover",
                        lambda **kw: seen.update(kw) or b"X" * 2000)
    bf.backfill_one(v, youtube=_YT(), ledger_path=ledger)
    assert seen["history_path"]                       # explicit, never the default
    assert "backfill" in os.path.basename(seen["history_path"])


def test_legacy_ticker_shapes_reach_the_ctx_normalized(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    v = dict(_seed(edu_db, tickers=("$tsla", {"symbol": "amd"}, {"ticker": "TSLA"})))
    v.update(edu_db.get_video(v["id"]))
    seen = {}
    monkeypatch.setattr(desk_creative, "render_cover",
                        lambda **kw: seen.update(kw) or b"X" * 2000)
    bf.backfill_one(v, youtube=_YT(), ledger_path=ledger)
    assert seen["ctx"]["tickers_discussed_in_session"] == ["TSLA", "AMD"]


def test_ledger_write_survives_missing_parent_dir(tmp_path):
    deep = str(tmp_path / "sub" / "dir" / "ledger.json")
    bf._ledger_write(deep, "YT1", "done")
    assert json.loads(open(deep, encoding="utf-8").read())["YT1"]["status"] == "done"


def test_limit_zero_is_a_dry_run_not_the_full_sweep(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    _seed(edu_db, youtube_id="A1")
    rendered = []
    monkeypatch.setattr(desk_creative, "render_cover",
                        lambda **kw: rendered.append(1) or b"X" * 2000)
    out = bf.run_backfill(youtube=_YT(), ledger_path=ledger, now=NOW,
                          sleep_secs=0, limit=0)
    assert out["eligible"] == 1 and out["done"] == 0 and rendered == []


def test_flipping_the_flag_off_stops_a_sweep_in_flight(edu_db, ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    _seed(edu_db, youtube_id="A1", title="Evening Update — August 13, 2026")
    _seed(edu_db, youtube_id="B1", title="Evening Update — August 14, 2026")
    def render(**kw):
        os.environ["DESK_CREATIVE_THUMBS"] = "0"      # operator kills it mid-run
        return b"X" * 2000
    monkeypatch.setattr(desk_creative, "render_cover", render)
    out = bf.run_backfill(youtube=_YT(), ledger_path=ledger, now=NOW, sleep_secs=0)
    assert out["done"] == 1 and out.get("stopped") == "flag turned off"


def test_status_reports_the_gate_and_endpoints_are_sync_defs(edu_db, ledger, monkeypatch):
    monkeypatch.delenv("DESK_CREATIVE_THUMBS", raising=False)
    monkeypatch.setenv("DESK_COVER_BACKFILL_LEDGER", ledger)
    s = bf.status()
    assert s["thumbs_enabled"] is False
    import asyncio
    from api.routers import desk_zoom_webhook as wh
    # sync handlers run on the threadpool — an async def would put the lean
    # (but real) DB scan on the single shared event loop (the 524 class).
    assert not asyncio.iscoroutinefunction(wh.creative_cover_backfill_start)
    assert not asyncio.iscoroutinefunction(wh.creative_cover_backfill_status)
