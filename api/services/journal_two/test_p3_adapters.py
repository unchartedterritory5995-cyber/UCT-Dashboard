"""P3 Task A4 — Scope (FilterSpec) adapters for the four remaining aggregate
surfaces: options.list_strategies, setup_stats.get_setup_stats,
accounts.comparison, accounts.goal_progress.

Deliberately independent of test_options.py's time-brittle past-expiration
fixtures: option strategies here use far-future expirations via `_exp_iso`, and
every other surface is equity-only. Each surface is checked two ways: a facet
narrows the aggregate as expected, and an empty/absent spec leaves it unchanged.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import date as Date, datetime, timedelta, timezone

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


def _exp_iso(days_from_now: int) -> str:
    """Future leg expiration so the past-expiration guard never rejects it."""
    return (Date.today() + timedelta(days=days_from_now)).isoformat()


def _seed_account(db_conn, user_id="u_a4"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _add_trade(
    conn, *, user_id, account_id,
    symbol="NVDA", side="Long", setup="VCP",
    result="Win", pnl=100, r=1.5,
    exit_iso="2026-04-19T18:00:00Z", trading_day_et=None,
    mistake_tags=None, emotion_tags=None,
):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at, trading_day_et, hour_et,
            mistake_tags, emotion_tags
        ) VALUES (?, ?, 'manual', ?, ?, 100, 500, ?, 510, ?,
                  490, ?, NULL, ?, 0.02, ?, 1, ?, '{}', ?, ?, ?, NULL, ?, ?)
        """,
        (
            tid, user_id, symbol, side, exit_iso, exit_iso,
            setup, pnl, r, result, account_id, now,
            trading_day_et, mistake_tags, emotion_tags,
        ),
    )
    conn.commit()
    return tid


def _make_strategy(db_conn, *, user_id, account_id, underlying,
                   entry_date="2026-04-10", exp_days=120):
    from api.services.journal_two import options as options_service
    return options_service.create_strategy(
        user_id,
        {
            "underlying": underlying,
            "strategy_type": "long_call",
            "direction": "bullish",
            "entry_date": entry_date,
            "legs": [{
                "side": "buy", "contract_type": "call", "strike": 200,
                "expiration": _exp_iso(exp_days), "qty": 1, "entry_price": 5,
            }],
        },
        account_id=account_id,
        conn=db_conn,
    )


# ── Surface 1: options.list_strategies (symbol-only on `underlying`) ──────────


def test_options_symbol_facet_narrows_to_underlying(db_conn):
    from api.services.journal_two import options as options_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _make_strategy(db_conn, user_id="u_a4", account_id=acc["id"], underlying="NVDA")
    _make_strategy(db_conn, user_id="u_a4", account_id=acc["id"], underlying="AMD")

    got = options_service.list_strategies(
        "u_a4", spec=FilterSpec(symbol="nvda"), conn=db_conn,
    )
    assert {s["underlying"] for s in got} == {"NVDA"}


def test_options_empty_spec_returns_all(db_conn):
    from api.services.journal_two import options as options_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _make_strategy(db_conn, user_id="u_a4", account_id=acc["id"], underlying="NVDA")
    _make_strategy(db_conn, user_id="u_a4", account_id=acc["id"], underlying="AMD")

    baseline = options_service.list_strategies("u_a4", conn=db_conn)
    via_empty = options_service.list_strategies(
        "u_a4", spec=FilterSpec(), conn=db_conn,
    )
    assert len(baseline) == 2
    assert [s["id"] for s in via_empty] == [s["id"] for s in baseline]


def test_options_non_symbol_facets_do_not_filter_strategies(db_conn):
    """A3 precedent: side/setups/tags have no strategy analog → ignored. A spec
    carrying only those facets must leave the strategy list unchanged."""
    from api.services.journal_two import options as options_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _make_strategy(db_conn, user_id="u_a4", account_id=acc["id"], underlying="NVDA")
    _make_strategy(db_conn, user_id="u_a4", account_id=acc["id"], underlying="AMD")

    got = options_service.list_strategies(
        "u_a4",
        spec=FilterSpec(sides=["Short"], setups=["ZZZ"], tags=["fomo"]),
        conn=db_conn,
    )
    assert len(got) == 2


def test_options_scope_date_facet_applies(db_conn):
    """Unlike calendar, /options is a date-ranged list → the Scope date facet
    filters (on entry_date), it is NOT stripped."""
    from api.services.journal_two import options as options_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _make_strategy(db_conn, user_id="u_a4", account_id=acc["id"],
                   underlying="NVDA", entry_date="2026-04-10")
    _make_strategy(db_conn, user_id="u_a4", account_id=acc["id"],
                   underlying="AMD", entry_date="2026-06-10")

    got = options_service.list_strategies(
        "u_a4", spec=FilterSpec(date_from="2026-05-01"), conn=db_conn,
    )
    assert {s["underlying"] for s in got} == {"AMD"}


# ── Surface 2: setup_stats.get_setup_stats (full non-date + date facets) ──────


def test_setup_stats_symbol_facet_narrows(db_conn):
    from api.services.journal_two import setup_stats
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="VCP", symbol="NVDA", pnl=100)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="VCP", symbol="NVDA", pnl=50)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="VCP", symbol="AMD", pnl=25)

    out = setup_stats.get_setup_stats(
        "u_a4", acc["id"], "VCP", spec=FilterSpec(symbol="nvda"), conn=db_conn,
    )
    assert out["tradeCount"] == 2
    assert out["totalPnlDollar"] == 150


