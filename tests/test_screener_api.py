import uuid

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import get_connection, init_db
from api.services.auth_service import create_user, create_session


def _make_paid(user_id):
    """Give the user an active pro subscription.

    ⛔ THE SCREENER IS PAID, NOT MERELY LOGGED-IN (owner ruling 2026-08-06,
    reaffirmed 08-07 — *"everything is paid, almost nothing is accessible for
    free"*). These routes carried `Depends(get_current_user)` until 2026-08-08,
    so a FREE member could run the whole 4,000-ticker precomputed screen; they
    now carry `Depends(require_paid)` and answer a free member 402. The plan is
    written to the DB rather than injected with a dependency override so this
    file keeps exercising the real cookie → session → subscription path — the
    refusal side is swept separately, derived from `router.routes`, in
    tests/test_scan_screener_auth.py.
    """
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'active')",
            (f"sub_{uuid.uuid4()}", user_id))
        conn.commit()
    finally:
        conn.close()


def _login(client, paid=True):
    user = create_user(f"scr_{uuid.uuid4()}@example.com", "password123")
    token = create_session(user["id"])
    client.cookies.set("uct_session", token)
    if paid:
        _make_paid(user["id"])
    return user["id"]


def _seed_screener(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "rsi14": 25, "uct_composite": 80, "price": 10.0,
         "sector": "Tech", "company": "Alpha", "snapshot_date": "2026-06-19",
         "built_at": 1},
        {"ticker": "BBB", "rsi14": 85, "uct_composite": 60, "price": 20.0,
         "sector": "Tech", "company": "Beta", "snapshot_date": "2026-06-19",
         "built_at": 1},
    ])


def test_meta_requires_auth():
    client = TestClient(app)
    init_db()
    assert client.get("/api/screener/meta").status_code == 401
    assert client.post("/api/screener/scan", json={"filters": []}).status_code == 401


def test_meta_and_scan_refuse_a_FREE_member_through_the_real_session_path(tmp_path, monkeypatch):
    """A real cookie, a real session, a real (absent) subscription — 402.

    The derived sweep in tests/test_scan_screener_auth.py overrides
    `get_current_user_with_plan`, which is the right shape for covering every
    route but does not exercise `get_user_plan`'s DB read. This one does, so
    "free" here means *no subscription row*, not a dict a test wrote.
    """
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client, paid=False)
    for resp in (client.get("/api/screener/meta"),
                 client.post("/api/screener/scan", json={"filters": []}),
                 client.get("/api/candidates")):
        assert resp.status_code == 402, resp.text[:200]
        assert resp.json()["detail"] == "The screener requires a paid plan"


def test_meta_and_scan_after_login(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)

    r = client.get("/api/screener/meta")
    assert r.status_code == 200
    body = r.json()
    assert any(f["key"] == "sector" for f in body["filters"])
    assert any(v["key"] == "overview" for v in body["views"])

    r2 = client.post("/api/screener/scan",
                     json={"filters": [{"key": "rsi14", "op": "lte", "max": 60}],
                           "view": "overview"})
    assert r2.status_code == 200
    out = r2.json()
    assert out["total"] == 1
    assert out["rows"][0]["ticker"] == "AAA"


def test_scan_rejects_bad_filter(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)
    r = client.post("/api/screener/scan",
                    json={"filters": [{"key": "evil", "op": "eq", "value": 1}]})
    assert r.status_code == 400


def test_refresh_requires_admin(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)  # member, not admin
    assert client.post("/api/screener/refresh").status_code == 403


