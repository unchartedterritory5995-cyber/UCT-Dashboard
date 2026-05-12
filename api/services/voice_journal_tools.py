"""
Voice journal deep-read tools — Journal 2.0 calendar, daily notes, weekly
review, account balance + switch, option strategies.

All reads use the j2_* services. No DB schema changes here.
"""

import logging
from datetime import date as _date_cls, timedelta
_date = _date_cls  # alias kept short for narration formatting

_log = logging.getLogger(__name__)


_MONTH_ALIASES = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}


def _norm_month(month: str | int | None) -> tuple[int, int]:
    """Return (year, month). Accepts 'May', 'May 2026', '2026-05', 5, 'this month'."""
    today = _date.today()
    if month is None or (isinstance(month, str) and not month.strip()):
        return today.year, today.month
    if isinstance(month, int):
        return today.year, max(1, min(12, month))

    m = str(month).strip().lower()
    if m in ("this month", "current", "current month"):
        return today.year, today.month
    if m in ("last month", "previous", "previous month"):
        prev = today.replace(day=1) - timedelta(days=1)
        return prev.year, prev.month
    # Try MM-YYYY or YYYY-MM
    if "-" in m:
        parts = [p.strip() for p in m.split("-")]
        if len(parts) == 2:
            try:
                a, b = int(parts[0]), int(parts[1])
                if a > 12:
                    return a, max(1, min(12, b))
                return b, max(1, min(12, a))
            except ValueError:
                pass
    # Plain month name (possibly with year)
    tokens = m.split()
    name = None
    year = today.year
    for tok in tokens:
        tok = tok.strip(",")
        if tok in _MONTH_ALIASES:
            name = _MONTH_ALIASES[tok]
        elif tok.isdigit() and len(tok) == 4:
            year = int(tok)
    if name is not None:
        return year, name
    # Fallback to current
    return today.year, today.month


def _norm_date(date: str | None) -> str:
    """Return YYYY-MM-DD. Accepts 'today', 'yesterday', 'YYYY-MM-DD'."""
    today = _date.today()
    if not date or not isinstance(date, str):
        return today.isoformat()
    d = date.strip().lower()
    if d in ("today", ""):
        return today.isoformat()
    if d == "yesterday":
        return (today - timedelta(days=1)).isoformat()
    # Try ISO
    try:
        _date.fromisoformat(d)
        return d
    except ValueError:
        return today.isoformat()


# ── Calendar ───────────────────────────────────────────────────────────────

def get_my_calendar(*, month: str | int | None = None, user_id: str) -> dict:
    """Monthly trade calendar summary — bucket counts + totals."""
    from api.services.journal_two import calendar as j2_calendar
    year, mo = _norm_month(month)
    try:
        data = j2_calendar.get_calendar(user_id, view="month", year=year, month=mo)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "narration": "Couldn't load calendar.",
                "error": str(e)}
    days = data.get("days") or []
    totals = data.get("totals") or {}
    active_days = [d for d in days if (d.get("tradeCount") or 0) > 0]
    wins = sum((d.get("wins") or 0) for d in days)
    losses = sum((d.get("losses") or 0) for d in days)
    net = totals.get("pnlDollar") or 0
    direction = "up" if net >= 0 else "down"
    return {
        "ok": True,
        "narration": (
            f"{_date(year, mo, 1).strftime('%B %Y')} — {len(active_days)} active days, "
            f"{wins} winning trades and {losses} losing trades, "
            f"net {direction} ${abs(round(float(net), 2)):,}."
        ),
        "year": year,
        "month": mo,
        "active_days": len(active_days),
        "wins": wins,
        "losses": losses,
        "net_pnl": float(net),
        "trade_count": totals.get("tradeCount") or 0,
    }


def get_my_daily_note(*, date: str | None = None, user_id: str) -> dict:
    """Read back a structured day-notes bundle (prep / midday / recap)."""
    from api.services.journal_two import calendar as j2_calendar
    d = _norm_date(date)
    try:
        bundle = j2_calendar.get_day_notes(user_id, d)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "narration": f"Couldn't load notes for {d}.",
                "error": str(e)}
    if not bundle:
        return {"ok": True,
                "narration": f"No daily note saved for {d}.",
                "date": d, "empty": True}
    fields = {
        "Prep": bundle.get("prepNotes"),
        "Mid-day": bundle.get("midDayNotes"),
        "Recap": bundle.get("recapNotes"),
        "General": bundle.get("notes"),
    }
    populated = [(k, v) for k, v in fields.items() if v and str(v).strip()]
    if not populated:
        return {"ok": True, "narration": f"Your {d} note is empty.",
                "date": d, "empty": True}
    sections = []
    for label, text in populated:
        # Truncate each section for spoken length
        snippet = text[:300] + ("…" if len(text) > 300 else "")
        sections.append(f"{label}: {snippet}")
    return {
        "ok": True,
        "narration": " ".join(sections),
        "date": d,
        "sections": [{"label": k, "text": v} for k, v in populated],
    }


def get_my_weekly_review(*, user_id: str) -> dict:
    """Quick weekly bucket summary — trades, wins, losses, net for current ISO week."""
    from api.services.journal_two import calendar as j2_calendar
    today = _date.today()
    iso_year, iso_week, _ = today.isocalendar()
    try:
        data = j2_calendar.get_calendar(
            user_id, view="week", year=iso_year, week=iso_week,
        )
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "narration": "Couldn't load this week's review.",
                "error": str(e)}
    days = data.get("days") or []
    totals = data.get("totals") or {}
    wins = sum((d.get("wins") or 0) for d in days)
    losses = sum((d.get("losses") or 0) for d in days)
    net = totals.get("pnlDollar") or 0
    direction = "up" if net >= 0 else "down"
    return {
        "ok": True,
        "narration": (
            f"This week — {wins} wins, {losses} losses, "
            f"net {direction} ${abs(round(float(net), 2)):,}."
        ),
        "iso_year": iso_year,
        "iso_week": iso_week,
        "wins": wins,
        "losses": losses,
        "net_pnl": float(net),
        "trade_count": totals.get("tradeCount") or 0,
    }


