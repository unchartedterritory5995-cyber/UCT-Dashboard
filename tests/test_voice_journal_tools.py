"""Voice journal deep-read tools — calendar, daily note, weekly review,
accounts, option strategies."""

import uuid

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_journal_tools as vjt


def _user():
    init_db()
    return create_user(f"vjt_{uuid.uuid4()}@example.com", "p")["id"]


# ── _norm_month / _norm_date ───────────────────────────────────────────────

def test_norm_month_named():
    y, m = vjt._norm_month("May 2026")
    assert (y, m) == (2026, 5)


def test_norm_month_short_alias():
    y, m = vjt._norm_month("Jan")
    assert m == 1


def test_norm_month_this_last():
    from datetime import date, timedelta
    today = date.today()
    y, m = vjt._norm_month("this month")
    assert (y, m) == (today.year, today.month)
    prev = today.replace(day=1) - timedelta(days=1)
    y2, m2 = vjt._norm_month("last month")
    assert (y2, m2) == (prev.year, prev.month)


def test_norm_month_invalid_fallback():
    from datetime import date
    today = date.today()
    y, m = vjt._norm_month("Smarch")
    assert (y, m) == (today.year, today.month)


def test_norm_date_aliases():
    from datetime import date, timedelta
    today = date.today()
    assert vjt._norm_date("today") == today.isoformat()
    assert vjt._norm_date("yesterday") == (today - timedelta(days=1)).isoformat()
    assert vjt._norm_date("2026-05-08") == "2026-05-08"
    assert vjt._norm_date("garbage") == today.isoformat()


# ── Daily note ─────────────────────────────────────────────────────────────

def test_daily_note_empty_returns_ok_with_empty_flag():
    uid = _user()
    out = vjt.get_my_daily_note(date="today", user_id=uid)
    assert out["ok"] is True
    assert out.get("empty") is True


# ── Weekly review (empty user) ─────────────────────────────────────────────

def test_weekly_review_zero_trades():
    uid = _user()
    out = vjt.get_my_weekly_review(user_id=uid)
    assert out["ok"] is True
    assert out["wins"] == 0
    assert out["losses"] == 0


# ── Accounts ───────────────────────────────────────────────────────────────

def test_list_my_accounts_includes_default():
    uid = _user()
    # Trigger default account migration
    from api.services.journal_two import accounts as j2_accounts
    j2_accounts.get_or_migrate_default_account(uid)
    out = vjt.list_my_accounts(user_id=uid)
    assert out["ok"] is True
    assert out["count"] >= 1


def test_get_my_account_balance_default():
    uid = _user()
    from api.services.journal_two import accounts as j2_accounts
    j2_accounts.get_or_migrate_default_account(uid)
    out = vjt.get_my_account_balance(user_id=uid)
    assert out["ok"] is True
    assert "balance" in out


def test_switch_account_unknown_name():
    uid = _user()
    out = vjt.switch_account(account_name="Doesnt Exist", user_id=uid)
    assert out["ok"] is False


def test_switch_account_empty():
    uid = _user()
    out = vjt.switch_account(account_name="", user_id=uid)
    assert out["ok"] is False


def test_switch_account_returns_client_action_on_match():
    uid = _user()
    from api.services.journal_two import accounts as j2_accounts
    acc = j2_accounts.get_or_migrate_default_account(uid)
    name = acc.get("displayName") or acc.get("name")
    out = vjt.switch_account(account_name=name, user_id=uid)
    assert out["ok"] is True
    assert out["client_action"]["type"] == "switch_account"
    assert out["client_action"]["account_id"] == acc["id"]


# ── Option strategies ──────────────────────────────────────────────────────

def test_option_strategies_empty_user():
    uid = _user()
    out = vjt.get_my_option_strategies(user_id=uid)
    assert out["ok"] is True
    assert out.get("strategies", []) == []


def test_option_strategies_rejects_bad_status():
    uid = _user()
    out = vjt.get_my_option_strategies(status="ongoing", user_id=uid)
    assert out["ok"] is False


# ── Calendar (empty user) ──────────────────────────────────────────────────

def test_calendar_for_current_month_empty_user():
    uid = _user()
    out = vjt.get_my_calendar(user_id=uid)
    assert out["ok"] is True
    assert out["wins"] == 0
    assert out["losses"] == 0
