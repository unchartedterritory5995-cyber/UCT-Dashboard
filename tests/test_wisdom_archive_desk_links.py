"""Desk session ticker moments linked to the team's archive calls (ADMIN ONLY, 2026-10-16).

SYNTHETIC data only — the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the route answering a member (must be 403) or anyone with the flag off (404);
2. a moment linked to a call outside its window (the session day and the day before);
3. a price (entry/stop/target) leaking into the payload;
4. the link being WRITTEN back to the session — the stored ticker moments feed public outputs;
5. an undated session silently matched against some other day.
"""
from __future__ import annotations

import datetime as dt
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import desk_links
from api.services.wisdom.core import store
from tests.authclients import ADMIN, FREE_MEMBER, authorize

SECRET = "s3cret-desk-links-test"
BATCH = "/api/internal/wisdom/archive/batch"
AUTH = {"Authorization": f"Bearer {SECRET}"}
TITLE = "Live Trading Session — January 3, 2025"
MOMENTS = [{"t": 120, "ticker": "ZZTA"}, {"t": 900, "ticker": "zztb"}, {"t": 1500, "ticker": "ZZTC"}]


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


@pytest.fixture
def video(monkeypatch):
    row = {"id": 77, "title": TITLE, "created_at": 0, "ticker_moments": json.dumps(MOMENTS)}
    writes = []
    from api.services import education_service

    monkeypatch.setattr(education_service, "get_video", lambda vid: dict(row) if int(vid) == 77 else None)
    monkeypatch.setattr(education_service, "set_video_insights",
                        lambda *a, **k: writes.append((a, k)), raising=False)
    return writes


def _client(user):
    app = FastAPI()
    app.include_router(wisdom_archive.router)
    app.include_router(wisdom_archive.internal_router)
    if user is not None:
        authorize(app, user)
    return TestClient(app, raise_server_exceptions=False)


def _seed():
    c = _client(None)
    recs = [{"record_id": f"t91{i}", "author_id": "tsdr", "stated_date": d, "record_type": "CALL",
             "tickers": [t], "note": "synthetic note", "quote": "", "image_count": 0}
            for i, (t, d) in enumerate([("ZZTA", "2025-01-03"), ("ZZTB", "2025-01-02"), ("ZZTC", "2024-12-30")])]
    calls = [{"call_id": f"t91{i}#0", "record_id": f"t91{i}", "author_id": "tsdr", "ticker": t,
              "direction": "long", "setup": "synthetic_setup", "action": "entry", "posted": p,
              "entry": 10.0, "stop": 9.0, "target": 12.0, "conf": "high",
              "outcome": {"r5": 0.02, "r20": 0.10, "status": "scored"}}
             for i, (t, p) in enumerate([("ZZTA", "2025-01-03T09:40:00"),       # same day      -> linked
                                         ("ZZTB", "2025-01-02T20:00:00"),       # evening before -> linked
                                         ("ZZTC", "2024-12-30T10:00:00")])]     # 4 days before -> NOT linked
    assert c.post(BATCH, json={"kind": "records", "items": recs}, headers=AUTH).json()["inserted"] == 3
    assert c.post(BATCH, json={"kind": "calls", "items": calls}, headers=AUTH).json()["inserted"] == 3


PATH = "/api/admin/wisdom/archive/desk/77"


def test_a_member_is_refused_and_an_admin_is_served(wisdom_db, on, video):
    _seed()
    assert _client(FREE_MEMBER).get(PATH).status_code == 403
    r = _client(ADMIN).get(PATH)
    assert r.status_code == 200                                                  # control
    assert _client(ADMIN).get("/api/admin/wisdom/archive/desk/78").status_code == 404


@pytest.mark.parametrize("raw", ["0", "", "off"])
def test_flag_off_is_404_for_an_admin(wisdom_db, on, video, monkeypatch, raw):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", raw)
    assert _client(ADMIN).get(PATH).status_code == 404


def test_moments_link_only_to_calls_from_the_session_day_or_the_evening_before(wisdom_db, on, video):
    _seed()
    body = _client(ADMIN).get(PATH).json()
    assert body["session_date"] == "2025-01-03" and body["date_source"] == "title"
    by = {m["ticker"]: m for m in body["moments"]}
    assert set(by) == {"ZZTA", "ZZTB", "ZZTC"}                                   # lower-case moment normalised
    assert [c["call_id"] for c in by["ZZTA"]["calls"]] == ["t910#0"]
    assert [c["call_id"] for c in by["ZZTB"]["calls"]] == ["t911#0"]
    assert by["ZZTC"]["calls"] == []                                             # outside the window
    assert body["n_linked"] == 2
    assert by["ZZTA"]["calls"][0]["outcome"]["r20"] == 0.10


def test_no_price_rides_in_the_payload(wisdom_db, on, video):
    _seed()
    body = _client(ADMIN).get(PATH).json()
    calls = [c for m in body["moments"] for c in m["calls"]]
    assert calls                                                                 # non-vacuity
    for c in calls:
        assert not {"entry", "stop", "target"} & set(c), c
        assert not {"entry", "stop", "target"} & set(c["outcome"]), c


def test_nothing_is_written_back_to_the_session(wisdom_db, on, video):
    _seed()
    assert _client(ADMIN).get(PATH).status_code == 200
    assert video == []                                                           # no insights write


def test_an_undated_session_links_nothing_rather_than_guessing(wisdom_db, on):
    _seed()
    with store.read() as conn:
        out = desk_links.links(conn, {"id": 1, "title": "Uncharted Territory - Live",
                                      "ticker_moments": MOMENTS})
    assert out["session_date"] is None and out["date_source"] == "unknown"
    assert out["n_linked"] == 0 and all(m["calls"] == [] for m in out["moments"])


def test_the_upload_day_is_the_fallback_date_and_says_so():
    day, source = desk_links.session_date({"title": "Evening Update", "created_at":
                                           dt.datetime(2025, 1, 3, 23, tzinfo=dt.timezone.utc).timestamp()})
    assert (day, source) == (dt.date(2025, 1, 3), "created_at")


def test_desk_session_insights_does_not_import_the_archive():
    """The stored ticker moments feed public outputs; the insights writer must never reach the archive."""
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "desk_session_insights.py"
           ).read_text(encoding="utf-8")
    assert "wisdom.archive" not in src and "wisdom_archive" not in src
