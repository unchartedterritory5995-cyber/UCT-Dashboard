"""Calendar — aggregation, day notes, ET bucketing."""

import json
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _add_user(conn, user_id, email):
    conn.execute(
        "INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')",
        (user_id, email),
    )
    conn.commit()


def _add_settings(conn, user_id, account_size=100_000):
    """Single-row j2_settings (Phase 1 model). Phase 2 will swap."""
    from api.services.journal_two.settings import default_settings_data
    data = default_settings_data()
    data["accountSize"] = account_size
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT OR REPLACE INTO j2_settings "
        "(id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, json.dumps(data), now, now),
    )
    conn.commit()


def _add_trade(
    conn, user_id, *,
    exit_date_iso, pnl=100.0, r=2.0, result="Win",
    symbol="NVDA", entry_price=500.0, exit_price=510.0, shares=100,
    trading_day_et=None, hour_et=None,
):
    tid = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry, created_at,
            trading_day_et, hour_et
        ) VALUES (?, ?, 'manual', ?, 'Long', ?, ?, ?, ?, ?, ?, NULL, NULL,
                  ?, 0.02, ?, 1, ?, '{}', ?, ?, ?)
        """,
        (
            tid, user_id, symbol, shares, entry_price,
            exit_date_iso, exit_price, exit_date_iso,
            entry_price * 0.98, pnl, r, result,
            datetime.now(timezone.utc).isoformat(),
            trading_day_et, hour_et,
        ),
    )
    conn.commit()
    return tid


# ─── ET bucketing ─────────────────────────────────────────────────────────────


def test_to_et_date_handles_z_suffix():
    from api.services.journal_two.calendar import to_et_date
    # 2026-04-19 14:30 UTC = 10:30 ET → 2026-04-19
    assert to_et_date("2026-04-19T14:30:00Z") == "2026-04-19"


def test_to_et_date_handles_offset():
    from api.services.journal_two.calendar import to_et_date
    assert to_et_date("2026-04-19T14:30:00+00:00") == "2026-04-19"


def test_to_et_date_after_hours_stays_same_day():
    """A 7pm ET close (23:00 UTC during EDT) buckets to same calendar day."""
    from api.services.journal_two.calendar import to_et_date
    # Late April → EDT (UTC-4); 23:00 UTC = 19:00 ET
    assert to_et_date("2026-04-19T23:00:00Z") == "2026-04-19"


def test_to_et_date_overnight_rolls_forward():
    """A 9pm ET close (01:00 UTC next day during EDT) buckets to same ET day,
    but a 1am ET (05:00 UTC) close rolls to the new day."""
    from api.services.journal_two.calendar import to_et_date
    # 9pm ET on Apr 19 EDT = 01:00 UTC on Apr 20
    assert to_et_date("2026-04-20T01:00:00Z") == "2026-04-19"
    # 1am ET on Apr 20 EDT = 05:00 UTC on Apr 20
    assert to_et_date("2026-04-20T05:00:00Z") == "2026-04-20"


def test_to_et_date_dst_transition():
    """Spring-forward 2026-03-08: 2:00am ET → 3:00am ET. Trades around
    that boundary should still bucket sanely."""
    from api.services.journal_two.calendar import to_et_date
    # Just before transition (still EST, UTC-5): 06:30 UTC = 01:30 ET Mar 8
    assert to_et_date("2026-03-08T06:30:00Z") == "2026-03-08"
    # Just after transition (now EDT, UTC-4): 07:30 UTC = 03:30 ET Mar 8
    assert to_et_date("2026-03-08T07:30:00Z") == "2026-03-08"


# ─── Month aggregation ────────────────────────────────────────────────────────


def test_month_aggregate_empty_user(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    got = get_calendar("u1", view="month", year=2026, month=4, conn=db_conn)
    assert got["view"] == "month"
    assert got["year"] == 2026
    assert got["month"] == 4
    assert got["days"] == []
    assert got["totals"]["tradeCount"] == 0
    assert got["totals"]["winRate"] is None


def test_month_aggregate_buckets_by_et_date(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1", account_size=100_000)

    # Two trades on 2026-04-19 ET
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T18:00:00Z", pnl=100, r=1.5)
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T23:30:00Z", pnl=50, r=0.5)
    # One trade on 2026-04-20 ET (early-morning EDT)
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-20T14:00:00Z", pnl=-30, r=-0.5, result="Loss")

    got = get_calendar("u1", view="month", year=2026, month=4, conn=db_conn)
    by_date = {d["date"]: d for d in got["days"]}
    assert by_date["2026-04-19"]["pnlDollar"] == pytest.approx(150.0)
    assert by_date["2026-04-19"]["tradeCount"] == 2
    assert by_date["2026-04-19"]["winners"] == 2
    assert by_date["2026-04-19"]["rSum"] == pytest.approx(2.0)
    assert by_date["2026-04-20"]["pnlDollar"] == pytest.approx(-30.0)
    assert by_date["2026-04-20"]["losers"] == 1


def test_month_aggregate_pnl_percent_uses_account_size(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1", account_size=50_000)

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T18:00:00Z", pnl=500.0)

    got = get_calendar("u1", view="month", year=2026, month=4, conn=db_conn)
    day = got["days"][0]
    # 500 / 50000 = 0.01 (1%)
    assert day["pnlPercent"] == pytest.approx(0.01)


def test_month_aggregate_excludes_other_months(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    # Trade in March
    _add_trade(db_conn, "u1", exit_date_iso="2026-03-15T18:00:00Z", pnl=200)
    # Trade in April
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T18:00:00Z", pnl=100)

    got = get_calendar("u1", view="month", year=2026, month=4, conn=db_conn)
    assert len(got["days"]) == 1
    assert got["days"][0]["date"] == "2026-04-19"
    assert got["totals"]["netPnlDollar"] == pytest.approx(100)


def test_month_aggregate_user_isolation(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "alice", "alice@x.com")
    _add_user(db_conn, "bob", "bob@x.com")
    _add_settings(db_conn, "alice")
    _add_settings(db_conn, "bob")

    _add_trade(db_conn, "alice", exit_date_iso="2026-04-19T18:00:00Z", pnl=100)
    _add_trade(db_conn, "bob", exit_date_iso="2026-04-19T18:00:00Z", pnl=999)

    got_a = get_calendar("alice", view="month", year=2026, month=4, conn=db_conn)
    assert got_a["totals"]["netPnlDollar"] == pytest.approx(100)


def test_month_totals_include_win_rate(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T18:00:00Z", pnl=100, result="Win")
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-20T18:00:00Z", pnl=200, result="Win")
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-21T18:00:00Z", pnl=-50, result="Loss")

    got = get_calendar("u1", view="month", year=2026, month=4, conn=db_conn)
    assert got["totals"]["winners"] == 2
    assert got["totals"]["losers"] == 1
    assert got["totals"]["winRate"] == pytest.approx(2 / 3)


# ─── Year + week views ────────────────────────────────────────────────────────


def test_year_view_aggregate(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-01-15T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", exit_date_iso="2026-06-15T18:00:00Z", pnl=200)
    _add_trade(db_conn, "u1", exit_date_iso="2026-12-15T18:00:00Z", pnl=300)

    got = get_calendar("u1", view="year", year=2026, conn=db_conn)
    assert got["view"] == "year"
    assert len(got["days"]) == 3
    assert got["totals"]["netPnlDollar"] == pytest.approx(600)


def test_year_excludes_other_years(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2025-12-31T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", exit_date_iso="2027-01-01T18:00:00Z", pnl=200)

    got = get_calendar("u1", view="year", year=2026, conn=db_conn)
    assert got["days"] == []


def test_week_view_iso_8601(db_conn):
    """ISO week 16 of 2026 = Mon Apr 13 → Sun Apr 19."""
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-13T18:00:00Z", pnl=10)
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T18:00:00Z", pnl=20)
    # Outside window
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-12T18:00:00Z", pnl=99)
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-20T18:00:00Z", pnl=99)

    got = get_calendar("u1", view="week", year=2026, week=16, conn=db_conn)
    assert got["totals"]["netPnlDollar"] == pytest.approx(30)


def test_week_view_requires_week_param(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    with pytest.raises(ValueError):
        get_calendar("u1", view="week", year=2026, conn=db_conn)


def test_invalid_view_raises(db_conn):
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    with pytest.raises(ValueError):
        get_calendar("u1", view="banana", year=2026, conn=db_conn)


# ─── Day detail ───────────────────────────────────────────────────────────────


def test_day_detail_returns_metrics_and_trades(db_conn):
    from api.services.journal_two.calendar import get_day_detail
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1", account_size=100_000)

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T15:00:00Z",
               pnl=80, r=1.6, symbol="NVDA")
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T19:30:00Z",
               pnl=20, r=0.4, symbol="AMD")
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-20T15:00:00Z",
               pnl=999, symbol="WRONG_DAY")

    got = get_day_detail("u1", "2026-04-19", conn=db_conn)
    assert got["date"] == "2026-04-19"
    assert got["metrics"]["netPnlDollar"] == pytest.approx(100)
    assert got["metrics"]["tradeCount"] == 2
    assert got["metrics"]["pnlPercent"] == pytest.approx(0.001)
    symbols = {t["symbol"] for t in got["trades"]}
    assert symbols == {"NVDA", "AMD"}
    assert got["notes"] is None


def test_day_detail_empty_day(db_conn):
    from api.services.journal_two.calendar import get_day_detail
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    got = get_day_detail("u1", "2026-04-19", conn=db_conn)
    assert got["metrics"]["tradeCount"] == 0
    assert got["trades"] == []
    assert got["notes"] is None


# ─── Day notes CRUD ───────────────────────────────────────────────────────────


def test_get_day_notes_returns_none_when_absent(db_conn):
    from api.services.journal_two.calendar import get_day_notes
    _add_user(db_conn, "u1", "u1@x.com")
    assert get_day_notes("u1", "2026-04-19", conn=db_conn) is None


def test_upsert_then_get_round_trip(db_conn):
    from api.services.journal_two.calendar import (
        upsert_day_notes, get_day_notes,
    )
    _add_user(db_conn, "u1", "u1@x.com")

    upsert_day_notes(
        "u1", "2026-04-19",
        {
            "notes": "Patient on entry, scaled at +2R.",
            "attachments": [
                {"kind": "link", "url": "https://tradingview.com/x/abc",
                 "label": "Setup chart"},
            ],
            "rules": [
                {"id": "r1", "label": "Wait for confirmation", "checked": True},
            ],
        },
        conn=db_conn,
    )

    got = get_day_notes("u1", "2026-04-19", conn=db_conn)
    assert got["notes"].startswith("Patient")
    assert len(got["attachments"]) == 1
    assert got["attachments"][0]["kind"] == "link"
    assert got["rules"][0]["checked"] is True


def test_upsert_replaces_existing(db_conn):
    from api.services.journal_two.calendar import (
        upsert_day_notes, get_day_notes,
    )
    _add_user(db_conn, "u1", "u1@x.com")

    upsert_day_notes("u1", "2026-04-19", {"notes": "first"}, conn=db_conn)
    upsert_day_notes("u1", "2026-04-19", {"notes": "second"}, conn=db_conn)

    got = get_day_notes("u1", "2026-04-19", conn=db_conn)
    assert got["notes"] == "second"


def test_upsert_caps_attachments_at_5(db_conn):
    from api.services.journal_two.calendar import (
        upsert_day_notes, DayNotesValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    payload = {
        "attachments": [
            {"kind": "link", "url": f"https://x.com/{i}"} for i in range(6)
        ]
    }
    with pytest.raises(DayNotesValidationError):
        upsert_day_notes("u1", "2026-04-19", payload, conn=db_conn)


def test_upsert_caps_rules_at_25(db_conn):
    from api.services.journal_two.calendar import (
        upsert_day_notes, DayNotesValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    payload = {
        "rules": [{"label": f"rule {i}", "checked": False} for i in range(26)]
    }
    with pytest.raises(DayNotesValidationError):
        upsert_day_notes("u1", "2026-04-19", payload, conn=db_conn)


def test_upsert_caps_notes_at_10000_chars(db_conn):
    from api.services.journal_two.calendar import (
        upsert_day_notes, DayNotesValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(DayNotesValidationError):
        upsert_day_notes("u1", "2026-04-19", {"notes": "x" * 10_001}, conn=db_conn)


def test_upsert_rejects_invalid_attachment_kind(db_conn):
    from api.services.journal_two.calendar import (
        upsert_day_notes, DayNotesValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(DayNotesValidationError):
        upsert_day_notes(
            "u1", "2026-04-19",
            {"attachments": [{"kind": "video", "url": "https://x"}]},
            conn=db_conn,
        )


def test_upsert_user_isolation(db_conn):
    from api.services.journal_two.calendar import (
        upsert_day_notes, get_day_notes,
    )
    _add_user(db_conn, "alice", "alice@x.com")
    _add_user(db_conn, "bob", "bob@x.com")

    upsert_day_notes("alice", "2026-04-19", {"notes": "alice's"}, conn=db_conn)
    assert get_day_notes("bob", "2026-04-19", conn=db_conn) is None


def test_calendar_marks_days_with_notes(db_conn):
    """Cell badge logic: hasNotes=true on days that have a saved row."""
    from api.services.journal_two.calendar import (
        get_calendar, upsert_day_notes,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-20T18:00:00Z", pnl=50)
    upsert_day_notes("u1", "2026-04-19", {"notes": "reflection"}, conn=db_conn)

    got = get_calendar("u1", view="month", year=2026, month=4, conn=db_conn)
    by_date = {d["date"]: d for d in got["days"]}
    assert by_date["2026-04-19"]["hasNotes"] is True
    assert by_date["2026-04-20"]["hasNotes"] is False


def test_calendar_unions_option_strategies(db_conn):
    """Closed option strategies add to the day's pnlDollar and tradeCount."""
    from datetime import date, timedelta
    from api.services.journal_two.calendar import get_calendar
    from api.services.journal_two.options import create_strategy, close_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    today = date.today()
    exp = (today + timedelta(days=21)).isoformat()

    # 1 equity trade closed today: +$100
    _add_trade(db_conn, "u1",
               exit_date_iso=f"{today.isoformat()}T18:00:00Z", pnl=100)

    # 1 option strategy closed today: buy call @5 → sell @8 → +$300
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": today.isoformat(),
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": exp, "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    close_strategy("u1", s["id"], {
        "exitPrices": {"0": 8}, "exitDate": today.isoformat(),
    }, conn=db_conn)

    got = get_calendar(
        "u1", view="month", year=today.year, month=today.month,
        conn=db_conn,
    )
    by_date = {d["date"]: d for d in got["days"]}
    bucket = by_date.get(today.isoformat())
    assert bucket is not None
    assert bucket["pnlDollar"] == 400   # 100 + 300
    assert bucket["tradeCount"] == 2    # 1 trade + 1 strategy


