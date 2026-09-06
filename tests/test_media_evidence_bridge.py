import os
import tempfile
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import media_evidence_bridge as router_mod
from api.services import auth_db, desk_session_jobs as jobs, education_service as edu
from api.services import media_evidence_bridge as bridge

SECRET = "internal-shh"


@pytest.fixture
def env(monkeypatch):
    """Isolated education.db + desk_session_jobs.db, real (session-isolated)
    auth.db schema, PUSH_SECRET set. auth.db's own path/isolation is already
    handled by the repo-root + tests/conftest.py machinery — this fixture only
    ensures its schema exists (init_db is idempotent) and adds the two
    module-local stores this bridge also touches."""
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    auth_db.init_db()
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(jobs, "_DB_PATH", os.path.join(d, "jobs.db"))
        jobs._init_db()
        monkeypatch.setattr(edu, "_DB_PATH", os.path.join(d, "edu.db"))
        edu._init_db()
        yield


@pytest.fixture
def client(env):
    app = FastAPI()
    app.include_router(router_mod.router)
    return TestClient(app)


def _make_user(email: str) -> str:
    conn = auth_db.get_connection()
    try:
        uid = f"u-{email}"
        now = int(time.time())
        conn.execute(
            "INSERT OR IGNORE INTO users (id, email, password_hash, display_name, "
            "role, email_verified, created_at) VALUES (?, ?, 'x', 'Test', 'user', 1, ?)",
            (uid, email.lower().strip(), now),
        )
        conn.commit()
        return uid
    finally:
        conn.close()


def _make_video(meeting_uuid: str | None = None) -> int:
    v = edu.create_video({"youtube_id": "yt123", "title": "Live Trading Today"})
    if meeting_uuid:
        edu.set_meeting_uuid(v["id"], meeting_uuid)
    return v["id"]


# ── get_session_time ─────────────────────────────────────────────────────────

def test_session_time_video_not_found(env):
    out = bridge.get_session_time(999999)
    assert out == {"ok": False, "error": "video not found"}


def test_session_time_video_with_no_meeting_uuid_is_unknown(env):
    vid = _make_video(meeting_uuid=None)
    out = bridge.get_session_time(vid)
    assert out["ok"] is True
    assert out["meeting_uuid"] is None
    assert out["confidence"] == "unknown"
    assert out["start_time_utc"] is None


def test_session_time_meeting_uuid_with_no_job_row_is_unknown(env):
    vid = _make_video(meeting_uuid="uuid-orphan")
    out = bridge.get_session_time(vid)
    assert out["meeting_uuid"] == "uuid-orphan"
    assert out["confidence"] == "unknown"
    assert out["start_time_raw"] is None


def test_session_time_malformed_start_time_is_unknown_not_now(env):
    jobs.enqueue("uuid-bad", "Live Trading", "not-a-real-timestamp", "http://dl", "tok")
    vid = _make_video(meeting_uuid="uuid-bad")
    out = bridge.get_session_time(vid)
    assert out["confidence"] == "unknown"
    assert out["start_time_raw"] == "not-a-real-timestamp"
    assert out["start_time_utc"] is None
    assert out["start_time_et"] is None


def test_session_time_authoritative_chain(env):
    jobs.enqueue("uuid-good", "Live Trading", "2026-06-24T13:30:00Z", "http://dl", "tok")
    vid = _make_video(meeting_uuid="uuid-good")
    out = bridge.get_session_time(vid)
    assert out["confidence"] == "authoritative"
    assert out["provenance"] == "zoom_webhook"
    assert out["start_time_utc"] == "2026-06-24T13:30:00+00:00"
    # 13:30 UTC in June (EDT, UTC-4) is 09:30 ET — the real session open.
    assert out["start_time_et"].startswith("2026-06-24T09:30:00")