def test_setup_stats_scope_setups_composes_with_card(db_conn):
    """The `setup` arg picks the card; the Scope `setups` facet composes
    (AND), narrowing the row universe further — a disjoint setups facet → 0."""
    from api.services.journal_two import setup_stats
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="VCP", symbol="NVDA")
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="EP", symbol="TSLA")

    out = setup_stats.get_setup_stats(
        "u_a4", acc["id"], "VCP", spec=FilterSpec(setups=["EP"]), conn=db_conn,
    )
    assert out["tradeCount"] == 0


def test_setup_stats_tag_facet_applies(db_conn):
    from api.services.journal_two import setup_stats
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="VCP",
               symbol="NVDA", mistake_tags='["fomo"]')
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="VCP",
               symbol="AMD", mistake_tags='["revenge"]')

    out = setup_stats.get_setup_stats(
        "u_a4", acc["id"], "VCP", spec=FilterSpec(tags=["fomo"]), conn=db_conn,
    )
    assert out["tradeCount"] == 1


def test_setup_stats_empty_spec_unchanged(db_conn):
    from api.services.journal_two import setup_stats
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="VCP", symbol="NVDA")
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], setup="VCP", symbol="AMD")

    baseline = setup_stats.get_setup_stats("u_a4", acc["id"], "VCP", conn=db_conn)
    via_empty = setup_stats.get_setup_stats(
        "u_a4", acc["id"], "VCP", spec=FilterSpec(), conn=db_conn,
    )
    assert baseline["tradeCount"] == 2
    assert via_empty == baseline


# ── Surface 3: accounts.comparison (full non-date + date facets) ─────────────


def _comparison_account(out, account_id):
    return next(a for a in out["accounts"] if a["id"] == account_id)


def test_comparison_symbol_facet_narrows(db_conn):
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="NVDA", setup="VCP", pnl=100)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="NVDA", setup="VCP", pnl=200)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="AMD", setup="EP", pnl=50)

    out = accounts_service.comparison(
        "u_a4", spec=FilterSpec(symbol="nvda"), conn=db_conn,
    )
    a = _comparison_account(out, acc["id"])
    assert a["tradeCount"] == 2
    assert a["totalPnl"] == 300


def test_comparison_setup_facet_narrows(db_conn):
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="NVDA", setup="VCP", pnl=100)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="AMD", setup="EP", pnl=50)

    out = accounts_service.comparison(
        "u_a4", spec=FilterSpec(setups=["VCP"]), conn=db_conn,
    )
    a = _comparison_account(out, acc["id"])
    assert a["tradeCount"] == 1
    assert a["totalPnl"] == 100


def test_comparison_empty_spec_unchanged(db_conn):
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="NVDA", setup="VCP", pnl=100)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="AMD", setup="EP", pnl=50)

    baseline = accounts_service.comparison("u_a4", conn=db_conn)
    via_empty = accounts_service.comparison("u_a4", spec=FilterSpec(), conn=db_conn)
    assert _comparison_account(baseline, acc["id"])["tradeCount"] == 2
    assert via_empty == baseline


# ── Surface 4: accounts.goal_progress (date-bucketed on the spine) ───────────


def _today_et_iso():
    from api.services.journal_two.calendar import ET
    return datetime.now(ET).date().isoformat()


def test_goal_progress_symbol_facet_narrows(db_conn):
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    today = _today_et_iso()
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="NVDA",
               setup="VCP", pnl=600, exit_iso=today + "T18:00:00Z", trading_day_et=today)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="AMD",
               setup="EP", pnl=300, exit_iso=today + "T18:00:00Z", trading_day_et=today)

    got = accounts_service.goal_progress(
        "u_a4", acc["id"], spec=FilterSpec(symbol="nvda"), conn=db_conn,
    )
    assert got["periods"]["daily"]["pnl"] == 600
    assert got["periods"]["yearly"]["pnl"] == 600


def test_goal_progress_setup_facet_narrows(db_conn):
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    today = _today_et_iso()
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="NVDA",
               setup="VCP", pnl=600, exit_iso=today + "T18:00:00Z", trading_day_et=today)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="AMD",
               setup="EP", pnl=300, exit_iso=today + "T18:00:00Z", trading_day_et=today)

    got = accounts_service.goal_progress(
        "u_a4", acc["id"], spec=FilterSpec(setups=["VCP"]), conn=db_conn,
    )
    assert got["periods"]["daily"]["pnl"] == 600


def test_goal_progress_empty_spec_unchanged(db_conn):
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    today = _today_et_iso()
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="NVDA",
               setup="VCP", pnl=600, exit_iso=today + "T18:00:00Z", trading_day_et=today)
    _add_trade(db_conn, user_id="u_a4", account_id=acc["id"], symbol="AMD",
               setup="EP", pnl=300, exit_iso=today + "T18:00:00Z", trading_day_et=today)

    baseline = accounts_service.goal_progress("u_a4", acc["id"], conn=db_conn)
    via_empty = accounts_service.goal_progress(
        "u_a4", acc["id"], spec=FilterSpec(), conn=db_conn,
    )
    assert baseline["periods"]["daily"]["pnl"] == 900
    assert via_empty == baseline