def test_calendar_spine_column_wins_over_utc_refilter(db_conn):
    """A T00:00:00Z trade with trading_day_et stamped appears on the SPINE
    day in the month view — not the previous ET calendar day (the legacy
    to_et_date bucketing put 2026-04-19T00:00:00Z on the 18th)."""
    from api.services.journal_two.calendar import get_calendar
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T00:00:00Z", pnl=100,
               trading_day_et="2026-04-19")

    got = get_calendar("u1", view="month", year=2026, month=4, conn=db_conn)
    by_date = {d["date"]: d for d in got["days"]}
    assert "2026-04-18" not in by_date
    assert by_date["2026-04-19"]["pnlDollar"] == pytest.approx(100.0)
    assert by_date["2026-04-19"]["tradeCount"] == 1


def test_calendar_marks_expiring_strategies(db_conn):
    """Open strategies with legs expiring in the month get expiringCount > 0."""
    from datetime import date, timedelta
    from api.services.journal_two.calendar import get_calendar
    from api.services.journal_two.options import create_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    today = date.today()
    # Pick an expiration that's still within `today`'s calendar month
    # so the get_calendar query window includes it.
    next_month = today.replace(day=1) + timedelta(days=32)
    last_of_month = next_month.replace(day=1) - timedelta(days=1)
    days_left = (last_of_month - today).days
    exp = (today + timedelta(days=min(7, max(1, days_left)))).isoformat()

    create_strategy("u1", {
        "underlying": "SPY", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": today.isoformat(),
        "legs": [{"side": "buy", "contract_type": "call", "strike": 420,
                  "expiration": exp, "qty": 1, "entry_price": 3}],
    }, conn=db_conn)

    got = get_calendar(
        "u1", view="month", year=today.year, month=today.month,
        conn=db_conn,
    )
    by_date = {d["date"]: d for d in got["days"]}
    assert exp in by_date
    assert by_date[exp]["expiringCount"] == 1


