"""Live-composition sentinel — the between-sync conservation law.

The 2026-08-26 incident shape is the pinned regression: stale cash paired
with a live book composed $21,763 on a $10,772 account, no rail looked at
the composed number, and the display could not be reconstructed afterward.
The sentinel must (1) call that shape STRUCTURAL, (2) stay quiet on honest
books, (3) classify "fill moved cash, row not served yet" as book_lag
without paging (a rail that cries wolf on every intraday buy is worse than
none), and (4) persist the component snapshot so the next anomaly is
debuggable from data instead of deduction.
"""

from __future__ import annotations

import json

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import activities_store, live_sentinel


USER = "u1"
BACCT = "ba1"
J2 = "j2a"
# Anchor + fill stamps are CLOCK-RELATIVE: the sentinel skips anchors older
# than 36h, so a wall-clock-pinned fixture rots into "skipped" as real time
# passes (it did, the same day it was written). The incident's QUANTITIES and
# PRICES are the regression; its absolute dates never were.
from datetime import datetime, timedelta, timezone

_NOW = datetime.now(timezone.utc)
SYNCED = (_NOW - timedelta(hours=4)).isoformat()


def _after_sync(minutes):
    return (_NOW - timedelta(hours=4) + timedelta(minutes=minutes)).isoformat()


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    live_sentinel._reset_for_tests()
    return {}


def _seed_account(*, cash, mv, equity, synced_at=SYNCED):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance,"
        " account_size, balance_source, broker_cash, broker_market_value,"
        " broker_total_equity, broker_balance_synced_at, created_at, updated_at)"
        " VALUES (?, ?, 'RH', '#c9a84c', 1.0, ?, 'broker', ?, ?, ?, ?,"
        " '2026-01-01', '2026-01-01')",
        (J2, USER, equity if equity is not None else 0.0, cash, mv, equity,
         synced_at),
    )
    conn.commit()
    conn.close()


def _seed_position(sym, shares, mark, *, entry=None, source="broker"):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date,"
        " shares, original_shares, entry_price, stop_price, breakeven_stop,"
        " raise_to_breakeven, setup, notes, context_at_entry, created_at,"
        " updated_at, closed_at, account_id, source, external_id,"
        " entry_estimated, broker_price)"
        " VALUES (?, ?, ?, 'Long', '2026-08-01', ?, ?, ?, ?, NULL, 0, NULL,"
        " NULL, '{}', '2026-08-01', '2026-08-01', NULL, ?, ?, ?, 0, ?)",
        (f"pos-{sym}", USER, sym, shares, shares, entry or mark, entry or mark,
         J2, source, f"bkpos:{BACCT}:{sym}:Long", mark),
    )
    conn.commit()
    conn.close()


def _fill(act_id, typ, sym, units, price, trade_date):
    return {"id": act_id, "type": typ, "units": units, "price": price,
            "fee": 0, "symbol": {"symbol": sym}, "trade_date": trade_date,
            "currency": "USD"}


def _check():
    conn = auth_db.get_connection()
    try:
        return live_sentinel.check_account(USER, BACCT, J2, conn)
    finally:
        conn.close()


def test_clean_book_is_ok(env):
    # book_synced == served book at sync marks, no fills → residual 0.
    _seed_account(cash=-18760.66, mv=29010.55, equity=10724.0)
    _seed_position("ORCL", 100, 148.87)
    _seed_position("NEXA", 750, 15.58)
    _seed_position("DELL", 5, 463.69)
    _seed_position("SPY", 0.1568, 765.95)
    out = _check()
    assert out["verdict"] == "ok"
    assert abs(out["residual"]) <= out["tolerance"]