# ── Accounts ───────────────────────────────────────────────────────────────

def get_my_account_balance(*, account_name: str | None = None, user_id: str) -> dict:
    """Read back the closed-trade equity balance for an account (or default)."""
    from api.services.journal_two import accounts as j2_accounts
    accounts = j2_accounts.list_accounts(user_id) or []
    if not accounts:
        return {"ok": True, "narration": "You have no journal accounts.",
                "accounts": []}
    target_name = (account_name or "").strip().lower()
    chosen = None
    if not target_name or target_name in ("default", "current", "active"):
        chosen = j2_accounts.get_or_migrate_default_account(user_id)
    else:
        for acc in accounts:
            label = (acc.get("displayName") or acc.get("name") or "").strip().lower()
            if label == target_name or target_name in label:
                chosen = acc
                break
        if chosen is None:
            chosen = j2_accounts.get_or_migrate_default_account(user_id)
    name = chosen.get("displayName") or chosen.get("name") or "Default"
    # Pull closed-trade equity from comparison() / metrics
    balance = None
    try:
        cmp_data = j2_accounts.comparison(user_id) or {}
        for row in cmp_data.get("accounts") or []:
            if row.get("id") == chosen.get("id"):
                balance = row.get("balance") or row.get("totalEquity")
                break
    except Exception:
        balance = None
    if balance is None:
        # Fallback: starting size + zero P&L
        settings = chosen.get("settings") or {}
        balance = settings.get("accountSize") or 0
    return {
        "ok": True,
        "narration": (
            f"{name} balance is ${abs(round(float(balance), 2)):,}."
        ),
        "account_id": chosen.get("id"),
        "account_name": name,
        "balance": float(balance),
    }


def switch_account(*, account_name: str, user_id: str) -> dict:
    """Switch the user's active J2 account (client-side localStorage flip)."""
    from api.services.journal_two import accounts as j2_accounts
    target_name = (account_name or "").strip().lower()
    if not target_name:
        return {"ok": False, "narration": "Switch to which account?"}
    accounts = j2_accounts.list_accounts(user_id) or []
    chosen = None
    for acc in accounts:
        label = (acc.get("displayName") or acc.get("name") or "").strip().lower()
        if label == target_name or target_name in label:
            chosen = acc
            break
    if chosen is None:
        return {
            "ok": False,
            "narration": f"I couldn't find a {account_name!r} account. "
                         "Say 'list my accounts' to hear them.",
        }
    return {
        "ok": True,
        "narration": f"Switched to {chosen.get('displayName') or chosen.get('name')}.",
        "client_action": {
            "type": "switch_account",
            "account_id": chosen.get("id"),
            "name": chosen.get("displayName") or chosen.get("name"),
        },
    }


def list_my_accounts(*, user_id: str) -> dict:
    """Read back the user's journal accounts."""
    from api.services.journal_two import accounts as j2_accounts
    accounts = j2_accounts.list_accounts(user_id) or []
    if not accounts:
        return {"ok": True, "narration": "You have no journal accounts.",
                "accounts": []}
    names = [a.get("displayName") or a.get("name") for a in accounts if a.get("displayName") or a.get("name")]
    return {
        "ok": True,
        "narration": "Your accounts — " + ", ".join(names) + ".",
        "accounts": [{"id": a.get("id"),
                      "name": a.get("displayName") or a.get("name")} for a in accounts],
        "count": len(accounts),
    }


# ── Option strategies ──────────────────────────────────────────────────────

def get_my_option_strategies(*, status: str | None = None, count: int = 5,
                             user_id: str) -> dict:
    """Recent option strategies, optionally filtered by status (open/closed)."""
    from api.services.journal_two import options as j2_options
    from api.services.journal_two import accounts as j2_accounts
    s = (status or "").strip().lower()
    if s not in ("open", "closed", ""):
        return {"ok": False,
                "narration": "Status must be open or closed."}
    n = max(1, min(15, int(count or 5)))
    account_id = None
    try:
        account_id = j2_accounts.get_or_migrate_default_account(user_id)["id"]
    except Exception:
        pass
    try:
        strategies = j2_options.list_strategies(
            user_id, account_id=account_id, status=s or None,
        )
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "narration": "Couldn't load option strategies.",
                "error": str(e)}
    if not strategies:
        return {"ok": True, "narration": "No option strategies logged.",
                "strategies": []}
    strategies = strategies[:n]
    parts = []
    for s_ in strategies:
        sym = s_.get("symbol") or "?"
        st = s_.get("strategyType") or s_.get("strategy_type") or "?"
        parts.append(f"{sym} {st}")
    return {
        "ok": True,
        "narration": "Option strategies — " + ", ".join(parts) + ".",
        "strategies": [
            {"id": s_.get("id"),
             "symbol": s_.get("symbol"),
             "strategy_type": s_.get("strategyType") or s_.get("strategy_type"),
             "status": s_.get("status"),
             "pnl": s_.get("pnlDollar") or s_.get("pnl_dollar")}
            for s_ in strategies
        ],
        "count": len(strategies),
    }
