"""TERM-090 (item 15 ACC-06) -- the episodic-pivot base rate, beside the flag.

The rails, each watched red before the service existed:

  * the rate is DERIVED from the store at request time -- moving the fixture
    moves the number (a typed constant cannot pass two fixtures);
  * `n` (resolved flags) and the window (first/last flag date of those n) are
    in every answer;
  * below the stated floor no percentage exists in the payload at all -- the
    answer is "not enough history", carrying n and the floor;
  * the per-flag outcome is read from the LAST follow-through row by id. The
    engine's own `update_setup_performance` picks it by `check_date DESC`, and
    the tracker writes several rows per day, so a same-day tie can score a
    STOPPED flag by an earlier, positive, intraday row. That is the defect this
    file pins, not a style choice;
  * only the engine's `EP` setup key is counted (an `Earnings-Gap` row is a
    PEG-family flag and never enters the EP rate);
  * the route is paid-gated.

Every fixture is a temp SQLite file; nothing here reads the owner's engine DB
or C:\\data.
"""
from __future__ import annotations

import os
import sqlite3

import pytest
from fastapi.testclient import TestClient

from api.services import ep_base_rate


def _make_db(path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE ep_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT,"
        " date_flagged TEXT, setup_type TEXT, entry_price REAL, status TEXT)")
    conn.execute(
        "CREATE TABLE ep_follow_throughs (id INTEGER PRIMARY KEY AUTOINCREMENT, ep_id INTEGER,"
        " symbol TEXT, check_date TEXT, current_price REAL, entry_price REAL,"
        " pct_change REAL, days_held INTEGER, status TEXT)")
    conn.commit()
    conn.close()
    return path


def _flag(path, symbol, date_flagged, status, final_pcts, setup="EP", check_date=None):
    """Insert one flag plus its follow-through rows IN ORDER (last = final)."""
    conn = sqlite3.connect(path)
    cur = conn.execute(
        "INSERT INTO ep_candidates (symbol, date_flagged, setup_type, entry_price, status)"
        " VALUES (?,?,?,?,?)", (symbol, date_flagged, setup, 10.0, status))
    ep_id = cur.lastrowid
    for i, pct in enumerate(final_pcts):
        conn.execute(
            "INSERT INTO ep_follow_throughs (ep_id, symbol, check_date, current_price,"
            " entry_price, pct_change, days_held, status) VALUES (?,?,?,?,?,?,?,?)",
            (ep_id, symbol, check_date or date_flagged, 10.0 * (1 + pct / 100), 10.0,
             pct, i, status))
    conn.commit()
    conn.close()


def _seed(path, *, wins, losses, stops=0, open_=0, start="2026-03-02"):
    """wins/losses = CLOSED flags ending above / at-or-below flag price;
    stops = STOPPED flags; open_ = still-tracking flags (never counted)."""
    day = int(start[-2:])
    k = 0

    def d():
        nonlocal k
        k += 1
        return f"{start[:8]}{min(day + k // 4, 28):02d}"
    for i in range(wins):
        _flag(path, f"W{i}", d(), "CLOSED", [1.0, 6.0])
    for i in range(losses):
        _flag(path, f"L{i}", d(), "CLOSED", [3.0, -2.0])
    for i in range(stops):
        _flag(path, f"S{i}", d(), "STOPPED", [-3.0, -9.0])
    for i in range(open_):
        _flag(path, f"O{i}", d(), "OPEN", [4.0])


@pytest.fixture
def db(tmp_path):
    return _make_db(str(tmp_path / "brain" / "data" / "uct_intelligence.db"))


# ── derived, not typed ──────────────────────────────────────────────────────

def test_the_rate_is_derived_moving_the_fixture_moves_the_number(db):
    _seed(db, wins=10, losses=20, stops=10)            # 10 / 40 resolved
    first = ep_base_rate.compute(db)
    assert first["ok"] is True
    assert first["resolved"] == 40
    assert first["followed_through"] == 10
    assert first["rate_pct"] == 25.0

    for i in range(20):                                  # +20 wins -> 30 / 60
        _flag(db, f"X{i}", "2026-04-01", "CLOSED", [2.0, 4.0])
    second = ep_base_rate.compute(db)
    assert second["resolved"] == 60
    assert second["followed_through"] == 30
    assert second["rate_pct"] == 50.0


def test_n_and_window_travel_with_every_answer(db):
    _flag(db, "FIRST", "2026-02-20", "STOPPED", [-9.0])
    _seed(db, wins=12, losses=10, stops=10)
    _flag(db, "LAST", "2026-09-25", "CLOSED", [3.0])
    _flag(db, "LIVE", "2026-09-26", "OPEN", [1.0])       # unresolved: not in n, not in window
    r = ep_base_rate.compute(db)
    assert r["resolved"] == 34
    assert r["unresolved"] == 1
    assert r["window"] == {"start": "2026-02-20", "end": "2026-09-25"}
    assert r["min_resolved"] == ep_base_rate.MIN_RESOLVED


