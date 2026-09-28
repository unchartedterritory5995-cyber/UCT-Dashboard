"""TERM-089 (item 15 ACC-10) -- a replay surface for the Morning Wire archive.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
1. ANOTHER DAY'S WIRE FOR THE DAY ASKED. A date the archive does not hold is
   answered `held: false` with NO html -- never the nearest issue, never today's.
   A replay that fills a gap with a neighbour is a forged record of what the
   firm said on a morning it may not have spoken at all.
2. A GAP THAT READS AS "NO ISSUE THAT DAY". The index publishes its own
   coverage -- dates held against the weekdays in its range, and the weekdays
   it does NOT hold, by name -- derived from the files, never typed.
3. A READ OUTSIDE THE ARCHIVE. The date is the only input and it must be a real
   `YYYY-MM-DD`; anything else is refused before a path is built, so a
   traversal toward a sibling directory (the owner's internal review notes live
   beside the snapshots on the PC) can never be served.
4. A PUSH THAT DOES NOT ARCHIVE. The pod's archive is written by `/api/push`
   itself -- the payload members were served IS the record -- and the backfill
   door never overwrites what a push recorded, and never touches the live cache.

The PAID gate is owned by `tests/test_paywall_gate_free_tier.py` (`PAID_NOW`),
which drives an anonymous, a free and a paid caller at the real `api.main:app`.
This file measures behaviour, so every read here is made by a paid member.
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import engine_data, push
from api.services import wire_archive
from tests.authclients import PAID_MEMBER, authorize

SECRET = "term-089-test-secret"


@pytest.fixture
def archive(tmp_path, monkeypatch):
    d = tmp_path / "wire_archive"
    monkeypatch.setenv("WIRE_ARCHIVE_DIR", str(d))
    return d


@pytest.fixture
def client(archive):
    app = FastAPI()
    app.include_router(engine_data.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app)


def _wire(date: str, html: str | None = None, **extra) -> dict:
    return {"date": date, "rundown_html": html or f"<p>wire of {date}</p>", **extra}


# ── 1. a held date renders; a missing one is an honest absence ───────────────

def test_a_HELD_date_returns_that_days_rundown(client, archive):
    wire_archive.record(_wire("2026-09-22"))
    r = client.get("/api/wire/archive/2026-09-22")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["held"] is True
    assert body["date"] == "2026-09-22"
    assert body["html"] == "<p>wire of 2026-09-22</p>"


def test_a_MISSING_date_is_NO_WIRE_never_a_neighbours(client, archive):
    """⛔ The neighbours on BOTH sides are held, so a nearest-date fallback in
    either direction has something to return -- and must not."""
    wire_archive.record(_wire("2026-09-21"))
    wire_archive.record(_wire("2026-09-23"))
    r = client.get("/api/wire/archive/2026-09-22")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"date": "2026-09-22", "held": False, "html": None}


def test_an_EMPTY_archive_answers_absence_not_an_error(client, archive):
    assert not archive.exists()
    r = client.get("/api/wire/archive/2026-09-22")
    assert r.status_code == 200
    assert r.json()["held"] is False


def test_the_service_read_returns_None_for_a_missing_date_between_held_ones(archive):
    wire_archive.record(_wire("2026-09-21"))
    wire_archive.record(_wire("2026-09-23"))
    assert wire_archive.read("2026-09-22") is None
    assert wire_archive.read("2026-09-21")["date"] == "2026-09-21"


# ── 2. the index publishes its coverage, derived ─────────────────────────────

def test_the_index_publishes_HELD_against_WEEKDAYS_in_range_and_names_the_gaps(client, archive):
    # Mon 09-21, Wed 09-23, Mon 09-28: Tue 09-22, Thu 09-24, Fri 09-25 missing;
    # the weekend 09-26/27 is not a gap.
    for d in ("2026-09-21", "2026-09-23", "2026-09-28"):
        wire_archive.record(_wire(d))
    r = client.get("/api/wire/archive")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dates"] == ["2026-09-28", "2026-09-23", "2026-09-21"]   # newest first
    cov = body["coverage"]
    assert cov["held"] == 3
    assert cov["first"] == "2026-09-21"
    assert cov["last"] == "2026-09-28"
    assert cov["weekdays_in_range"] == 6
    assert cov["missing_weekdays"] == ["2026-09-22", "2026-09-24", "2026-09-25"]
    assert cov["denominator"] == "weekdays"          # holiday-naive, and says so


def test_the_index_of_an_empty_archive_is_zero_of_zero(client, archive):
    body = client.get("/api/wire/archive").json()
    assert body["dates"] == []
    assert body["coverage"]["held"] == 0
    assert body["coverage"]["weekdays_in_range"] == 0
    assert body["coverage"]["first"] is None


# ── 3. nothing outside the archive is readable ───────────────────────────────

@pytest.mark.parametrize("bad", [
    "2026-9-22", "20260922", "2026-02-30", "latest", "..%2Freviews%2Fnote",
    "2026-09-22.json",
])
def test_a_date_that_is_not_a_real_YYYY_MM_DD_is_REFUSED(client, archive, bad):
    wire_archive.record(_wire("2026-09-22"))
    r = client.get(f"/api/wire/archive/{bad}")
    assert r.status_code in (404, 422), (bad, r.status_code, r.text)
    assert "wire of" not in r.text


def test_a_sibling_REVIEWS_file_is_never_served_and_never_indexed(client, archive):
    """The PC keeps the owner's internal review notes beside the snapshots. The
    archive serves `wire_<date>.json` from its own directory and nothing else."""
    wire_archive.record(_wire("2026-09-22"))
    reviews = archive.parent / "reviews"
    reviews.mkdir()
    (reviews / "wire_2026-09-23.json").write_text(
        json.dumps(_wire("2026-09-23", "<p>INTERNAL REVIEW</p>")), encoding="utf-8")
    (archive / "review_2026-09-24.json").write_text(
        json.dumps(_wire("2026-09-24", "<p>INTERNAL REVIEW</p>")), encoding="utf-8")
    (archive / "wire_notadate.json").write_text("{}", encoding="utf-8")

    assert client.get("/api/wire/archive").json()["dates"] == ["2026-09-22"]
    for d in ("2026-09-23", "2026-09-24"):
        body = client.get(f"/api/wire/archive/{d}").json()
        assert body["held"] is False and body["html"] is None
    with pytest.raises(ValueError):
        wire_archive.path_for("../reviews/wire_2026-09-23")


def test_a_file_whose_OWN_date_disagrees_with_its_name_is_not_served(client, archive):
    """A mis-filed entry is not the wire of the day its name claims."""
    archive.mkdir(parents=True)
    (archive / "wire_2026-09-22.json").write_text(
        json.dumps({"date": "2026-09-21", "rundown_html": "<p>wire of 2026-09-21</p>"}),
        encoding="utf-8")
    body = client.get("/api/wire/archive/2026-09-22").json()
    assert body["held"] is False and body["html"] is None


# ── 4. the push writes the archive; the backfill never overwrites ────────────

@pytest.fixture
def push_client(archive, monkeypatch, tmp_path):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setattr(push, "PERSISTENT_WIRE_DATA_FILE", str(tmp_path / "wire_data.json"))
    # The push's other side effects are not this file's business, and one of
    # them (the read-aloud pre-warm) would spend.
    import api.services.voice_prewarm as vp
    import api.services.theme_performance as tp
    import api.services.uct20_nav as nav
    monkeypatch.setattr(vp, "prewarm_rundown_async", lambda *_a, **_k: None)
    monkeypatch.setattr(tp, "trigger_recompute", lambda *_a, **_k: None)
    monkeypatch.setattr(nav, "record_composition", lambda *_a, **_k: None)
    app = FastAPI()
    app.include_router(push.router)
    return TestClient(app)


AUTH = {"Authorization": f"Bearer {SECRET}"}


def test_a_PUSH_records_the_days_wire_in_the_archive(push_client, archive):
    r = push_client.post("/api/push", json=_wire("2026-09-25", leadership=[]), headers=AUTH)
    assert r.status_code == 200, r.text
    rec = wire_archive.read("2026-09-25")
    assert rec is not None and rec["rundown_html"] == "<p>wire of 2026-09-25</p>"


def test_a_second_PUSH_the_same_day_replaces_that_days_entry(push_client, archive):
    push_client.post("/api/push", json=_wire("2026-09-25", "<p>first run</p>"), headers=AUTH)
    push_client.post("/api/push", json=_wire("2026-09-25", "<p>re-run</p>"), headers=AUTH)
    assert wire_archive.read("2026-09-25")["rundown_html"] == "<p>re-run</p>"


def test_a_PUSH_with_no_usable_date_still_succeeds_and_archives_nothing(push_client, archive):
    r = push_client.post("/api/push", json={"rundown_html": "<p>x</p>"}, headers=AUTH)
    assert r.status_code == 200
    assert wire_archive.index()["dates"] == []


def test_the_BACKFILL_door_refuses_without_the_push_secret(push_client, archive):
    r = push_client.post("/api/push/archive", json=_wire("2026-09-01"))
    assert r.status_code == 401
    assert wire_archive.read("2026-09-01") is None


def test_the_BACKFILL_stores_a_past_wire_and_never_touches_the_live_cache(push_client, archive):
    from api.services.cache import cache
    cache.set("wire_data", {"date": "LIVE"}, ttl=60)
    try:
        r = push_client.post("/api/push/archive", json=_wire("2026-09-01"), headers=AUTH)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "date": "2026-09-01", "stored": True}
        assert wire_archive.read("2026-09-01")["rundown_html"] == "<p>wire of 2026-09-01</p>"
        assert cache.get("wire_data") == {"date": "LIVE"}
    finally:
        cache.invalidate("wire_data")


def test_the_BACKFILL_never_overwrites_what_a_PUSH_recorded(push_client, archive):
    push_client.post("/api/push", json=_wire("2026-09-25", "<p>as served</p>"), headers=AUTH)
    r = push_client.post("/api/push/archive", json=_wire("2026-09-25", "<p>pc copy</p>"),
                         headers=AUTH)
    assert r.status_code == 200
    assert r.json()["stored"] is False
    assert wire_archive.read("2026-09-25")["rundown_html"] == "<p>as served</p>"


def test_the_BACKFILL_refuses_a_payload_with_no_real_date(push_client, archive):
    r = push_client.post("/api/push/archive", json=_wire("../reviews/x"), headers=AUTH)
    assert r.status_code == 422
    assert wire_archive.index()["dates"] == []
    assert not (archive.parent / "reviews").exists()

