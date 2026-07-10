"""P3 Task A5 — cross-surface filtered-aggregate PARITY test.

The Scope guarantee, made mechanical: ONE FilterSpec ⇒ ONE row universe ⇒
IDENTICAL trade-counts across every aggregate surface. If any surface's WHERE
compiler drifts from the others, the numbers disagree and this test FAILS loudly
(that is its whole job — "filtered numbers disagreeing with totals is the exact
complaint we weaponize against competitors", spec §8).

This is NOT the JS math-parity harness (`app/src/lib/journal-2-0/parity.test.js`,
which stays pure-math). This is a Python-side cross-surface identity test seeded
from a real in-memory-backed DB, exercising the four adapters A2–A4 wired to the
same `FilterSpec`:

  * ``trades.list_trades_for_user``   → total match count
  * ``analytics.get_analytics``       → ``tradeCount`` (+ per-setup ``attribution.bySetup``)
  * ``calendar.get_calendar``         → Σ day ``tradeCount`` over the window
  * ``setup_stats.get_setup_stats``   → Σ per-setup ``tradeCount``

Determinism: a FIXED book (fixed dates/symbols/setups/tags, no ``Date.now`` / no
random). Every exit is stamped mid-day (T18:00:00Z) AND carries an explicit
``trading_day_et`` spine value, so all four surfaces read the identical canonical
``COALESCE(trading_day_et, substr(exit_date,1,10))`` day — legacy-NULL ET-boundary
skew can never confound the counts.

Calendar's date-strip (Task A3): ``get_calendar`` deliberately IGNORES the Scope
date facet (the calendar navigates dates itself). So for the date+side spec we
use option (a) from the task — a calendar window (view=month) whose bounds EQUAL
the spec's date range — so the calendar's own window reproduces the date filter
the other surfaces apply via the spine, and only the non-date facet (side) is
compared through the spec. The two non-date specs use a full-year window that
already covers every seeded trade, so their date facet is a no-op everywhere.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


USER = "u_a5"


@pytest.fixture
def db_conn(monkeypatch):
    """Fresh schema-initialized SQLite (temp file, the journal_two test idiom —
    a shared temp path so auth_db's own connection and the test connection see
    the same DB; ``:memory:`` would give each connection a private database)."""
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


def _seed_account(db_conn):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(USER, conn=db_conn)


def _add_trade(
    conn, *, account_id,
    symbol, side, setup, day,
    mistake_tags=None, emotion_tags=None,
    result="Win", pnl=100, r=1.5,
):
    """Insert one closed equity trade. ``day`` = the ET trading day; the exit is
    stamped mid-day (T18:00:00Z, = 14:00 EDT, safely inside that ET session) AND
    ``trading_day_et`` is set to ``day`` so the date spine is unambiguous on every
    surface. Mirrors the ``_add_trade`` idiom used across the journal_two tests."""
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    exit_iso = f"{day}T18:00:00Z"
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
            tid, USER, symbol, side, exit_iso, exit_iso,
            setup, pnl, r, result, account_id, now,
            day, mistake_tags, emotion_tags,
        ),
    )
    conn.commit()
    return tid


# ── The deterministic book (12 trades, one account) ──────────────────────────
# symbol | side  | setup | ET day     | mistake_tags | emotion_tags
_BOOK = [
    ("NVDA", "Long",  "VCP", "2026-04-10", '["fomo"]',    None),
    ("NVDA", "Long",  "VCP", "2026-04-15", None,          '["greedy"]'),
    ("NVDA", "Short", "EP",  "2026-05-05", None,          None),
    ("NVDA", "Long",  "HTF", "2026-05-12", '["fomo"]',    None),
    ("AMD",  "Long",  "VCP", "2026-04-20", '["fomo"]',    None),
    ("AMD",  "Short", "EP",  "2026-05-08", None,          None),
    ("AMD",  "Long",  "HTF", "2026-06-03", None,          '["calm"]'),
    ("TSLA", "Long",  "VCP", "2026-05-18", None,          '["fomo"]'),   # fomo via EMOTION col (OR path)
    ("TSLA", "Short", "EP",  "2026-05-22", '["revenge"]', None),
    ("TSLA", "Long",  "HTF", "2026-06-10", None,          None),
    ("NVDA", "Long",  "VCP", "2026-05-25", None,          None),
    ("MSFT", "Short", "EP",  "2026-05-14", '["fomo"]',    None),
]


def _seed_book(db_conn, account_id):
    for symbol, side, setup, day, mtags, etags in _BOOK:
        _add_trade(
            db_conn, account_id=account_id,
            symbol=symbol, side=side, setup=setup, day=day,
            mistake_tags=mtags, emotion_tags=etags,
        )


# ── The cross-surface identity assertion ─────────────────────────────────────


def _assert_surfaces_agree(db_conn, account_id, spec, *, calendar_kwargs, expected):
    """Assert the trade-count derived from all four Scope-aware surfaces AGREES
    for ``spec`` (and equals the independently-computed ``expected``), plus the
    strong per-setup identity between analytics attribution and setup_stats."""
    from api.services.journal_two import analytics as analytics_service
    from api.services.journal_two import setup_stats
    from api.services.journal_two.calendar import get_calendar
    from api.services.journal_two.trades import list_trades_for_user

    # 1) list_trades_for_user → (rows, total). With no page limit, len == total.
    trades, total = list_trades_for_user(
        USER, conn=db_conn, account_id=account_id, spec=spec,
    )
    assert len(trades) == total, "list total must equal the returned unbounded page"
    list_count = total

    # 2) analytics → tradeCount + per-setup attribution.
    analytics = analytics_service.get_analytics(
        USER, account_id=account_id, spec=spec, conn=db_conn,
    )
    analytics_count = analytics["tradeCount"]
    by_setup = analytics["attribution"]["bySetup"]

    # 3) calendar → Σ day tradeCount over the (date-facet-stripped) window. For
    #    the date+side spec the window (view=month) EQUALS the spec's date range,
    #    reproducing the date filter the other surfaces apply via the spine.
    calendar = get_calendar(
        USER, account_id=account_id, spec=spec, conn=db_conn, **calendar_kwargs,
    )
    calendar_count = sum(d["tradeCount"] for d in calendar["days"])

    # 4) setup_stats → Σ per-setup tradeCount over the setups present. Every
    #    seeded trade carries a non-null setup, so this sum reconstructs the whole
    #    filtered universe (a null-setup row would be invisible to setup_stats).
    setup_stats_sum = 0
    for entry in by_setup:
        s = entry["setup"]
        card = setup_stats.get_setup_stats(
            USER, account_id, s, spec=spec, conn=db_conn,
        )
        # Per-setup identity: the analytics attribution count for a setup MUST
        # equal setup_stats' count for that same (account, setup, spec).
        assert card["tradeCount"] == entry["tradeCount"], (
            f"setup_stats vs analytics disagree for setup {s!r}: "
            f"{card['tradeCount']} != {entry['tradeCount']}"
        )
        setup_stats_sum += card["tradeCount"]

    # The whole point: same FilterSpec ⇒ identical row universe ⇒ identical counts.
    assert list_count == expected, f"list count {list_count} != expected {expected}"
    assert analytics_count == list_count, (
        f"analytics {analytics_count} != list {list_count}"
    )
    assert calendar_count == list_count, (
        f"calendar {calendar_count} != list {list_count}"
    )
    assert setup_stats_sum == list_count, (
        f"setup_stats Σ {setup_stats_sum} != list {list_count}"
    )


# ── Spec 1: symbol-only ──────────────────────────────────────────────────────


def test_parity_symbol_only(db_conn):
    """symbol=NVDA → the 5 NVDA trades agree across every surface. No date facet,
    so the calendar's full-year window covers the whole book."""
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _seed_book(db_conn, acc["id"])

    _assert_surfaces_agree(
        db_conn, acc["id"],
        FilterSpec(symbol="NVDA"),
        calendar_kwargs={"view": "year", "year": 2026},
        expected=5,
    )


