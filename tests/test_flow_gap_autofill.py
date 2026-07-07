"""Acceptance tests for the T+1 flow gap-autofill (deploy-survival P2).

All against a temp flow.db — no network, no flat-file downloads (the flatfile
pipeline is monkeypatched with synthetic rows). Covers the spec's AT-1..AT-8.
"""
import json
import sqlite3
from datetime import date

import pytest

from api import flow_gap_autofill as gf
from api.flow_db import FlowDB, COLUMNS

TARGET = date(2026, 7, 6)          # Monday, a normal trading day
MDY = "7/6/2026"
EARLY_CLOSE = date(2026, 11, 27)   # 1:00 PM ET close


def _mk_row(time_str, sym="AAPL", vol="100", premium="50000", price="1.25"):
    r = {c: "" for c in COLUMNS}
    r.update({
        "CreatedDate": MDY, "CreatedTime": time_str, "Symbol": sym,
        "Type": "SWEEP", "Volume": vol, "Price": price, "CallPut": "C",
        "Strike": "200", "ExpirationDate": "7/17/2026", "Premium": premium,
        "Dte": "11", "StockEtf": "STOCK",
    })
    return r


def _insert_live(db, rows, source="stocks"):
    with sqlite3.connect(db) as c:
        for r in rows:
            dedup = FlowDB._make_dedup_key(r, source)
            c.execute(
                """INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Type,
                   Volume, Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate,
                   Color, ImpliedVolatility, Dte, ER, StockEtf, Sector, Uoa, Weekly,
                   MktCap, OI, dedup_key)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (source, *(str(r.get(col, "")) for col in COLUMNS), dedup))
        c.commit()


def _minute_rows(minutes, sym="SPY"):
    """One row per given minute-of-day."""
    out = []
    for m in minutes:
        h24, mm = divmod(m, 60)
        ampm = "AM" if h24 < 12 else "PM"
        h12 = h24 % 12 or 12
        out.append(_mk_row(f"{h12}:{mm:02d}:30 {ampm}", sym=sym))
    return out


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "flow.db")
    FlowDB(path)  # creates the flow table schema
    monkeypatch.setattr(gf, "DB_PATH", path)
    monkeypatch.setattr(gf, "BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(gf, "_post_discord", lambda msg: True)
    bumps = []
    monkeypatch.setattr(gf, "_bump_version", lambda: bumps.append(1) or len(bumps))
    monkeypatch.setattr(gf, "_current_version", lambda: 1000 + len(bumps))
    gf._init_schema()
    return {"path": path, "bumps": bumps}


# --- AT-1: detection -----------------------------------------------------------

def test_detection_single_window(db):
    session = list(range(gf.SESSION_START_MIN, 16 * 60))
    gap = set(range(605, 615))  # 10:05–10:14
    _insert_live(db["path"], _minute_rows([m for m in session if m not in gap]))
    windows, mode = gf.detect_windows(TARGET)
    assert mode == "windows" and windows == [(605, 615)]


def test_detection_min_gap_honored():
    minutes = set(range(gf.SESSION_START_MIN, 16 * 60)) - {700}  # single empty minute
    windows, _ = gf.windows_from_minutes(minutes, 16 * 60, min_gap=2)
    assert windows == []


def test_detection_early_close_no_false_afternoon_window(db, monkeypatch):
    # rows only until 13:00; on an early-close day that's a FULL day
    session = list(range(gf.SESSION_START_MIN, 13 * 60))
    windows, mode = gf.windows_from_minutes(set(session), gf._session_end_min(EARLY_CLOSE))
    assert windows == [] and gf._session_end_min(EARLY_CLOSE) == 13 * 60


def test_detection_empty_day_full_session(db):
    windows, mode = gf.detect_windows(TARGET)  # no rows inserted at all
    assert mode == "full_session"
    assert windows == [(gf.SESSION_START_MIN, 16 * 60)]


def test_sec_of_day_noon_midnight_edges():
    assert gf._sec_of_day("12:00:01 AM") == 1
    assert gf._sec_of_day("12:00:01 PM") == 12 * 3600 + 1
    assert gf._sec_of_day("9:30:00 AM") == 9 * 3600 + 30 * 60
    assert gf._sec_of_day("garbage") is None


# --- AT-3/AT-4: boundary dedup + margin ------------------------------------------

def _fill_rows_at(secs, sym="AAPL", vol="150"):
    rows = []
    for sec in secs:
        h24, rem = divmod(sec, 3600)
        mm, ss = divmod(rem, 60)
        ampm = "AM" if h24 < 12 else "PM"
        h12 = h24 % 12 or 12
        rows.append((sec, _mk_row(f"{h12}:{mm:02d}:{ss:02d} {ampm}", sym=sym, vol=vol)))
    return {"stocks": rows, "indexes": []}


def test_boundary_partial_replaced_and_margin_respected(db):
    # live partial at 10:04:58 (inside lo=10:04:00 margin) — must be replaced
    # live row at 10:03:59 (outside margin) — must be untouched
    _insert_live(db["path"], [_mk_row("10:04:58 AM", vol="100"),
                              _mk_row("10:03:59 AM", sym="MSFT")])
    gap = (605, 615)  # 10:05–10:15
    fill = _fill_rows_at([10 * 3600 + 4 * 60 + 58, 10 * 3600 + 3 * 60 + 59], vol="150")
    c = gf._conn()
    try:
        with sqlite3.connect(db["path"]) as m:
            m.execute("INSERT INTO flow_fill_runs (target_date, status, mode, "
                      "started_at, heartbeat_at) VALUES (?, 'running', 'windows', "
                      "datetime('now'), datetime('now'))", (MDY,))
            run_id = m.execute("SELECT MAX(run_id) FROM flow_fill_runs").fetchone()[0]
        deleted, inserted, skipped = gf._fill_window(c, run_id, MDY, gap, fill)
    finally:
        c.close()
    assert deleted == 1 and inserted == 1
    with sqlite3.connect(db["path"]) as m:
        rows = m.execute("SELECT Symbol, Volume, CreatedTime FROM flow "
                         "WHERE CreatedDate=?", (MDY,)).fetchall()
    by_sym = {r[0]: r for r in rows}
    assert by_sym["AAPL"][1] == "150", "flatfile full row must win at the edge"
    assert by_sym["MSFT"][2] == "10:03:59 AM", "outside-margin row untouched"
    with sqlite3.connect(db["path"]) as m:
        n, d = m.execute("SELECT COUNT(*), COUNT(DISTINCT dedup_key) FROM flow "
                         "WHERE CreatedDate=?", (MDY,)).fetchone()
    assert n == d, "no boundary dupes"


# --- AT-6: crash mid-window rolls back cleanly -------------------------------------

def test_crash_mid_window_rolls_back(db, monkeypatch):
    _insert_live(db["path"], _minute_rows(range(605, 610), sym="NVDA"))
    before = sqlite3.connect(db["path"]).execute(
        "SELECT COUNT(*) FROM flow").fetchone()[0]

    def _boom(row, source):
        raise RuntimeError("injected crash after delete, before commit")
    monkeypatch.setattr(gf.__dict__["FlowDB"] if "FlowDB" in gf.__dict__ else FlowDB,
                        "_make_dedup_key", staticmethod(_boom))
    c = gf._conn()
    try:
        with pytest.raises(RuntimeError):
            gf._fill_window(c, 999, MDY, (605, 615), _fill_rows_at([605 * 60 + 30]))
    finally:
        c.close()
    after = sqlite3.connect(db["path"]).execute(
        "SELECT COUNT(*) FROM flow").fetchone()[0]
    assert after == before, "transaction must roll back completely"


# --- AT-7/AT-8: full run, rollback, idempotency ------------------------------------

def _run_real(db, monkeypatch, fill_secs):
    session = list(range(gf.SESSION_START_MIN, 16 * 60))
    gap = set(range(605, 615))
    _insert_live(db["path"], _minute_rows([m for m in session if m not in gap]))
    monkeypatch.setattr(gf, "_build_fill_rows",
                        lambda target: (_fill_rows_at(fill_secs), {"min_premium": 10000,
                                                                   "min_volume": 50}))
    return gf.run_fill(target=TARGET, dry_run=False)


def test_full_run_then_rollback_then_idempotent(db, monkeypatch):
    # Realistic fill: one row per minute across the ±60s-widened window
    # [10:04, 10:16) — a real flat file covers every minute it replaces.
    fill_secs = [m * 60 + 30 for m in range(604, 616)]
    result = _run_real(db, monkeypatch, fill_secs)
    assert result["status"] == "completed", result
    assert result["inserted"] == 12 and result["problems"] == [], result
    # margin consumed the two live edge-minute rows (604 + 615)
    assert result["deleted"] == 2
    assert db["bumps"], "version must bump after a mutating run"
    with sqlite3.connect(db["path"]) as m:
        filled = m.execute("SELECT COUNT(*) FROM flow WHERE CreatedDate=? AND "
                           "Symbol='AAPL'", (MDY,)).fetchone()[0]
    assert filled == 12

    # AT-8: immediate re-fire skips (24h manifest guard)
    again = gf.run_fill(target=TARGET, dry_run=False)
    assert again["status"] == "skipped_recent"

    # AT-7: rollback restores pre-fill state (filled rows out, archived rows back)
    rb = gf.rollback_run(result["run_id"])
    assert rb["status"] == "rolled_back" and rb["removed"] == 12 and rb["restored"] == 2
    with sqlite3.connect(db["path"]) as m:
        filled = m.execute("SELECT COUNT(*) FROM flow WHERE Symbol='AAPL'").fetchone()[0]
        edge = m.execute("SELECT COUNT(*) FROM flow WHERE Symbol='SPY' AND "
                         "CreatedTime IN ('10:04:30 AM','10:15:30 AM')").fetchone()[0]
    assert filled == 0, "filled rows removed on rollback"
    assert edge == 2, "archived live edge rows restored on rollback"


def test_dry_run_writes_nothing(db, monkeypatch):
    session = list(range(gf.SESSION_START_MIN, 16 * 60))
    _insert_live(db["path"], _minute_rows([m for m in session if m not in
                                           set(range(700, 710))]))
    called = []
    monkeypatch.setattr(gf, "_build_fill_rows",
                        lambda target: called.append(1) or ({"stocks": [], "indexes": []}, {}))
    result = gf.run_fill(target=TARGET, dry_run=True)
    assert result["status"] == "dry_run" and result["windows"] == [(700, 710)]
    assert not called, "dry run must not download the flat file"
    assert not db["bumps"]


def test_no_gaps_day_is_free(db, monkeypatch):
    _insert_live(db["path"], _minute_rows(range(gf.SESSION_START_MIN, 16 * 60)))
    monkeypatch.setattr(gf, "_build_fill_rows",
                        lambda target: (_ for _ in ()).throw(AssertionError("must not download")))
    result = gf.run_fill(target=TARGET, dry_run=False)
    assert result["status"] == "no_gaps"


# --- AT-5: boot re-bump --------------------------------------------------------------

def test_startup_rebump_after_recent_fill(db, monkeypatch):
    with sqlite3.connect(db["path"]) as m:
        m.execute("INSERT INTO flow_fill_runs (target_date, status, mode, started_at, "
                  "heartbeat_at, finished_at, rows_inserted) VALUES "
                  "(?, 'completed', 'windows', datetime('now'), datetime('now'), "
                  "datetime('now'), 42)", (MDY,))
    gf.startup_check()
    assert db["bumps"], "boot must re-bump when a recent fill exists"


def test_startup_no_bump_without_recent_fill(db):
    gf.startup_check()
    assert not db["bumps"]