def test_refresh_admin_starts(tmp_path, monkeypatch):
    """🔴 THE REAL BUILDER IS STUBBED, AND THAT IS THE POINT OF THIS EDIT.

    Until 2026-08-09 this test let the route's daemon thread run the REAL
    `snapshot_builder.run_build(max_tickers=1)`. The thread outlived
    `monkeypatch`'s teardown, so `init_db()` ran against the tmp db while the
    final `upsert_rows` resolved `SCREENER_DB_PATH` AFTER it had been unset —
    i.e. `/data/screener.db`, which on this box is the shared `C:\\data\\screener.db`.

    That wrote exactly one row: ticker `A`, the first never-built entry of
    `cap_universe.json`, stamped `snapshot_date = 2026-08-08` at 23:20 CT.
    It is THE row that made `MAX(snapshot_date)` report "today" over 3,583 rows
    built 2026-07-11 — the member-facing defect this branch fixes. Reproduced
    2026-08-09 by exporting `SCREENER_DB_PATH` to a probe file: the thread's
    `executemany` surfaced there, post-teardown, `no such table: screener_rows`.

    ⛔ The row is NOT deleted — the data is what it is and the report is now
    honest about it. What is fixed here is the writer.
    """
    import threading
    from api.services.screener import snapshot_builder

    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    uid = _login(client)
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (uid,))
        conn.commit()
    finally:
        conn.close()

    called, ran = [], threading.Event()

    def _fake_build(max_tickers=None):
        called.append(max_tickers)
        ran.set()
        return {"built": 0, "skipped": 0, "errors": 0}

    monkeypatch.setattr(snapshot_builder, "run_build", _fake_build)

    r = client.post("/api/screener/refresh?max_tickers=1")
    assert r.status_code == 200
    assert r.json()["started"] is True
    # Wait INSIDE the monkeypatch window: the route hands the build to a daemon
    # thread, and a test that returns before it lands leaves a writer racing
    # teardown for the real DB path. Waiting proves the stub is what ran.
    assert ran.wait(10), "the refresh route never called run_build"
    assert called == [1], "the cap the caller asked for must reach the builder"
    for t in threading.enumerate():
        if t.name == "screener-refresh":
            t.join(timeout=10)
            assert not t.is_alive()


# ─── the earnings-context diagnostic ─────────────────────────────────────────
#
# 🔴 WHAT IT IS FOR: `implied_move_pct` and `earnings_setup_grade` are non-null
# on 0 of 3,745 prod rows and nothing could say why — `railway ssh` is blocked
# in this environment and there was no HTTP surface over `implied_store`. The
# route's whole job is to make ONE call distinguish four worlds, so these tests
# drive all four against a real (tiny) store rather than asserting the shape of
# a payload nobody has seen answer.

def _seed_implied(tmp_path, monkeypatch, *, implied_rows=(), grade_rows=()):
    """A real `implied_moves.db`, schema DERIVED from `implied_store._SCHEMA`.

    ⛔ The schema is executed from the store's own constant, never retyped: a
    hand-copied CREATE TABLE here would keep passing after the real one moved,
    which is the failure this whole diagnostic exists to catch in production.
    """
    import os
    import sqlite3
    from api.services import implied_store

    path = str(tmp_path / "implied_moves.db")
    # Re-seeding replaces the store outright — the four worlds are DIFFERENT
    # stores, and an append would silently leave world 4's row underneath
    # world 3's and make every later scenario agree with the first one.
    if os.path.exists(path):
        os.remove(path)
    conn = sqlite3.connect(path)
    conn.executescript(implied_store._SCHEMA)
    conn.executemany(
        "INSERT INTO implied_snapshots (sym, report_date, captured_at, pct, dollar) "
        "VALUES (?,?,?,?,?)",
        [(s, d, f"{d}T16:35:00-04:00", 7.5, 3.2) for s, d in implied_rows])
    conn.executemany(
        "INSERT INTO grade_snapshots (sym, date, surface, grade, inputs_json) "
        "VALUES (?,?,?,?,'{}')", grade_rows)
    conn.commit()
    conn.close()
    monkeypatch.setattr(implied_store, "DB_PATH", path)
    return path


def _seed_rows_with_earnings(pairs):
    """Screener rows carrying a `next_earnings_date` and NULL event columns —
    exactly the member-facing shape being explained."""
    import api.services.screener.snapshot_db as db
    db.upsert_rows([
        {"ticker": t, "price": 10.0, "sector": "Tech", "company": t,
         "next_earnings_date": d, "snapshot_date": "2026-08-23", "built_at": 1}
        for t, d in pairs])