# ── Spec 2: setup + tag ──────────────────────────────────────────────────────


def test_parity_setup_and_tag(db_conn):
    """setups=[VCP] + tags=[fomo] → 3 trades (fomo matched via the mistake col on
    2 and the EMOTION col on 1, exercising the json_each OR across both columns).
    No date facet → full-year calendar window."""
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _seed_book(db_conn, acc["id"])

    _assert_surfaces_agree(
        db_conn, acc["id"],
        FilterSpec(setups=["VCP"], tags=["fomo"]),
        calendar_kwargs={"view": "year", "year": 2026},
        expected=3,
    )


# ── Spec 3: date + side (calendar date-strip handled via option (a)) ─────────


def test_parity_date_and_side(db_conn):
    """date May 2026 + side=Long → 3 trades. The calendar IGNORES the spec date
    facet, so we query view=month/month=5 — a window whose bounds EQUAL the spec's
    date range — so the calendar reproduces the same date filter the spine applies
    on the other surfaces, and only the non-date facet (side=Long) rides the spec."""
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _seed_book(db_conn, acc["id"])

    _assert_surfaces_agree(
        db_conn, acc["id"],
        FilterSpec(date_from="2026-05-01", date_to="2026-05-31", sides=["Long"]),
        calendar_kwargs={"view": "month", "year": 2026, "month": 5},
        expected=3,
    )


# ── Empty spec: the totals baseline (all four surfaces see the whole book) ────


def test_parity_empty_spec_is_full_book(db_conn):
    """An empty FilterSpec ⇒ the unfiltered universe ⇒ all 12 trades agree across
    every surface. This is the 'filtered numbers agree with the totals' baseline
    the whole guarantee rests on."""
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _seed_book(db_conn, acc["id"])

    _assert_surfaces_agree(
        db_conn, acc["id"],
        FilterSpec(),
        calendar_kwargs={"view": "year", "year": 2026},
        expected=12,
    )