# ─── Scope (FilterSpec) — non-date facets filter day aggregates (Task A3) ──────


def test_calendar_spec_symbol_filters_day_aggregate(db_conn):
    """A Scope symbol facet narrows which trades count toward each day's
    pnlDollar/tradeCount — AAPL only, on the SAME day two symbols reported."""
    from api.services.journal_two.calendar import get_calendar
    from api.services.journal_two.filters import FilterSpec
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T18:00:00Z",
               pnl=100, symbol="AAPL")
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T18:00:00Z",
               pnl=250, symbol="MSFT")

    # Unfiltered: both symbols count.
    full = get_calendar("u1", view="month", year=2026, month=4, conn=db_conn)
    by_full = {d["date"]: d for d in full["days"]}
    assert by_full["2026-04-19"]["pnlDollar"] == pytest.approx(350.0)
    assert by_full["2026-04-19"]["tradeCount"] == 2

    # Scoped to AAPL: only the AAPL trade's P&L / count.
    got = get_calendar("u1", view="month", year=2026, month=4,
                       spec=FilterSpec(symbol="AAPL"), conn=db_conn)
    by_date = {d["date"]: d for d in got["days"]}
    assert by_date["2026-04-19"]["pnlDollar"] == pytest.approx(100.0)
    assert by_date["2026-04-19"]["tradeCount"] == 1
    assert got["totals"]["tradeCount"] == 1