def test_incident_shape_is_structural(env):
    """2026-08-26: the book carries the SNAP fill's value while cash never
    moved and the ledger holds no explaining fill — a composed number that
    manufactures equity. STRUCTURAL."""
    _seed_account(cash=-18760.66, mv=29010.55, equity=10724.0)
    _seed_position("ORCL", 100, 148.87)
    _seed_position("NEXA", 750, 15.58)
    _seed_position("DELL", 5, 463.69)
    _seed_position("SPY", 0.1568, 765.95)
    # The phantom: 2000 SNAP served at 5.4241 with NO ledger fill behind it.
    _seed_position("SNAP", 2000, 5.4241, entry=5.495)
    out = _check()
    assert out["verdict"] == "structural"
    assert out["residual"] == pytest.approx(10848.2, abs=1.0)


def test_served_fill_with_derived_cash_is_ok(env):
    """The post-fix healthy intraday state: the fill is in the ledger, cash
    derives forward, the row is served — conservation holds."""
    _seed_account(cash=-18760.66, mv=29010.55, equity=10724.0)
    _seed_position("ORCL", 100, 148.87)
    _seed_position("NEXA", 750, 15.58)
    _seed_position("DELL", 5, 463.69)
    _seed_position("SPY", 0.1568, 765.95)
    _seed_position("SNAP", 2000, 5.4241, entry=5.495)
    activities_store.store_activities(USER, BACCT, [
        _fill("intraday:snap", "BUY", "SNAP", 2000.0, 5.495,
              _after_sync(30)),
    ])
    out = _check()
    assert out["verdict"] == "ok"


def test_fill_in_cash_but_not_in_book_is_book_lag_not_a_page(env):
    """A buy whose row hasn't reached the served book yet: cash moved, book
    didn't. Real display understatement, clears at next sync — recorded as
    book_lag, never structural."""
    _seed_account(cash=-18760.66, mv=29010.55, equity=10724.0)
    _seed_position("ORCL", 100, 148.87)
    _seed_position("NEXA", 750, 15.58)
    _seed_position("DELL", 5, 463.69)
    _seed_position("SPY", 0.1568, 765.95)
    activities_store.store_activities(USER, BACCT, [
        _fill("intraday:snap", "BUY", "SNAP", 2000.0, 5.495,
              _after_sync(30)),
    ])
    out = _check()
    assert out["verdict"] == "book_lag"


def test_no_anchor_is_skipped(env):
    _seed_account(cash=None, mv=None, equity=None, synced_at=None)
    out = _check()
    assert out["verdict"] == "skipped"


def test_structural_pages_only_after_two_consecutive(env, monkeypatch):
    _seed_account(cash=-18760.66, mv=29010.55, equity=10724.0)
    _seed_position("SNAP", 2000, 5.4241, entry=5.495)
    _seed_position("ORCL", 100, 148.87)
    _seed_position("NEXA", 750, 15.58)
    _seed_position("DELL", 5, 463.69)
    _seed_position("SPY", 0.1568, 765.95)
    pages = []
    monkeypatch.setattr(live_sentinel, "_post_discord",
                        lambda title, desc: pages.append(title))
    conn = auth_db.get_connection()
    try:
        out = live_sentinel.check_account(USER, BACCT, J2, conn)
        fails = live_sentinel._persist(conn, USER, BACCT, out)
        live_sentinel._maybe_page(USER, BACCT, out, fails)
        assert pages == []                       # first miss: recorded only
        out = live_sentinel.check_account(USER, BACCT, J2, conn)
        fails = live_sentinel._persist(conn, USER, BACCT, out)
        live_sentinel._maybe_page(USER, BACCT, out, fails)
        assert len(pages) == 1                   # second consecutive: page
        # Flight recorder: the persisted row carries the component snapshot.
        row = conn.execute(
            "SELECT verdict, components_json FROM j2_broker_live_checks "
            "WHERE user_id = ? AND broker_account_id = ?", (USER, BACCT),
        ).fetchone()
        assert row["verdict"] == "structural"
        snap = json.loads(row["components_json"])
        assert any(p.get("sym") == "SNAP" for p in snap["servedBook"])
    finally:
        conn.close()