def test_session_time_naive_start_time_assumed_utc(env):
    # Zoom's real payloads are always Z-suffixed, but the parser must not
    # silently misinterpret a naive string as local time either.
    jobs.enqueue("uuid-naive", "Live Trading", "2026-06-24T13:30:00", "http://dl", "tok")
    vid = _make_video(meeting_uuid="uuid-naive")
    out = bridge.get_session_time(vid)
    assert out["confidence"] == "authoritative"
    assert out["start_time_utc"] == "2026-06-24T13:30:00+00:00"


# ── Phase 4D-4C.3: durable provenance takes priority over the job table ─────

def test_session_time_prefers_durable_recording_file_over_job_table(env):
    """Even with a LIVE job row present, the durable BEST-tier value wins —
    consumers should not care whether the job row still exists."""
    jobs.enqueue("uuid-both", "Live Trading", "2026-06-24T13:05:00Z", "http://dl", "tok")
    vid = _make_video(meeting_uuid="uuid-both")
    edu.set_media_provenance(vid, "2026-06-24T13:00:07Z", "zoom_recording_file", "file-xyz")
    out = bridge.get_session_time(vid)
    assert out["provenance"] == "zoom_recording_file"
    assert out["source_recording_file_id"] == "file-xyz"
    assert out["start_time_utc"] == "2026-06-24T13:00:07+00:00"  # NOT the job row's 13:05:00
    assert out["confidence"] == "authoritative"


def test_session_time_durable_survives_a_pruned_job_row(env):
    """No job row at all (pruned) — the durable value alone is enough. This is
    the exact scenario this phase exists to fix."""
    vid = _make_video(meeting_uuid="uuid-pruned")
    edu.set_media_provenance(vid, "2026-06-24T13:00:00Z", "recovered_job_metadata")
    out = bridge.get_session_time(vid)
    assert out["confidence"] == "authoritative"
    assert out["provenance"] == "recovered_job_metadata"
    assert out["start_time_utc"] == "2026-06-24T13:00:00+00:00"


def test_session_time_falls_back_to_job_table_when_no_durable_value_yet(env):
    """A video processed before this phase (or before insights ran) has no
    durable field — the pre-existing job-table path must still work byte-
    identically (this is exactly the existing authoritative-chain test)."""
    jobs.enqueue("uuid-old", "Live Trading", "2026-06-24T13:30:00Z", "http://dl", "tok")
    vid = _make_video(meeting_uuid="uuid-old")
    out = bridge.get_session_time(vid)
    assert out["provenance"] == "zoom_webhook"
    assert out["confidence"] == "authoritative"


def test_session_time_corrupt_durable_value_falls_back_to_job_table(env):
    """An unparseable durable value (shouldn't happen, but never trust
    storage blindly) falls through to a real job-table row rather than
    reporting unknown when a genuine answer is still reachable."""
    jobs.enqueue("uuid-corrupt", "Live Trading", "2026-06-24T13:30:00Z", "http://dl", "tok")
    vid = _make_video(meeting_uuid="uuid-corrupt")
    edu.set_media_provenance(vid, "not-a-real-timestamp", "zoom_recording_file", "file-bad")
    out = bridge.get_session_time(vid)
    assert out["provenance"] == "zoom_webhook"
    assert out["confidence"] == "authoritative"
    assert out["start_time_utc"] == "2026-06-24T13:30:00+00:00"


# ── get_trade_linkage ────────────────────────────────────────────────────────

def _seed_trades(user_id: str) -> dict[str, str]:
    """Rows are keyed off `user_id` (unique per test — the fixture's underlying
    auth.db is session-scoped, not per-test) so parallel tests never collide on
    a shared row id. Returns the trade_refs this seed produces."""
    t1, t2, pos1 = f"t1-{user_id}", f"t2-{user_id}", f"pos1-{user_id}"
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
            " entry_price, entry_date, exit_price, exit_date, original_stop,"
            " pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at,"
            " source, external_id) VALUES"
            " (?, ?, 'p1', 'NVDA', 'Long', 10, 100, '2026-06-24', 110,"
            "  '2026-06-25', 95, 100, 10, 1, 'Win', '{}', '2026-06-24', NULL, NULL),"
            " (?, ?, 'p2', 'TSLA', 'Long', 5, 200, '2026-05-01', 210,"
            "  '2026-05-02', 195, 50, 5, 1, 'Win', '{}', '2026-05-01', 'broker', ?)",
            (t1, user_id, t2, user_id, f"bk:{user_id}"),
        )
        conn.execute(
            "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares,"
            " original_shares, entry_price, stop_price, context_at_entry, created_at,"
            " updated_at) VALUES"
            " (?, ?, 'AMD', 'Long', '2026-06-24', 20, 20, 150, 140, '{}',"
            "  '2026-06-24', '2026-06-24')",
            (pos1, user_id),
        )
        conn.commit()
    finally:
        conn.close()
    return {"t1": f"id:{t1}", "t2": f"ext:bk:{user_id}", "pos1": f"id:{pos1}"}