def test_calendar_spec_date_facet_is_ignored(db_conn):
    """The Scope DATE facet must NOT shrink the calendar's own window — the
    calendar navigates dates itself. A spec.date_from AFTER a trade's day
    still includes that trade (date facet compiled away in the adapter)."""
    from api.services.journal_two.calendar import get_calendar
    from api.services.journal_two.filters import FilterSpec
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-05T18:00:00Z",
               pnl=100, symbol="AAPL")

    # date_from far AFTER the trade day would drop it if the date facet applied.
    got = get_calendar("u1", view="month", year=2026, month=4,
                       spec=FilterSpec(date_from="2026-04-20", date_to="2026-04-25"),
                       conn=db_conn)
    by_date = {d["date"]: d for d in got["days"]}
    assert by_date["2026-04-05"]["pnlDollar"] == pytest.approx(100.0)
    assert got["totals"]["tradeCount"] == 1


def test_day_detail_spec_symbol_filters(db_conn):
    """get_day_detail honors the Scope symbol facet on its trade list + metrics."""
    from api.services.journal_two.calendar import get_day_detail
    from api.services.journal_two.filters import FilterSpec
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T15:00:00Z",
               pnl=80, symbol="AAPL")
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T16:00:00Z",
               pnl=20, symbol="MSFT")

    got = get_day_detail("u1", "2026-04-19",
                         spec=FilterSpec(symbol="AAPL"), conn=db_conn)
    assert got["metrics"]["tradeCount"] == 1
    assert got["metrics"]["netPnlDollar"] == pytest.approx(80.0)
    assert {t["symbol"] for t in got["trades"]} == {"AAPL"}