def test_ok_resets_the_consecutive_counter(env):
    _seed_account(cash=-1000.0, mv=500.0, equity=1000.0)
    _seed_position("AAPL", 5, 100.0)
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_live_checks (user_id, broker_account_id,"
            " checked_at, verdict, residual_dollar, consecutive_fails)"
            " VALUES (?, ?, '2026-08-26T15:00:00Z', 'structural', 999, 1)",
            (USER, BACCT))
        conn.commit()
        out = live_sentinel.check_account(USER, BACCT, J2, conn)
        assert out["verdict"] == "ok"
        fails = live_sentinel._persist(conn, USER, BACCT, out)
        assert fails == 0
    finally:
        conn.close()


def test_kill_switch(env, monkeypatch):
    monkeypatch.setenv("BROKER_LIVE_SENTINEL_ENABLED", "0")
    assert live_sentinel.run_sentinel_sweep() == {"skipped": True}


def test_a_members_manual_row_in_a_broker_account_never_reads_as_drift(env):
    """Mirror purity: the composition (both lanes) excludes non-broker rows
    from a broker account's book, so a member hand-tracking something in
    their broker account cannot page the owner as structural drift."""
    _seed_account(cash=-1000.0, mv=500.0, equity=1000.0)
    _seed_position("AAPL", 5, 100.0)                       # broker row = book_s
    _seed_position("GME", 1000, 25.0, source=None)         # manual row
    out = _check()
    assert out["verdict"] == "ok"
    assert abs(out["residual"]) <= out["tolerance"]


# ── the weekly drill: prove the guard fires ──────────────────────────────────

def test_drill_detects_the_injected_incident_and_cleans_up(env):
    out = live_sentinel.run_drill()
    assert out["passed"] is True
    assert out["verdicts"] == ["structural", "structural"]
    assert out["consecutive"] >= 2
    assert out["residual"] == pytest.approx(10990.0, abs=1.0)
    conn = auth_db.get_connection()
    try:
        for table in ("j2_positions", "j2_accounts", "j2_broker_live_checks"):
            n = conn.execute(
                f"SELECT COUNT(*) AS n FROM {table} WHERE user_id = ?",
                (live_sentinel._DRILL_USER,)).fetchone()["n"]
            assert n == 0, f"drill residue left in {table}"
    finally:
        conn.close()


def test_drill_failure_posts_the_alarm_not_the_success(env, monkeypatch):
    posts = []
    monkeypatch.setattr(live_sentinel, "_post_discord",
                        lambda t, d: posts.append(t))
    # Sabotage detection: a sentinel that calls everything ok must make the
    # drill SCREAM, not stay silent (gate-that-cannot-fail).
    monkeypatch.setattr(live_sentinel, "check_account",
                        lambda *a, **k: {"verdict": "ok", "residual": 0.0})
    live_sentinel.run_drill_blocking()
    assert len(posts) == 1
    assert "FAILED" in posts[0]


def test_fleet_snapshot_counts_verdicts(env):
    _seed_account(cash=-1000.0, mv=500.0, equity=1000.0)
    _seed_position("AAPL", 5, 100.0)
    conn = auth_db.get_connection()
    try:
        out = live_sentinel.check_account(USER, BACCT, J2, conn)
        live_sentinel._persist(conn, USER, BACCT, out)
        snap = live_sentinel.fleet_snapshot(conn)
    finally:
        conn.close()
    assert snap["accounts"] == 1
    assert snap["byVerdict"] == {"ok": 1}