# ── thin sample: n, never a percentage ──────────────────────────────────────

def test_a_thin_sample_carries_n_and_the_floor_and_no_percentage(db):
    _seed(db, wins=3, losses=2)                          # 5 resolved, 60% if printed
    r = ep_base_rate.compute(db)
    assert r["ok"] is True
    assert r["resolved"] == 5
    assert r["thin"] is True
    assert r["rate_pct"] is None
    assert r["min_resolved"] == ep_base_rate.MIN_RESOLVED
    assert r["window"] == {"start": "2026-03-02", "end": "2026-03-03"}


def test_exactly_at_the_floor_is_not_thin(db):
    floor = ep_base_rate.MIN_RESOLVED
    _seed(db, wins=floor // 2, losses=floor - floor // 2)
    r = ep_base_rate.compute(db)
    assert r["resolved"] == floor
    assert r["thin"] is False
    assert r["rate_pct"] == round((floor // 2) / floor * 100, 1)


def test_an_empty_record_is_thin_with_n_zero_not_zero_percent(db):
    r = ep_base_rate.compute(db)
    assert r["ok"] is True
    assert r["resolved"] == 0
    assert r["rate_pct"] is None
    assert r["window"] == {"start": None, "end": None}


# ── which row is the outcome ────────────────────────────────────────────────

def test_the_outcome_is_the_last_row_by_id_not_a_same_day_tie(db):
    """A flag STOPPED at -9% whose earlier row the SAME DAY read +4%. Picked by
    check_date the two rows tie and the +4% can win; by id the stop wins."""
    _seed(db, wins=0, losses=0, stops=30)                # floor-sized, all failures
    for i in range(5):
        _flag(db, f"T{i}", "2026-05-01", "STOPPED", [4.0, -9.0], check_date="2026-05-04")
    r = ep_base_rate.compute(db)
    assert r["resolved"] == 35
    assert r["followed_through"] == 0
    assert r["rate_pct"] == 0.0


def test_only_the_engine_EP_key_is_counted(db):
    _seed(db, wins=15, losses=15)
    for i in range(10):
        _flag(db, f"E{i}", "2026-04-02", "CLOSED", [9.0], setup="Earnings-Gap")
        _flag(db, f"G{i}", "2026-04-02", "CLOSED", [9.0], setup="Stage2")
    r = ep_base_rate.compute(db)
    assert r["resolved"] == 30
    assert r["rate_pct"] == 50.0


def test_a_resolved_flag_with_no_follow_through_row_is_not_counted(db):
    _seed(db, wins=15, losses=15)
    conn = sqlite3.connect(db)
    conn.execute("INSERT INTO ep_candidates (symbol, date_flagged, setup_type, entry_price,"
                 " status) VALUES ('NOROW','2026-01-02','EP',10.0,'CLOSED')")
    conn.commit()
    conn.close()
    r = ep_base_rate.compute(db)
    assert r["resolved"] == 30
    assert r["window"]["start"] != "2026-01-02"


def test_no_pack_is_unavailable_not_a_number(tmp_path):
    r = ep_base_rate.compute(str(tmp_path / "missing" / "uct_intelligence.db"))
    assert r["ok"] is False
    assert "rate_pct" not in r


def test_compute_reads_read_only(db):
    """The pack DB is the engine's; this surface must never write to it."""
    _seed(db, wins=15, losses=15)
    before = os.path.getmtime(db), os.path.getsize(db)
    ep_base_rate.compute(db)
    assert (os.path.getmtime(db), os.path.getsize(db)) == before


# ── the route ───────────────────────────────────────────────────────────────

FREE_USER = {"id": "ep-free-1", "email": "epfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "ep-paid-1", "email": "eppaid@example.test", "role": "member", "plan": "pro"}


@pytest.fixture
def client_as():
    from api.main import app
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

    def _make(user):
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def test_route_refuses_a_free_member_with_402(client_as, db, monkeypatch):
    monkeypatch.setenv("BRAIN_DIR", os.path.dirname(os.path.dirname(db)))
    assert client_as(FREE_USER).get("/api/catalysts/ep-base-rate").status_code == 402


def test_route_serves_the_derived_payload_to_a_paid_member(client_as, db, monkeypatch):
    monkeypatch.setenv("BRAIN_DIR", os.path.dirname(os.path.dirname(db)))
    _seed(db, wins=8, losses=16, stops=16)               # 8 / 40
    resp = client_as(PAID_USER).get("/api/catalysts/ep-base-rate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["resolved"] == 40
    assert body["rate_pct"] == 20.0
    assert body["window"]["start"] and body["window"]["end"]