def test_calendar_spec_symbol_excludes_other_underlying_strategy(db_conn):
    """The symbol facet filters option strategies by underlying too — a
    strategy on a different underlying does not union into a scoped day."""
    from datetime import date, timedelta
    from api.services.journal_two.calendar import get_calendar
    from api.services.journal_two.filters import FilterSpec
    from api.services.journal_two.options import create_strategy, close_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    today = date.today()
    exp = (today + timedelta(days=21)).isoformat()

    _add_trade(db_conn, "u1", exit_date_iso=f"{today.isoformat()}T18:00:00Z",
               pnl=100, symbol="AAPL")
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": today.isoformat(),
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": exp, "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    close_strategy("u1", s["id"], {
        "exitPrices": {"0": 8}, "exitDate": today.isoformat(),
    }, conn=db_conn)

    got = get_calendar("u1", view="month", year=today.year, month=today.month,
                       spec=FilterSpec(symbol="AAPL"), conn=db_conn)
    by_date = {d["date"]: d for d in got["days"]}
    bucket = by_date.get(today.isoformat())
    assert bucket is not None
    # Only the AAPL equity trade — the NVDA strategy is excluded by symbol scope.
    assert bucket["pnlDollar"] == pytest.approx(100.0)
    assert bucket["tradeCount"] == 1