def test_first_live_morning_regression_mixed_day_is_book_lag_not_structural(env):
    """2026-08-27, the sentinel's first live morning: sold 750 NEXA @13.8917
    (row already removed by the shrink rail — $1,266 below its 15.58 sync
    mark), bought 150 TH @18.89 + two $20 SPY micro-buys (rows not yet
    served). Residual −4,139.70. The v1 all-or-none classifier called that
    structural; the honest verdict is book_lag."""
    _seed_account(cash=-29750.66, mv=40505.53, equity=10754.87,
                  synced_at=SYNCED)
    _seed_position("DELL", 5, 463.69)
    _seed_position("ORCL", 100, 148.87)
    _seed_position("SPY", 0.1568, 765.95)
    _seed_position("SNAP", 2000, 5.415)
    # SNAP call strategy (bcv 665) — seed as a strategy row.
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_option_strategies (id, user_id, account_id, underlying,"
        " strategy_type, direction, net_entry, entry_date, status, source,"
        " external_id, broker_current_value, created_at, updated_at)"
        " VALUES ('snapcall', ?, ?, 'SNAP', 'long_call', 'bullish', 610.0,"
        " '2026-08-17', 'open', 'broker', 'bkopt:x', 665.0, '2026-08-20',"
        " '2026-08-20')", (USER, J2))
    conn.commit()
    conn.close()
    activities_store.store_activities(USER, BACCT, [
        _fill("intraday:nexa", "SELL", "NEXA", 750.0, 13.8917,
              _after_sync(50)),
        _fill("intraday:th", "BUY", "TH", 150.0, 18.89,
              _after_sync(52)),
        _fill("intraday:spy1", "BUY", "SPY", 0.025912, 771.8399,
              _after_sync(60)),
        _fill("intraday:spy2", "BUY", "SPY", 0.025912, 771.8399,
              _after_sync(61)),
    ])
    out = _check()
    assert out["residual"] == pytest.approx(-4139.7, abs=1.0)
    assert out["verdict"] == "book_lag"


def test_a_sell_far_above_its_mark_with_a_phantom_still_reads_structural(env):
    # The band must not stretch far enough to hide the incident class: a
    # phantom worth ~100% of notional sits far outside 25%-of-notional.
    _seed_account(cash=-1000.0, mv=500.0, equity=1000.0)
    _seed_position("AAPL", 5, 100.0)
    _seed_position("GHOST", 100, 110.0)          # phantom, no ledger fill
    activities_store.store_activities(USER, BACCT, [
        _fill("intraday:small", "BUY", "AAPL", 1.0, 100.0,
              _after_sync(35)),
    ])
    out = _check()
    assert out["verdict"] == "structural"


def test_the_page_dedup_survives_a_redeploy(env, monkeypatch):
    """2026-08-27: four same-day deploys each wiped the in-process dedup dict
    and the SAME false alarm paged twice. The dedup is durable now
    (j2_broker_digest_dedup) — a fresh process must not re-page."""
    _seed_account(cash=-18760.66, mv=29010.55, equity=10724.0)
    _seed_position("SNAP", 2000, 5.4241, entry=5.495)
    _seed_position("ORCL", 100, 148.87)
    pages = []
    monkeypatch.setattr(live_sentinel, "_post_discord",
                        lambda t, d: pages.append(t))
    conn = auth_db.get_connection()
    try:
        for _ in range(2):
            out = live_sentinel.check_account(USER, BACCT, J2, conn)
            fails = live_sentinel._persist(conn, USER, BACCT, out)
            live_sentinel._maybe_page(USER, BACCT, out, fails, conn=conn)
        assert len(pages) == 1
        # "Redeploy": in-process state resets — the durable row must hold.
        live_sentinel._reset_for_tests()
        out = live_sentinel.check_account(USER, BACCT, J2, conn)
        fails = live_sentinel._persist(conn, USER, BACCT, out)
        live_sentinel._maybe_page(USER, BACCT, out, fails, conn=conn)
        assert len(pages) == 1          # still one — no repeat page same day
    finally:
        conn.close()


def test_tolerance_is_dollar_capped_for_whale_accounts(env):
    """1.5% of a $1.6M book is $24,594 of invisible error headroom — the
    conservation residual is mark-invariant, so its noise doesn't scale
    with book size. A $5k structural miss on a whale account must flag."""
    _seed_account(cash=1147236.11, mv=494252.50, equity=1639570.60)
    _seed_position("AAPL", 1000, 494.2525)     # 494,252.50 served
    _seed_position("GHOST", 100, 50.0)         # +5,000 phantom, no ledger fill
    out = _check()
    assert out["tolerance"] == 1000.0
    assert out["verdict"] == "structural"