def _admin_client(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    uid = _login(client)
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (uid,))
        conn.commit()
    finally:
        conn.close()
    return client


def _status(client):
    r = client.get("/api/screener/earnings-context-status")
    assert r.status_code == 200, r.text[:400]
    return r.json()


def test_earnings_context_status_is_admin_only(tmp_path, monkeypatch):
    """STRICTER than paid, and shown to be — a paid member is refused and an
    admin is answered, so the gate cannot pass by refusing everybody."""
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    uid = _login(client)  # paid member, not admin
    assert client.get("/api/screener/earnings-context-status").status_code == 403

    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (uid,))
        conn.commit()
    finally:
        conn.close()
    assert client.get("/api/screener/earnings-context-status").status_code == 200


def test_the_payload_answers_the_four_worlds_without_a_follow_up_call(tmp_path, monkeypatch):
    """⭐ THE ONE THING THIS ROUTE MUST DO: name WHICH world, in one call.

    All four are driven against a real store, plus the healthy case — a verdict
    function that only ever returns one answer would pass a single-scenario
    test and tell an operator nothing.
    """
    from api.routers.screener import EARNINGS_CONTEXT_WORLDS
    from api.services import implied_store, setup_grade

    # WORLD 4 — the store and the snapshot agree on a real (symbol, date) pair
    # and the column is STILL empty: the loss is downstream of the join.
    client = _admin_client(tmp_path, monkeypatch)
    _seed_rows_with_earnings([("AAA", "2026-08-25"), ("BBB", "2026-08-26")])
    _seed_implied(tmp_path, monkeypatch,
                  implied_rows=[("AAA", "2026-08-25")],
                  grade_rows=[("AAA", "2026-08-22", setup_grade.SURFACE, "B")])

    body = _status(client)
    assert body["implied"]["world"] == 4
    assert body["implied"]["reading"] == EARNINGS_CONTEXT_WORLDS[4]
    assert body["grade"]["world"] == 4
    assert body["join"]["pairs_joining_reader_normalisation"] == 1
    assert body["join"]["pairs_sample"] == ["AAA@2026-08-25"]
    assert body["join"]["snapshot_tickers_in_grade_store"] == 1

    # …and the fields that make the answer readable without a second call.
    assert body["implied"]["rows"] == 1
    assert body["implied"]["report_dates"] == ["2026-08-25"]
    assert body["implied"]["rows_by_report_date"] == {"2026-08-25": 1}
    assert body["implied"]["max_captured_at"].startswith("2026-08-25")
    assert body["grade"]["surface_asked"] == setup_grade.SURFACE
    assert body["grade"]["rows"] == 1 and body["grade"]["max_date"] == "2026-08-22"
    assert body["snapshot"]["implied_move_pct_non_null"] == 0
    assert body["snapshot"]["earnings_setup_grade_non_null"] == 0
    assert body["snapshot"]["next_earnings_date_non_null"] == 2
    assert body["config"]["capture_hour_et"] == implied_store.CAPTURE_HOUR_ET
    assert body["config"]["grade_surface"] == setup_grade.SURFACE
    # The reading and the number come off ONE mapping, shipped in the payload.
    assert body["worlds"]["4"] == EARNINGS_CONTEXT_WORLDS[4]

    # WORLD 3 — the store holds rows, for a date nothing asks about.
    _seed_implied(tmp_path, monkeypatch, implied_rows=[("AAA", "2026-07-01")])
    body = _status(client)
    assert body["implied"]["world"] == 3, body["implied"]["reading"]
    assert body["join"]["dates_in_both_count"] == 0
    assert body["join"]["dates_ask_only"] == ["2026-08-25", "2026-08-26"]
    assert body["join"]["dates_store_only"] == ["2026-07-01"]

    # WORLD 2 — the SAME date on both sides and still nothing joins: the
    # symbols disagree, which no date-level view could have told you.
    _seed_implied(tmp_path, monkeypatch, implied_rows=[("ZZZ", "2026-08-25")])
    body = _status(client)
    assert body["implied"]["world"] == 2, body["implied"]["reading"]
    assert body["join"]["dates_in_both"] == ["2026-08-25"]
    assert body["join"]["pairs_joining_reader_normalisation"] == 0

    # WORLD 1 — an empty store outranks everything else: no join could hit.
    _seed_implied(tmp_path, monkeypatch)
    body = _status(client)
    assert body["implied"]["world"] == 1
    assert body["implied"]["rows"] == 0
    assert body["grade"]["world"] == 1

    # WORLD 0 — and the healthy case is distinguishable from all four, so a
    # filled column can never keep reading as a defect.
    _seed_implied(tmp_path, monkeypatch, implied_rows=[("AAA", "2026-08-25")],
                  grade_rows=[("AAA", "2026-08-22", setup_grade.SURFACE, "B")])
    import api.services.screener.snapshot_db as db
    db.upsert_rows([{"ticker": "AAA", "implied_move_pct": 7.5,
                     "earnings_setup_grade": "B", "next_earnings_date": "2026-08-25",
                     "snapshot_date": "2026-08-23", "built_at": 1}])
    body = _status(client)
    assert body["implied"]["world"] == 0 and body["grade"]["world"] == 0
    assert body["snapshot"]["implied_move_pct_non_null"] == 1