def test_calendar_spec_setup_does_not_filter_strategies(db_conn):
    """Setups/tags do NOT apply to option strategies (they aren't stored/filtered
    on strategies): a setup scope narrows equities but leaves the strategy union
    intact (documented A3 behavior)."""
    from datetime import date, timedelta
    from api.services.journal_two.calendar import get_calendar
    from api.services.journal_two.filters import FilterSpec
    from api.services.journal_two.options import create_strategy, close_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")

    today = date.today()
    exp = (today + timedelta(days=21)).isoformat()

    # Equity trade has NO setup (NULL) → excluded by a setups=['VCP'] scope.
    _add_trade(db_conn, "u1", exit_date_iso=f"{today.isoformat()}T18:00:00Z",
               pnl=100, symbol="AAPL")
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": today.isoformat(),
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": exp, "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    close_strategy("u1", s["id"], {
        "exitPrices": {"0": 8}, "exitDate": today.isoformat(),
    }, conn=db_conn)

    got = get_calendar("u1", view="month", year=today.year, month=today.month,
                       spec=FilterSpec(setups=["VCP"]), conn=db_conn)
    by_date = {d["date"]: d for d in got["days"]}
    bucket = by_date.get(today.isoformat())
    assert bucket is not None
    # Equity trade (no VCP setup) excluded; NVDA strategy still unions in.
    assert bucket["pnlDollar"] == pytest.approx(300.0)
    assert bucket["tradeCount"] == 1


# ─── Account-balance basis ────────────────────────────────────────────────────


def _add_broker_account(conn, user_id, *, balance_source="snaptrade", name="RH",
                        broker_total_equity=None):
    now = datetime.now(timezone.utc).isoformat()
    acct_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, account_size, "
        "starting_balance, created_at, updated_at, balance_source, broker_total_equity) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (acct_id, user_id, name, "#888", 100000, 100000, now, now,
         balance_source, broker_total_equity),
    )
    conn.commit()
    return acct_id


def _map_broker_account(conn, user_id, j2_account_id, *, broker_account_id=None):
    """Map a j2 account to a j2_broker_accounts row so snapshot lookups resolve."""
    now = datetime.now(timezone.utc).isoformat()
    bkid = broker_account_id or str(uuid.uuid4())
    conn.execute(
        "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id, "
        "j2_account_id, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (bkid, user_id, "snap-" + bkid[:8], j2_account_id, now, now),
    )
    conn.commit()
    return bkid


def _add_equity_snapshot(conn, user_id, broker_account_id, date, equity):
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO j2_broker_equity_snapshots (user_id, broker_account_id, "
        "snapshot_date, total_equity, cash, market_value, synced_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (user_id, broker_account_id, date, equity, 0.0, equity, now),
    )
    conn.commit()


