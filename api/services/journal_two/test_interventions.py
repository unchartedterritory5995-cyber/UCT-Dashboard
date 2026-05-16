"""Tests for the intervention rule engine."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone, timedelta
import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_i"):
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    db_conn.execute(
        """UPDATE j2_accounts
           SET account_size = ?, daily_loss_limit_pct = ?,
               cooling_off_minutes_after_loss = ?
           WHERE id = ?""",
        (100000.0, 3.0, 30, acc["id"]),
    )
    db_conn.commit()
    return acc


def _insert_closed_trade(conn, *, user_id, account_id, exit_iso, result="Win",
                          pnl_dollar=500, r_multiple=1.0):
    tid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees, regime)
           VALUES (?, ?, ?, 'NVDA', 'Long', 100, 100.0, ?, 105.0, ?, 98.0,
           'Bull Flag', NULL, ?, ?, ?, 0, ?, '{}', ?, ?, '[]', '[]', 0, NULL)""",
        (tid, user_id, str(uuid.uuid4()),
         exit_iso, exit_iso, pnl_dollar, pnl_dollar / 1000.0, r_multiple, result,
         exit_iso, account_id),
    )
    conn.commit()
    return tid


# ── rapid_fire_trading ──────────────────────────────────────────────────────


def test_rapid_fire_fires_when_3_trades_in_60min(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    for offset_min in (5, 15, 30):
        _insert_closed_trade(
            db_conn, user_id="u_i", account_id=acc["id"],
            exit_iso=(now - timedelta(minutes=offset_min)).isoformat(),
        )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "rapid_fire_trading" in rules


def test_rapid_fire_does_not_fire_for_2_trades(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    for offset_min in (5, 15):
        _insert_closed_trade(
            db_conn, user_id="u_i", account_id=acc["id"],
            exit_iso=(now - timedelta(minutes=offset_min)).isoformat(),
        )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "rapid_fire_trading" not in rules


# ── daily_loss_approach ─────────────────────────────────────────────────────


def test_daily_loss_approach_fires_at_75pct_of_limit(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    # Limit is 3% of 100k = $3000. 75% = $2250. Insert losses summing to -$2500.
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T14:00:00+00:00",
        result="Loss", pnl_dollar=-2500, r_multiple=-2.5,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "daily_loss_approach" in rules


def test_daily_loss_approach_no_fire_when_well_below(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T14:00:00+00:00",
        result="Loss", pnl_dollar=-500, r_multiple=-0.5,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "daily_loss_approach" not in rules


# ── loss_streak ─────────────────────────────────────────────────────────────


def test_loss_streak_fires_at_3_consecutive(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    for h in (10, 11, 13):
        _insert_closed_trade(
            db_conn, user_id="u_i", account_id=acc["id"],
            exit_iso=f"{today_iso}T{h:02d}:00:00+00:00",
            result="Loss", pnl_dollar=-200, r_multiple=-1.0,
        )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "loss_streak" in rules


def test_loss_streak_does_not_fire_with_winner_between(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T10:00:00+00:00",
        result="Loss", pnl_dollar=-200,
    )
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T11:00:00+00:00",
        result="Win", pnl_dollar=500,
    )
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T12:00:00+00:00",
        result="Loss", pnl_dollar=-200,
    )
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T13:00:00+00:00",
        result="Loss", pnl_dollar=-200,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "loss_streak" not in rules


# ── cooling_off_active ──────────────────────────────────────────────────────


def test_cooling_off_fires_within_window(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)  # cooling_off = 30 min
    # Insert loss 10 min ago — within window
    now = datetime.now(timezone.utc)
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=10)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "cooling_off_active" in rules


def test_cooling_off_does_not_fire_after_window(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    # Loss 60 min ago — outside the 30-min cooling-off window
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=60)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "cooling_off_active" not in rules


# ── persistence + dismissal ─────────────────────────────────────────────────


def test_evaluate_persists_fired_interventions(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=10)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_interventions").fetchone()["n"]
    assert n >= 1


def test_dismiss_intervention_marks_dismissed(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=10)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    assert len(results) > 0
    iid = results[0]["id"]
    iv.dismiss_intervention(intervention_id=iid, user_id="u_i", conn=db_conn)
    row = db_conn.execute(
        "SELECT dismissed_at FROM j2_interventions WHERE id = ?", (iid,)
    ).fetchone()
    assert row["dismissed_at"] is not None


def test_evaluate_respects_cooldown_no_duplicate_firings(db_conn):
    """A rule that just fired won't fire again until its cooldown elapses."""
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=10)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    iv.evaluate_interventions(user_id="u_i", account_id=acc["id"], conn=db_conn)
    n1 = db_conn.execute("SELECT COUNT(*) AS n FROM j2_interventions").fetchone()["n"]
    iv.evaluate_interventions(user_id="u_i", account_id=acc["id"], conn=db_conn)
    n2 = db_conn.execute("SELECT COUNT(*) AS n FROM j2_interventions").fetchone()["n"]
    assert n2 == n1  # No new firings during cooldown


# ── Portfolio-level (unified '_all_') tilt rules ────────────────────────────


def _seed_named_account(db_conn, user_id, name, *, daily_loss_pct=None):
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.create_account(
        user_id,
        {"name": name, "color": "blue", "startingBalance": 100000},
        conn=db_conn,
    )
    if daily_loss_pct is not None:
        db_conn.execute(
            "UPDATE j2_accounts SET account_size = 100000, daily_loss_limit_pct = ? WHERE id = ?",
            (daily_loss_pct, acc["id"]),
        )
        db_conn.commit()
    return acc


def test_portfolio_loss_streak_fires_across_accounts(db_conn):
    from api.services.journal_two import interventions as iv
    a1 = _seed_named_account(db_conn, "u_pf", "Default")
    a2 = _seed_named_account(db_conn, "u_pf", "Cash")
    now = datetime.now(timezone.utc)
    # 4 losses interleaved across the two accounts, newest last
    for i, acc in enumerate([a1, a2, a1, a2]):
        _insert_closed_trade(
            db_conn, user_id="u_pf", account_id=acc["id"],
            exit_iso=(now - timedelta(minutes=40 - i * 5)).isoformat(),
            result="Loss", pnl_dollar=-100, r_multiple=-1.0,
        )
    active = iv.evaluate_interventions(user_id="u_pf", account_id="_all_", conn=db_conn)
    rules = {a["rule"] for a in active}
    assert "portfolio_loss_streak" in rules


def test_portfolio_loss_streak_does_not_fire_with_only_3(db_conn):
    from api.services.journal_two import interventions as iv
    a1 = _seed_named_account(db_conn, "u_pf2", "Default")
    a2 = _seed_named_account(db_conn, "u_pf2", "Cash")
    now = datetime.now(timezone.utc)
    for i, acc in enumerate([a1, a2, a1]):
        _insert_closed_trade(
            db_conn, user_id="u_pf2", account_id=acc["id"],
            exit_iso=(now - timedelta(minutes=30 - i * 5)).isoformat(),
            result="Loss", pnl_dollar=-100, r_multiple=-1.0,
        )
    active = iv.evaluate_interventions(user_id="u_pf2", account_id="_all_", conn=db_conn)
    assert "portfolio_loss_streak" not in {a["rule"] for a in active}


def test_portfolio_daily_loss_sums_thresholds(db_conn):
    from api.services.journal_two import interventions as iv
    # Two accounts, each 100k @ 2% daily limit → each 75% threshold = -1500,
    # combined = -3000. Lose 1800 in each = -3600 total → fires.
    a1 = _seed_named_account(db_conn, "u_pf3", "Default", daily_loss_pct=2.0)
    a2 = _seed_named_account(db_conn, "u_pf3", "Cash", daily_loss_pct=2.0)
    today = datetime.now(timezone.utc)
    _insert_closed_trade(db_conn, user_id="u_pf3", account_id=a1["id"],
                         exit_iso=today.isoformat(), result="Loss",
                         pnl_dollar=-1800, r_multiple=-1.0)
    _insert_closed_trade(db_conn, user_id="u_pf3", account_id=a2["id"],
                         exit_iso=today.isoformat(), result="Loss",
                         pnl_dollar=-1800, r_multiple=-1.0)
    active = iv.evaluate_interventions(user_id="u_pf3", account_id="_all_", conn=db_conn)
    assert "portfolio_daily_loss" in {a["rule"] for a in active}


def test_portfolio_rules_persist_under_all_bucket(db_conn):
    """Firings recorded with account_id='_all_' so list_active('_all_') reads them."""
    from api.services.journal_two import interventions as iv
    a1 = _seed_named_account(db_conn, "u_pf4", "Default")
    a2 = _seed_named_account(db_conn, "u_pf4", "Cash")
    now = datetime.now(timezone.utc)
    for i, acc in enumerate([a1, a2, a1, a2]):
        _insert_closed_trade(
            db_conn, user_id="u_pf4", account_id=acc["id"],
            exit_iso=(now - timedelta(minutes=20 - i * 3)).isoformat(),
            result="Loss", pnl_dollar=-100, r_multiple=-1.0,
        )
    iv.evaluate_interventions(user_id="u_pf4", account_id="_all_", conn=db_conn)
    listed = iv.list_active(user_id="u_pf4", account_id="_all_", conn=db_conn)
    assert any(a["rule"] == "portfolio_loss_streak" for a in listed)


def test_single_account_mode_unaffected_by_portfolio_rules(db_conn):
    """Per-account evaluate still uses the original 4 rules, not portfolio ones."""
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn, "u_pf5")
    now = datetime.now(timezone.utc)
    for i in range(3):
        _insert_closed_trade(
            db_conn, user_id="u_pf5", account_id=acc["id"],
            exit_iso=(now - timedelta(minutes=30 - i * 5)).isoformat(),
            result="Loss", pnl_dollar=-100, r_multiple=-1.0,
        )
    active = iv.evaluate_interventions(user_id="u_pf5", account_id=acc["id"], conn=db_conn)
    rules = {a["rule"] for a in active}
    assert "loss_streak" in rules
    assert not any(r.startswith("portfolio_") for r in rules)