def test_the_ask_set_is_read_from_the_reporter_CACHE_and_never_fetched(tmp_path, monkeypatch):
    """⛔ NO PROVIDER CALL, and the ask-set is still real when the cache is warm.

    `upcoming_reporters` fetches on a miss, so the route peeks at the cache the
    store's own jobs populate. A cold cache must read as `cold` + honest-None
    (never a fabricated empty ask that would make world 3 look like world 1),
    and the verdict must then say, in `join.basis`, which set it used instead.
    """
    import datetime as dt
    from api.services import implied_store

    client = _admin_client(tmp_path, monkeypatch)
    _seed_rows_with_earnings([("AAA", "2026-08-25")])
    _seed_implied(tmp_path, monkeypatch, implied_rows=[("AAA", "2026-08-25")])

    # A provider call from this route is a bug, not a slow path.
    monkeypatch.setattr(implied_store, "_fmp_reporters",
                        lambda *a, **k: pytest.fail("the diagnostic called FMP"))
    monkeypatch.setattr(implied_store, "_finnhub_reporters",
                        lambda *a, **k: pytest.fail("the diagnostic called Finnhub"))

    cold = _status(client)
    assert cold["screener_ask"]["state"] == "cold"
    assert cold["screener_ask"]["report_dates"] is None
    assert "next_earnings_date" in cold["join"]["basis"]

    today = dt.datetime.now().date().isoformat()
    key = f"impstore::reporters::14::{today}"
    implied_store._REPORTERS_CACHE.set(
        key, [{"sym": "AAA", "report_date": "2026-08-25"},
              {"sym": "CCC", "report_date": "2026-09-04"}], 60)
    try:
        warm = _status(client)
    finally:
        implied_store._REPORTERS_CACHE.invalidate(key)

    assert warm["screener_ask"]["state"] == "warm", warm["screener_ask"]
    assert warm["screener_ask"]["key_used"] == key
    assert warm["screener_ask"]["report_dates"] == ["2026-08-25", "2026-09-04"]
    assert "upcoming_reporters" in warm["join"]["basis"]
    assert warm["join"]["dates_in_both"] == ["2026-08-25"]
    assert warm["join"]["dates_ask_only"] == ["2026-09-04"]


def test_saved_screens_roundtrip(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)
    r = client.get("/api/screener/saved-screens")
    assert r.status_code == 200
    assert len(r.json()["starters"]) >= 3
    created = client.post("/api/screener/saved-screens",
                          json={"name": "My RSI", "spec": {"filters": [], "view": "overview"}})
    assert created.status_code == 200
    sid = created.json()["id"]
    assert any(s["id"] == sid for s in client.get("/api/screener/saved-screens").json()["saved"])
    assert client.request("DELETE", f"/api/screener/saved-screens/{sid}").json()["deleted"] is True