def test_daily_pulse_always_posts_green_or_red(env, monkeypatch):
    posts = []
    monkeypatch.setattr(live_sentinel, "_post_discord",
                        lambda t, d: posts.append((t, d)))
    # Quiet healthy fleet → still posts (silence must never read as health).
    live_sentinel.run_daily_pulse_blocking()
    assert len(posts) == 1 and posts[0][0].startswith("🟢")
    # A structural verdict flips it red.
    _seed_account(cash=-1000.0, mv=500.0, equity=1000.0)
    _seed_position("AAPL", 5, 100.0)
    _seed_position("GHOST", 100, 25.0)
    conn = auth_db.get_connection()
    try:
        out = live_sentinel.check_account(USER, BACCT, J2, conn)
        live_sentinel._persist(conn, USER, BACCT, out)
    finally:
        conn.close()
    live_sentinel.run_daily_pulse_blocking()
    assert len(posts) == 2 and posts[1][0].startswith("🔴")


def test_structural_with_no_fills_self_verifies_with_one_sync(env, monkeypatch):
    """The whale-account lesson: SnapTrade's own payload can be internally
    inconsistent, so a structural verdict with zero fills earns ONE real
    sync before anyone gets paged — and only once per account per day."""
    _seed_account(cash=-1000.0, mv=500.0, equity=1000.0)
    _seed_position("AAPL", 5, 100.0)
    _seed_position("GHOST", 100, 25.0)
    synced = []

    async def _fake_sync(user_id, ba_id, **kw):
        synced.append(ba_id)
        return {}

    import api.services.journal_two.broker.sync as sync_mod
    monkeypatch.setattr(sync_mod, "sync_account", _fake_sync)
    monkeypatch.setattr(live_sentinel, "_in_market_window", lambda *a: True)
    monkeypatch.setattr(live_sentinel, "_post_discord", lambda t, d: None)
    from api.services.journal_two.broker import connections
    monkeypatch.setattr(connections, "list_all_sync_enabled_accounts",
                        lambda: [{"userId": USER, "id": BACCT,
                                  "j2AccountId": J2, "status": "active"}])
    live_sentinel.run_sentinel_sweep()
    assert synced == [BACCT]            # exactly one self-verify sync
    live_sentinel.run_sentinel_sweep()
    assert synced == [BACCT]            # once per day — no re-sync loop


def test_structural_with_fills_never_self_syncs(env, monkeypatch):
    # A residual on a day WITH fills has richer classification (book_lag
    # band) — burning the daily self-sync there wastes the one shot.
    _seed_account(cash=-18760.66, mv=29010.55, equity=10724.0)
    _seed_position("SNAP", 2000, 5.4241, entry=5.495)
    activities_store.store_activities(USER, BACCT, [
        _fill("intraday:snap", "BUY", "SNAP", 2000.0, 5.495, _after_sync(30)),
    ])
    synced = []

    async def _fake_sync(user_id, ba_id, **kw):
        synced.append(ba_id)
        return {}

    import api.services.journal_two.broker.sync as sync_mod
    monkeypatch.setattr(sync_mod, "sync_account", _fake_sync)
    monkeypatch.setattr(live_sentinel, "_in_market_window", lambda *a: True)
    monkeypatch.setattr(live_sentinel, "_post_discord", lambda t, d: None)
    from api.services.journal_two.broker import connections
    monkeypatch.setattr(connections, "list_all_sync_enabled_accounts",
                        lambda: [{"userId": USER, "id": BACCT,
                                  "j2AccountId": J2, "status": "active"}])
    live_sentinel.run_sentinel_sweep()
    assert synced == []
