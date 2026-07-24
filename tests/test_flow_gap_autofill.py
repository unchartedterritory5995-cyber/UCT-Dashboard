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


# --- Walkback sweep (audit finding B2 — whole-day miss coverage) ---------------

# Monday. Its prior trading days deliberately straddle a holiday + weekend:
# _prev_trading_day chain from 7/6 = 7/2, 7/1, 6/30, 6/29 (7/3 = observed
# Independence Day full closure, 7/4-7/5 = weekend, all skipped).
WALKBACK_ANCHOR = date(2026, 7, 6)


def _insert_session_for(db_path, target_date, gap=None, sym="SPY"):
    """Insert a full 09:30-16:00 one-row-per-minute session for target_date,
    minus the optional `gap` set of minute-of-day values."""
    mdy = gf._mdy(target_date)
    rows = []
    for m in range(gf.SESSION_START_MIN, 16 * 60):
        if gap and m in gap:
            continue
        h24, mm = divmod(m, 60)
        ampm = "AM" if h24 < 12 else "PM"
        h12 = h24 % 12 or 12
        r = {c: "" for c in COLUMNS}
        r.update({
            "CreatedDate": mdy, "CreatedTime": f"{h12}:{mm:02d}:30 {ampm}",
            "Symbol": sym, "Type": "SWEEP", "Volume": "100", "Price": "1.25",
            "CallPut": "C", "Strike": "200", "ExpirationDate": "7/17/2026",
            "Premium": "50000", "Dte": "11", "StockEtf": "STOCK",
        })
        rows.append(r)
    _insert_live(db_path, rows)


def _by_date(result):
    return {r["target_date"]: r for r in result["results"]}


def test_walkback_heals_middle_day_gap_when_newer_days_clean(db):
    # T-1 (7/6) and T-2 (7/2) clean; T-3 (7/1) has a 10-min session gap that
    # the single-day T-1 jobs never caught. The sweep must still detect it.
    _insert_session_for(db["path"], date(2026, 7, 6))
    _insert_session_for(db["path"], date(2026, 7, 2))
    _insert_session_for(db["path"], date(2026, 7, 1), gap=set(range(700, 710)))
    result = gf.run_fill_walkback(max_days=3, end_date=WALKBACK_ANCHOR, dry_run=True)
    assert result["status"] == "walkback_complete" and result["days_checked"] == 3
    by = _by_date(result)
    assert by["7/6/2026"]["status"] == "no_gaps"
    assert by["7/2/2026"]["status"] == "no_gaps"
    # middle day: detected AND (dry-run) reported the exact window
    assert by["7/1/2026"]["status"] == "dry_run"
    assert by["7/1/2026"]["windows"] == [(700, 710)]
    assert result["healed"] == ["7/1/2026"]
    assert not db["bumps"], "dry-run walkback must write nothing"


def test_walkback_respects_manifest_skip_on_completed_day(db):
    # A recent completed run for 7/2 -> that day is a cheap skipped_recent
    # no-op; the other days still get checked.
    with sqlite3.connect(db["path"]) as m:
        m.execute("INSERT INTO flow_fill_runs (target_date, status, mode, "
                  "started_at, heartbeat_at, finished_at) VALUES "
                  "(?, 'completed', 'windows', datetime('now'), datetime('now'), "
                  "datetime('now'))", ("7/2/2026",))
    _insert_session_for(db["path"], date(2026, 7, 6))
    _insert_session_for(db["path"], date(2026, 7, 1))
    result = gf.run_fill_walkback(max_days=3, end_date=WALKBACK_ANCHOR, dry_run=True)
    by = _by_date(result)
    assert by["7/2/2026"]["status"] == "skipped_recent"
    assert by["7/6/2026"]["status"] == "no_gaps"
    assert by["7/1/2026"]["status"] == "no_gaps"


def test_walkback_skips_weekends_and_holidays(db):
    # 5 trading days back from Mon 7/6 must skip Fri 7/3 (observed July 4th
    # closure) + the 7/4-7/5 weekend, landing only on real sessions.
    result = gf.run_fill_walkback(max_days=5, end_date=WALKBACK_ANCHOR, dry_run=True)
    assert result["days"] == ["2026-07-06", "2026-07-02", "2026-07-01",
                              "2026-06-30", "2026-06-29"]
    for iso in ("2026-07-03", "2026-07-04", "2026-07-05"):
        assert iso not in result["days"]
    for iso in result["days"]:
        assert gf._is_trading_day(date.fromisoformat(iso)), iso


def test_walkback_default_days_from_constant(db, monkeypatch):
    # max_days=None -> WALKBACK_TRADING_DAYS trading days off the anchor.
    monkeypatch.setattr(gf, "WALKBACK_TRADING_DAYS", 2)
    result = gf.run_fill_walkback(end_date=WALKBACK_ANCHOR, dry_run=True)
    assert result["days_checked"] == 2
    assert result["days"] == ["2026-07-06", "2026-07-02"]


# --- Backup retention (2026-07-23 disk incident) ------------------------------
# 18 snapshots × ~2.3GB = 33GB of a 46GB volume, because the prune only ran
# inside _backup_db() — i.e. only on runs that FOUND gaps — and its rule was
# age-only, so a run of healthy 'no_gaps' days reclaimed nothing.

import os
import time


def _snap(d, run_id, size, age_days):
    p = os.path.join(d, f"flow-pre-{run_id}-2026-07-17.db")
    with open(p, "wb") as f:
        f.write(b"x" * size)
    t = time.time() - age_days * 86400
    os.utime(p, (t, t))
    return p


def test_prune_backups_always_keeps_the_newest_n(tmp_path, monkeypatch):
    d = str(tmp_path / "flow_backups")
    os.makedirs(d)
    monkeypatch.setattr(gf, "BACKUP_DIR", d)
    monkeypatch.setattr(gf, "BACKUP_KEEP", 3)
    monkeypatch.setattr(gf, "BACKUP_MAX_AGE_DAYS", 14)
    monkeypatch.setattr(gf, "BACKUP_MAX_BYTES", 1 << 40)
    for i in range(6):
        _snap(d, i, 10, age_days=100 - i)          # all ancient
    gf._prune_backups()
    left = sorted(os.listdir(d))
    assert len(left) == 3
    assert "flow-pre-5-2026-07-17.db" in left      # newest survives


def test_prune_backups_enforces_a_size_cap_not_just_age(tmp_path, monkeypatch):
    """The age-only rule was the hole: every snapshot was <14d old, so nothing
    was prunable while the directory ran away to 33GB."""
    d = str(tmp_path / "flow_backups")
    os.makedirs(d)
    monkeypatch.setattr(gf, "BACKUP_DIR", d)
    monkeypatch.setattr(gf, "BACKUP_KEEP", 3)
    monkeypatch.setattr(gf, "BACKUP_MAX_AGE_DAYS", 14)
    monkeypatch.setattr(gf, "BACKUP_MAX_BYTES", 5000)
    for i in range(8):
        _snap(d, i, 1000, age_days=i * 0.1)        # 8GB-equivalent, all fresh
    gf._prune_backups()
    left = os.listdir(d)
    assert len(left) < 8, "size cap must bite even when nothing has expired"
    total = sum(os.path.getsize(os.path.join(d, f)) for f in left)
    assert total <= 5000
    assert len(left) >= 3, "the newest KEEP snapshots are never sacrificed"


def test_prune_backups_no_dir_is_a_noop(tmp_path, monkeypatch):
    monkeypatch.setattr(gf, "BACKUP_DIR", str(tmp_path / "nope"))
    assert gf._prune_backups() == 0
