"""Tests for manual↔broker duplicate detection + flag resolution."""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import dedup


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()


_COLS = ("id,user_id,position_id,symbol,side,shares,entry_price,entry_date,"
         "exit_price,exit_date,original_stop,pnl_dollar,pnl_percent,hold_days,"
         "result,context_at_entry,created_at,account_id,source,setup,notes")


def _ins(tid, *, symbol="AAPL", side="Long", shares=10, ep=100.0,
         ed="2026-04-01T00:00:00Z", xp=110.0, xd="2026-04-03T00:00:00Z",
         source=None, setup=None, notes=None, user="u1"):
    conn = auth_db.get_connection()
    conn.execute(
        f"INSERT INTO j2_trades ({_COLS}) VALUES "
        "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, user, f"pos-{tid}", symbol, side, shares, ep, ed, xp, xd, ep,
         (xp - ep) * shares, 0.1, 2, "Win", "{}", ed, "acct1", source, setup, notes),
    )
    conn.commit(); conn.close()


def _flag_count(user="u1", status="pending"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_dup_flags WHERE user_id=? AND status=?",
            (user, status),
        ).fetchone()["n"]
    finally:
        conn.close()


def _trade_ids(user="u1"):
    conn = auth_db.get_connection()
    try:
        return {r["id"] for r in conn.execute("SELECT id FROM j2_trades WHERE user_id=?", (user,)).fetchall()}
    finally:
        conn.close()


def test_exact_match_flagged(env):
    _ins("manual1", source=None, setup="VCP", notes="my thesis")
    _ins("broker1", source="broker")
    out = dedup.scan_for_duplicates("u1")
    assert out["flagged"] == 1
    assert _flag_count() == 1


def test_different_symbol_not_flagged(env):
    _ins("manual1", symbol="AAPL", source=None)
    _ins("broker1", symbol="TSLA", source="broker")
    assert dedup.scan_for_duplicates("u1")["flagged"] == 0


def test_different_side_not_flagged(env):
    _ins("manual1", side="Long", source=None)
    _ins("broker1", side="Short", source="broker")
    assert dedup.scan_for_duplicates("u1")["flagged"] == 0


def test_far_dates_not_flagged(env):
    _ins("manual1", ed="2026-01-01T00:00:00Z", xd="2026-01-03T00:00:00Z", source=None)
    _ins("broker1", ed="2026-04-01T00:00:00Z", xd="2026-04-03T00:00:00Z", source="broker")
    assert dedup.scan_for_duplicates("u1")["flagged"] == 0


def test_scan_idempotent(env):
    _ins("manual1", source=None)
    _ins("broker1", source="broker")
    dedup.scan_for_duplicates("u1")
    dedup.scan_for_duplicates("u1")  # re-run
    assert _flag_count() == 1  # no duplicate flags


def test_merge_keeps_broker_folds_notes(env):
    _ins("manual1", source=None, setup="VCP", notes="my thesis")
    _ins("broker1", source="broker", setup=None, notes=None)
    dedup.scan_for_duplicates("u1")
    flags = dedup.list_flags("u1")
    assert len(flags) == 1
    res = dedup.resolve_flag("u1", flags[0]["id"], "merge")
    assert res["status"] == "merged"
    # Manual trade gone; broker trade survives with manual's notes folded in.
    ids = _trade_ids()
    assert "manual1" not in ids and "broker1" in ids
    conn = auth_db.get_connection()
    r = conn.execute("SELECT setup, notes, source FROM j2_trades WHERE id='broker1'").fetchone()
    conn.close()
    assert r["setup"] == "VCP" and r["notes"] == "my thesis" and r["source"] == "broker"


def test_dismiss_keeps_both(env):
    _ins("manual1", source=None)
    _ins("broker1", source="broker")
    dedup.scan_for_duplicates("u1")
    flags = dedup.list_flags("u1")
    res = dedup.resolve_flag("u1", flags[0]["id"], "dismiss")
    assert res["status"] == "dismissed"
    assert {"manual1", "broker1"}.issubset(_trade_ids())
    assert _flag_count(status="pending") == 0
    assert _flag_count(status="dismissed") == 1


def test_resolve_bad_action(env):
    _ins("manual1", source=None)
    _ins("broker1", source="broker")
    dedup.scan_for_duplicates("u1")
    fid = dedup.list_flags("u1")[0]["id"]
    with pytest.raises(dedup.DupFlagError):
        dedup.resolve_flag("u1", fid, "nonsense")


def test_list_skips_stale_flag(env):
    # Flag references a manual trade that gets deleted → list skips it.
    _ins("manual1", source=None)
    _ins("broker1", source="broker")
    dedup.scan_for_duplicates("u1")
    conn = auth_db.get_connection()
    conn.execute("DELETE FROM j2_trades WHERE id='manual1'")
    conn.commit(); conn.close()
    assert dedup.list_flags("u1") == []