def test_trade_linkage_unknown_user(env):
    out = bridge.get_trade_linkage("nobody@example.com")
    assert out == {"ok": False, "error": "user not found"}


def test_trade_linkage_returns_stable_trade_ref(env):
    uid = _make_user("owner@example.com")
    seeded = _seed_trades(uid)
    out = bridge.get_trade_linkage("owner@example.com")
    assert out["ok"] is True
    refs = {r["trade_ref"]: r for r in out["trades"]}
    assert refs[seeded["t1"]]["symbol"] == "NVDA"
    assert refs[seeded["t2"]]["symbol"] == "TSLA"
    assert refs[seeded["pos1"]]["kind"] == "position"


def test_trade_linkage_symbol_filter(env):
    uid = _make_user("owner2@example.com")
    _seed_trades(uid)
    out = bridge.get_trade_linkage("owner2@example.com", symbol="nvda")
    symbols = {r["symbol"] for r in out["trades"]}
    assert symbols == {"NVDA"}


def test_trade_linkage_date_range_filter(env):
    uid = _make_user("owner3@example.com")
    seeded = _seed_trades(uid)
    out = bridge.get_trade_linkage("owner3@example.com", date_from="2026-06-01", date_to="2026-06-30")
    refs = {r["trade_ref"] for r in out["trades"]}
    assert refs == {seeded["t1"], seeded["pos1"]}  # TSLA (May) filtered out by range


def test_trade_linkage_never_fabricates_time_of_day(env):
    """entry_date/exit_date come through byte-identical to storage — no
    synthesized HH:MM:SS. This is the evidence uct-clips' linkage-confidence
    classifier depends on to refuse a DETERMINISTIC verdict on date-only data."""
    uid = _make_user("owner4@example.com")
    _seed_trades(uid)
    out = bridge.get_trade_linkage("owner4@example.com", symbol="NVDA")
    row = out["trades"][0]
    assert row["entry_date"] == "2026-06-24"
    assert row["exit_date"] == "2026-06-25"
    assert len(row["entry_date"]) == len("2026-06-24")  # no time component appended


def test_trade_linkage_scoped_to_user(env):
    uid1 = _make_user("a@example.com")
    _make_user("b@example.com")
    _seed_trades(uid1)
    out = bridge.get_trade_linkage("b@example.com")
    assert out["trades"] == []


# ── Router: PUSH_SECRET gating ───────────────────────────────────────────────

def test_session_time_route_requires_auth(client):
    r = client.get("/api/internal/media-evidence/session-time/1")
    assert r.status_code == 401


def test_session_time_route_rejects_wrong_secret(client):
    r = client.get(
        "/api/internal/media-evidence/session-time/1",
        headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 401


def test_session_time_route_accepts_correct_secret(client):
    r = client.get(
        "/api/internal/media-evidence/session-time/999999",
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": False, "error": "video not found"}


def test_trades_route_requires_auth(client):
    r = client.get("/api/internal/media-evidence/trades", params={"email": "x@example.com"})
    assert r.status_code == 401


def test_trades_route_accepts_correct_secret(client):
    r = client.get(
        "/api/internal/media-evidence/trades",
        params={"email": "nobody@example.com"},
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": False, "error": "user not found"}