def test_load_equity_series_sources_from_broker_snapshots(db_conn, monkeypatch):
    """The calendar's account-balance series must come from the broker's OWN
    reported daily net-liq snapshots (ground truth) — NOT the fragile MTM
    reconstruction (which produces phantom ±20% daily spikes from price-fetch
    gaps / partial days). Mirrors performance_service's trustworthy default."""
    import api.services.journal_two.calendar as cal
    uid = "u-snap"
    _add_user(db_conn, uid, "snap@example.com")
    acct_id = _add_broker_account(db_conn, uid, broker_total_equity=None)
    bkid = _map_broker_account(db_conn, uid, acct_id)
    _add_equity_snapshot(db_conn, uid, bkid, "2026-06-01", 100000.0)
    _add_equity_snapshot(db_conn, uid, bkid, "2026-06-02", 100500.0)
    _add_equity_snapshot(db_conn, uid, bkid, "2026-06-03", 100200.0)

    # If reconstruction were (wrongly) used, this would blow up / return spikes.
    def _boom(*a, **k):
        raise AssertionError("reconstruct_daily_equity must NOT be called by default")
    from api.services.journal_two.broker import historical_equity
    monkeypatch.setattr(historical_equity, "reconstruct_daily_equity", _boom)

    series = cal._load_equity_series(uid, acct_id, conn=db_conn)
    assert series == [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
        {"date": "2026-06-03", "equity": 100200.0},
    ]


def test_load_equity_series_skips_live_edge_when_sync_lapsed():
    """If the last broker snapshot is many days old, the live right-edge must
    NOT be appended onto today — that would dump a multi-day net-liq move onto a
    single calendar cell (phantom spike). The series ends at the last snapshot."""
    import importlib, tempfile, os as _os
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    _os.environ["AUTH_DB_PATH"] = tmp.name
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    try:
        import api.services.journal_two.calendar as cal
        uid = "u-lapse"
        _add_user(conn, uid, "lapse@example.com")
        # Live equity present, but snapshots are ancient (2020) → gap >> 4 days.
        acct_id = _add_broker_account(conn, uid, broker_total_equity=99999.0)
        bkid = _map_broker_account(conn, uid, acct_id)
        _add_equity_snapshot(conn, uid, bkid, "2020-01-02", 50000.0)
        _add_equity_snapshot(conn, uid, bkid, "2020-01-03", 50500.0)
        series = cal._load_equity_series(uid, acct_id, conn=conn)
        assert series == [
            {"date": "2020-01-02", "equity": 50000.0},
            {"date": "2020-01-03", "equity": 50500.0},
        ]
    finally:
        conn.close()
        _os.unlink(tmp.name)


def test_load_equity_series_appends_live_edge_when_recent():
    """When the last snapshot is recent (yesterday), today's live broker equity
    IS carried onto a new right-edge point so today's cell tracks intraday."""
    import importlib, tempfile, os as _os
    from datetime import date as _D, timedelta as _TD
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    _os.environ["AUTH_DB_PATH"] = tmp.name
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    try:
        import api.services.journal_two.calendar as cal
        from api.services.journal_two.broker.historical_equity import _et_today
        today = _et_today()
        yday = (_D.fromisoformat(today) - _TD(days=1)).isoformat()
        uid = "u-recent"
        _add_user(conn, uid, "recent@example.com")
        acct_id = _add_broker_account(conn, uid, broker_total_equity=51234.0)
        bkid = _map_broker_account(conn, uid, acct_id)
        _add_equity_snapshot(conn, uid, bkid, yday, 51000.0)
        series = cal._load_equity_series(uid, acct_id, conn=conn)
        assert series[-1] == {"date": today, "equity": 51234.0}
        assert len(series) == 2
    finally:
        conn.close()
        _os.unlink(tmp.name)


def test_account_equity_days_diffs_close_to_close():
    from api.services.journal_two.calendar import _account_equity_days
    series = [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
        {"date": "2026-06-03", "equity": 100200.0},
        {"date": "2026-06-04", "equity": 101000.0},
    ]
    days, totals = _account_equity_days(series, "2026-06-02", "2026-06-04", [])
    by_date = {d["date"]: d for d in days}
    assert round(by_date["2026-06-02"]["pnlDollar"], 2) == 500.0
    assert round(by_date["2026-06-03"]["pnlDollar"], 2) == -300.0
    assert round(by_date["2026-06-04"]["pnlDollar"], 2) == 800.0
    assert round(by_date["2026-06-02"]["pnlPercent"], 6) == round(500.0 / 100000.0, 6)
    assert round(totals["netPnlDollar"], 2) == 1000.0


def test_account_equity_days_skips_inception_point():
    from api.services.journal_two.calendar import _account_equity_days
    series = [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
    ]
    days, totals = _account_equity_days(series, "2026-06-01", "2026-06-02", [])
    by_date = {d["date"]: d for d in days}
    assert "2026-06-01" not in by_date
    assert round(by_date["2026-06-02"]["pnlDollar"], 2) == 500.0


def test_account_equity_days_overlays_closed_badges():
    from api.services.journal_two.calendar import _account_equity_days
    series = [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
    ]
    closed_days = [{"date": "2026-06-02", "pnlDollar": 200.0, "rSum": 1.5,
                    "tradeCount": 3, "winners": 2, "losers": 1,
                    "hasNotes": True, "expiringCount": 0, "pnlPercent": 0.002}]
    days, _ = _account_equity_days(series, "2026-06-02", "2026-06-02", closed_days)
    d = days[0]
    assert d["pnlDollar"] == 500.0
    assert d["tradeCount"] == 3
    assert d["winners"] == 2 and d["losers"] == 1
    assert d["hasNotes"] is True


def test_get_calendar_account_basis_uses_equity_series(db_conn, monkeypatch):
    import api.services.journal_two.calendar as cal
    uid = "u-acct"
    _add_user(db_conn, uid, "acct@example.com")
    acct_id = _add_broker_account(db_conn, uid)
    monkeypatch.setattr(cal, "_load_equity_series", lambda u, a, conn=None: [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
        {"date": "2026-06-03", "equity": 100200.0},
    ])
    out = cal.get_calendar(uid, view="month", year=2026, month=6,
                           account_id=acct_id, basis="account", conn=db_conn)
    assert out["basis"] == "account"
    by_date = {d["date"]: d for d in out["days"]}
    assert round(by_date["2026-06-02"]["pnlDollar"], 2) == 500.0
    assert round(by_date["2026-06-03"]["pnlDollar"], 2) == -300.0


def test_get_calendar_account_basis_falls_back_when_empty(db_conn, monkeypatch):
    import api.services.journal_two.calendar as cal
    uid = "u-fb"
    _add_user(db_conn, uid, "fb@example.com")
    acct_id = _add_broker_account(db_conn, uid)
    monkeypatch.setattr(cal, "_load_equity_series", lambda u, a, conn=None: [])
    out = cal.get_calendar(uid, view="month", year=2026, month=6,
                           account_id=acct_id, basis="account", conn=db_conn)
    assert out["basis"] == "closed"


def test_get_calendar_manual_account_forces_closed(db_conn, monkeypatch):
    import api.services.journal_two.calendar as cal
    uid = "u-man"
    _add_user(db_conn, uid, "man@example.com")
    acct_id = _add_broker_account(db_conn, uid, balance_source="manual", name="Manual")
    monkeypatch.setattr(cal, "_load_equity_series",
                        lambda u, a, conn=None: [{"date": "2026-06-02", "equity": 1.0}])
    out = cal.get_calendar(uid, view="month", year=2026, month=6,
                           account_id=acct_id, basis="account", conn=db_conn)
    assert out["basis"] == "closed"


def test_day_detail_account_mode_breakdown(db_conn, monkeypatch):
    import api.services.journal_two.calendar as cal
    uid = "u-dd"
    _add_user(db_conn, uid, "dd@example.com")
    acct_id = _add_broker_account(db_conn, uid)
    _add_trade(db_conn, uid, exit_date_iso="2026-06-02T18:00:00Z", pnl=200.0)
    db_conn.execute("UPDATE j2_trades SET account_id = ? WHERE user_id = ?",
                    (acct_id, uid))
    db_conn.commit()
    monkeypatch.setattr(cal, "_load_equity_series", lambda u, a, conn=None: [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
    ])
    out = cal.get_day_detail(uid, "2026-06-02", account_id=acct_id,
                             basis="account", conn=db_conn)
    m = out["metrics"]
    assert m["basis"] == "account"
    assert round(m["accountBalanceChange"], 2) == 500.0
    assert round(m["realizedPnl"], 2) == 200.0
    assert round(m["unrealizedChange"], 2) == 300.0
    assert round(m["accountBalanceChange"], 2) == round(
        m["realizedPnl"] + m["unrealizedChange"], 2)
