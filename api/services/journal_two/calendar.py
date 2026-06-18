"""
Journal 2.0 — calendar aggregation + day-notes service.

Aggregates closed trades into per-day buckets for the Calendar tab's
Year/Month/Week views. Bucket key is the trade's exit_date converted to
America/New_York (canonical trading-session day) per design spec §4.

Day notes (reflection text + attachments + rules checklist) are global
per (user, date) — NOT per-account, per spec §2 + Calendar spec.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import date as Date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover — Python 3.8
    from backports.zoneinfo import ZoneInfo  # type: ignore

from api.services.auth_db import get_connection


ET = ZoneInfo("America/New_York")
UTC = timezone.utc


# ── Date utilities ───────────────────────────────────────────────────────────


def to_et_date(iso_utc: str) -> str:
    """Convert a UTC-ISO timestamp to a YYYY-MM-DD bucket in America/New_York.

    Used to bucket trades into trading-session days. After-hours trades
    (4-8pm ET) bucket to the same calendar day as regular session;
    overnight trades (8pm-midnight ET) also stay on the same day; trades
    after midnight ET roll to the next day.
    """
    if not iso_utc:
        raise ValueError("iso_utc is required")
    raw = iso_utc.replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(ET).strftime("%Y-%m-%d")


def _iso_week_bounds(year: int, week: int) -> tuple[Date, Date]:
    """ISO 8601 week → (Monday, Sunday) date pair."""
    jan4 = Date(year, 1, 4)
    jan4_dow = jan4.isoweekday()  # 1 = Monday
    week1_monday = jan4 - timedelta(days=jan4_dow - 1)
    monday = week1_monday + timedelta(weeks=week - 1)
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _month_bounds(year: int, month: int) -> tuple[Date, Date]:
    """First and last calendar day of a month."""
    first = Date(year, month, 1)
    if month == 12:
        last = Date(year, 12, 31)
    else:
        last = Date(year, month + 1, 1) - timedelta(days=1)
    return first, last


def _year_bounds(year: int) -> tuple[Date, Date]:
    return Date(year, 1, 1), Date(year, 12, 31)


# ── Aggregation core ─────────────────────────────────────────────────────────


def _account_size_for_user(
    user_id: str,
    conn: sqlite3.Connection,
    *,
    account_id: str | None = None,
) -> float:
    """Return the user's accountSize. If account_id is provided, returns
    that account's account_size. Otherwise sums across all accounts
    (sensible for "All Accounts" view), falling back to legacy
    j2_settings if no accounts exist yet."""
    if account_id:
        row = conn.execute(
            "SELECT account_size FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        if row:
            return float(row["account_size"])
    # All-accounts: sum of account sizes
    row = conn.execute(
        "SELECT COALESCE(SUM(account_size), 0) AS total FROM j2_accounts "
        "WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row and row["total"]:
        return float(row["total"])
    # Legacy fallback (pre-migration)
    row = conn.execute(
        "SELECT data FROM j2_settings WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        return 100_000.0
    try:
        data = json.loads(row["data"])
    except (TypeError, json.JSONDecodeError):
        return 100_000.0
    size = data.get("accountSize", 100_000)
    return float(size) if isinstance(size, (int, float)) else 100_000.0


def _empty_bucket(d: str) -> dict[str, Any]:
    return {
        "date": d,
        "pnlDollar": 0.0,
        "rSum": 0.0,
        "tradeCount": 0,
        "winners": 0,
        "losers": 0,
    }


def _aggregate_trades(
    rows: list[sqlite3.Row],
    account_size: float,
    *,
    _extra_bucket: dict[str, dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Bucket trades by ET exit-date and return (days, totals).

    `_extra_bucket` is an optional pre-populated bucket dict (e.g. from
    option strategies) to fold in before final flattening.
    """
    bucket: dict[str, dict[str, Any]] = _extra_bucket or {}
    for r in rows:
        d = to_et_date(r["exit_date"])
        b = bucket.setdefault(d, _empty_bucket(d))
        b["pnlDollar"] += float(r["pnl_dollar"] or 0)
        if r["r_multiple"] is not None:
            b["rSum"] += float(r["r_multiple"])
        b["tradeCount"] += 1
        if r["result"] == "Win":
            b["winners"] += 1
        elif r["result"] == "Loss":
            b["losers"] += 1

    # pnlPercent = day's pnl / accountSize (scale-invariant heat for cell color)
    for b in bucket.values():
        b["pnlPercent"] = (
            b["pnlDollar"] / account_size if account_size > 0 else 0.0
        )

    days = sorted(bucket.values(), key=lambda x: x["date"])

    total_pnl = sum(b["pnlDollar"] for b in days)
    total_r = sum(b["rSum"] for b in days)
    trade_count = sum(b["tradeCount"] for b in days)
    winners = sum(b["winners"] for b in days)
    losers = sum(b["losers"] for b in days)
    win_rate = (
        winners / (winners + losers) if (winners + losers) > 0 else None
    )
    totals = {
        "netPnlDollar": total_pnl,
        "grossPnlDollar": total_pnl,  # fees field not yet on trades; future-proofed
        "fees": 0.0,
        "tradeCount": trade_count,
        "winners": winners,
        "losers": losers,
        "winRate": win_rate,
        "rSum": total_r,
    }
    return days, totals


def _account_is_broker(
    user_id: str, account_id: str, conn: sqlite3.Connection
) -> bool:
    """True iff the account row's balance_source is broker-sourced (not manual)."""
    row = conn.execute(
        "SELECT balance_source FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if row is None:
        return False
    keys = row.keys()
    src = row["balance_source"] if "balance_source" in keys else "manual"
    return bool(src) and src != "manual"


def _load_equity_series(
    user_id: str, account_id: str, conn: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    """Live-edged daily net-liq series for a broker account. Returns [] on any
    failure so the calendar always degrades to closed-trade mode rather than
    erroring. Monkeypatched in tests."""
    try:
        from api.services.journal_two import accounts as _accounts
        from api.services.journal_two.broker import historical_equity
        acct = _accounts.get_account(user_id, account_id, conn=conn)
        live_eq = (
            float(acct["brokerTotalEquity"])
            if acct and acct.get("brokerTotalEquity") is not None
            else None
        )
        return historical_equity.reconstruct_daily_equity(
            user_id, account_id, live_equity=live_eq, conn=conn
        ) or []
    except Exception:
        return []


def _account_equity_days(
    series: list[dict[str, Any]],
    start_iso: str,
    end_iso: str,
    closed_days: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Difference a daily net-liq series into per-day balance-change buckets.

    `series` is the full ascending [{date, equity}, ...] reconstruction. Each
    in-window day's pnlDollar = equity(d) − equity(immediately-preceding point
    in the FULL series); the absolute first point (no predecessor) is skipped.
    pnlPercent = delta / prevEquity. Badge/count fields are overlaid from the
    closed-trade aggregation (`closed_days`)."""
    closed_by_date = {d["date"]: d for d in closed_days}

    days: list[dict[str, Any]] = []
    window_first_prev: float | None = None
    window_last_equity: float | None = None

    for i, point in enumerate(series):
        d = point["date"]
        if not (start_iso <= d <= end_iso):
            continue
        if i == 0:
            # Inception day: no predecessor → no defined daily change. Skip.
            continue
        prev_equity = float(series[i - 1]["equity"])
        equity = float(point["equity"])
        delta = equity - prev_equity
        if window_first_prev is None:
            window_first_prev = prev_equity
        window_last_equity = equity

        c = closed_by_date.get(d, {})
        days.append({
            "date": d,
            "pnlDollar": delta,
            "pnlPercent": (delta / prev_equity) if prev_equity > 0 else 0.0,
            "rSum": c.get("rSum", 0.0),
            "tradeCount": c.get("tradeCount", 0),
            "winners": c.get("winners", 0),
            "losers": c.get("losers", 0),
            "hasNotes": c.get("hasNotes", False),
            "expiringCount": c.get("expiringCount", 0),
        })

    days.sort(key=lambda x: x["date"])

    net = (
        (window_last_equity - window_first_prev)
        if (window_last_equity is not None and window_first_prev is not None)
        else 0.0
    )
    winners = sum(c.get("winners", 0) for c in closed_days)
    losers = sum(c.get("losers", 0) for c in closed_days)
    totals = {
        "netPnlDollar": net,
        "grossPnlDollar": net,
        "fees": 0.0,
        "tradeCount": sum(c.get("tradeCount", 0) for c in closed_days),
        "winners": winners,
        "losers": losers,
        "winRate": (winners / (winners + losers)) if (winners + losers) > 0 else None,
        "rSum": sum(c.get("rSum", 0.0) for c in closed_days),
    }
    return days, totals


def _fetch_strategies_in_window(
    user_id: str,
    sql_lo: str,
    sql_hi: str,
    conn: sqlite3.Connection,
    *,
    account_id: str | None = None,
) -> list[sqlite3.Row]:
    """Closed option strategies with closed_at in the SQL range.
    ET-bucket filtering happens on the caller side."""
    if account_id:
        return conn.execute(
            """
            SELECT id, closed_at, pnl_dollar, r_multiple, result, status
              FROM j2_option_strategies
             WHERE user_id = ? AND account_id = ?
               AND status != 'open'
               AND closed_at >= ? AND closed_at <= ?
            """,
            (user_id, account_id, sql_lo, sql_hi),
        ).fetchall()
    return conn.execute(
        """
        SELECT id, closed_at, pnl_dollar, r_multiple, result, status
          FROM j2_option_strategies
         WHERE user_id = ?
           AND status != 'open'
           AND closed_at >= ? AND closed_at <= ?
        """,
        (user_id, sql_lo, sql_hi),
    ).fetchall()


def _fetch_expiring_legs(
    user_id: str,
    start_iso: str,
    end_iso: str,
    conn: sqlite3.Connection,
    *,
    account_id: str | None = None,
) -> list[sqlite3.Row]:
    """Open-strategy legs whose expiration falls in the date window.
    Returns one row per leg with its strategy id + expiration."""
    params: list[Any] = [user_id, start_iso, end_iso]
    sql = (
        "SELECT s.id AS strategy_id, l.expiration "
        "  FROM j2_option_legs l "
        "  JOIN j2_option_strategies s ON s.id = l.strategy_id "
        " WHERE s.user_id = ? AND s.status = 'open' "
        "   AND l.expiration >= ? AND l.expiration <= ?"
    )
    if account_id:
        sql += " AND s.account_id = ?"
        params.append(account_id)
    return conn.execute(sql, params).fetchall()


def _union_strategy_aggregates(
    bucket: dict[str, dict[str, Any]],
    strategies: list[sqlite3.Row],
    start_iso: str,
    end_iso: str,
) -> None:
    """Fold closed option strategies into existing day buckets (by ET
    bucketed closed_at). Mutates `bucket` in place."""
    for s in strategies:
        if s["closed_at"] is None:
            continue
        d = to_et_date(s["closed_at"])
        if not (start_iso <= d <= end_iso):
            continue
        b = bucket.setdefault(d, _empty_bucket(d))
        b["pnlDollar"] += float(s["pnl_dollar"] or 0)
        if s["r_multiple"] is not None:
            b["rSum"] += float(s["r_multiple"])
        b["tradeCount"] += 1
        if s["result"] == "Win":
            b["winners"] += 1
        elif s["result"] == "Loss":
            b["losers"] += 1


def _expiring_counts(
    expiring_legs: list[sqlite3.Row],
    start_iso: str,
    end_iso: str,
) -> dict[str, int]:
    """Distinct-strategy count of legs expiring per day. Same strategy
    with multiple legs on the same expiry counts once."""
    by_date: dict[str, set[str]] = {}
    for r in expiring_legs:
        exp = r["expiration"]
        if not (start_iso <= exp <= end_iso):
            continue
        by_date.setdefault(exp, set()).add(r["strategy_id"])
    return {d: len(ids) for d, ids in by_date.items()}


def _has_notes_set(
    user_id: str,
    date_keys: list[str],
    conn: sqlite3.Connection,
) -> set[str]:
    """Return the set of dates where the user has saved a j2_day_notes row.
    Used to badge cells with a notes indicator."""
    if not date_keys:
        return set()
    placeholders = ",".join("?" for _ in date_keys)
    rows = conn.execute(
        f"SELECT date FROM j2_day_notes WHERE user_id = ? "
        f"AND date IN ({placeholders})",
        (user_id, *date_keys),
    ).fetchall()
    return {r["date"] for r in rows}


def get_calendar(
    user_id: str,
    *,
    view: str,
    year: int,
    month: int | None = None,
    week: int | None = None,
    account_id: str | None = None,
    basis: str = "closed",
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Aggregate the user's trades for the requested period.

    Returns a payload matching design-spec §6.1: {view, year, month?,
    week?, days[], totals}. `account_id` is accepted but unused until
    Phase 2 (Accounts) ships; passes through cleanly.
    """
    if view == "year":
        start, end = _year_bounds(year)
    elif view == "month":
        if month is None:
            raise ValueError("month is required for view=month")
        start, end = _month_bounds(year, month)
    elif view == "week":
        if week is None:
            raise ValueError("week is required for view=week")
        start, end = _iso_week_bounds(year, week)
    else:
        raise ValueError(f"unknown view: {view}")

    # Convert ET-date bounds to ISO-string range for the SQL filter.
    # We grab a 1-day buffer on each side because exit_date is UTC and
    # the ET conversion can push a row into the prior/next day. The
    # in-memory bucket loop drops anything outside [start, end].
    sql_lo = (start - timedelta(days=1)).isoformat() + "T00:00:00Z"
    sql_hi = (end + timedelta(days=1)).isoformat() + "T23:59:59Z"

    owned = conn is None
    conn = conn or get_connection()
    try:
        if account_id:
            rows = conn.execute(
                """
                SELECT exit_date, pnl_dollar, r_multiple, result
                  FROM j2_trades
                 WHERE user_id = ? AND account_id = ?
                   AND exit_date >= ? AND exit_date <= ?
                """,
                (user_id, account_id, sql_lo, sql_hi),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT exit_date, pnl_dollar, r_multiple, result
                  FROM j2_trades
                 WHERE user_id = ?
                   AND exit_date >= ? AND exit_date <= ?
                """,
                (user_id, sql_lo, sql_hi),
            ).fetchall()

        # Filter rows whose ET date falls outside the requested period.
        in_window = []
        start_iso, end_iso = start.isoformat(), end.isoformat()
        for r in rows:
            et_d = to_et_date(r["exit_date"])
            if start_iso <= et_d <= end_iso:
                in_window.append(r)

        # Fold closed option strategies into the same day buckets.
        strategies = _fetch_strategies_in_window(
            user_id, sql_lo, sql_hi, conn, account_id=account_id,
        )
        extra_bucket: dict[str, dict[str, Any]] = {}
        _union_strategy_aggregates(extra_bucket, strategies, start_iso, end_iso)

        # Expiring-soon badge counts — open strategies with legs expiring in window.
        expiring_legs = _fetch_expiring_legs(
            user_id, start_iso, end_iso, conn, account_id=account_id,
        )
        expiring_by_date = _expiring_counts(expiring_legs, start_iso, end_iso)

        account_size = _account_size_for_user(user_id, conn, account_id=account_id)
        days, totals = _aggregate_trades(
            in_window, account_size, _extra_bucket=extra_bucket,
        )

        # Mark days that have user-saved notes + expiring strategies.
        notes_set = _has_notes_set(user_id, [d["date"] for d in days], conn)
        for d in days:
            d["hasNotes"] = d["date"] in notes_set
            d["expiringCount"] = expiring_by_date.get(d["date"], 0)

        # A day with only an expiring leg and no trades/closes still needs
        # to show the badge. Add zero-P&L bucket entries for those.
        existing_dates = {d["date"] for d in days}
        for exp_date, count in expiring_by_date.items():
            if exp_date not in existing_dates:
                bucket = _empty_bucket(exp_date)
                bucket["pnlPercent"] = 0.0
                bucket["hasNotes"] = exp_date in notes_set
                bucket["expiringCount"] = count
                days.append(bucket)
        days.sort(key=lambda x: x["date"])

        # Account-balance basis (broker accounts only): replace the closed-trade
        # day numbers with the net-liq close-to-close deltas, overlaying the
        # closed-trade counts/notes as badges. Falls back to closed silently.
        effective_basis = "closed"
        if (
            basis == "account"
            and account_id
            and _account_is_broker(user_id, account_id, conn)
        ):
            series = _load_equity_series(user_id, account_id, conn)
            if series:
                days, totals = _account_equity_days(
                    series, start.isoformat(), end.isoformat(), days,
                )
                effective_basis = "account"

        payload: dict[str, Any] = {
            "view": view,
            "year": year,
            "basis": effective_basis,
            "days": days,
            "totals": totals,
        }
        if view == "month":
            payload["month"] = month
        elif view == "week":
            payload["week"] = week
        return payload
    finally:
        if owned:
            conn.close()


def get_day_detail(
    user_id: str,
    date: str,
    *,
    account_id: str | None = None,
    basis: str = "closed",
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Return the day's metrics + trade list + (optional) saved notes."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        # Pull all of user's trades and filter to this ET-date in code
        # (avoids forcing SQL-side timezone math).
        sql_lo = (
            datetime.fromisoformat(date).replace(tzinfo=ET) - timedelta(days=1)
        ).astimezone(UTC).isoformat()
        sql_hi = (
            datetime.fromisoformat(date).replace(tzinfo=ET)
            + timedelta(days=2)
        ).astimezone(UTC).isoformat()

        if account_id:
            rows = conn.execute(
                """
                SELECT * FROM j2_trades
                 WHERE user_id = ? AND account_id = ?
                   AND exit_date >= ? AND exit_date <= ?
                 ORDER BY exit_date ASC
                """,
                (user_id, account_id, sql_lo, sql_hi),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM j2_trades
                 WHERE user_id = ?
                   AND exit_date >= ? AND exit_date <= ?
                 ORDER BY exit_date ASC
                """,
                (user_id, sql_lo, sql_hi),
            ).fetchall()

        same_day = [r for r in rows if to_et_date(r["exit_date"]) == date]

        # Option strategies: closed on this day + open ones expiring today.
        closed_strategies = _fetch_strategies_in_window(
            user_id, sql_lo, sql_hi, conn, account_id=account_id,
        )
        same_day_strategies = [
            s for s in closed_strategies
            if s["closed_at"] and to_et_date(s["closed_at"]) == date
        ]
        expiring_today = _fetch_expiring_legs(
            user_id, date, date, conn, account_id=account_id,
        )
        expiring_strategy_ids = {r["strategy_id"] for r in expiring_today}

        # Union the strategies into the metrics row.
        extra_bucket: dict[str, dict[str, Any]] = {}
        _union_strategy_aggregates(extra_bucket, same_day_strategies, date, date)

        # Reuse aggregation logic for the metrics row.
        account_size = _account_size_for_user(user_id, conn, account_id=account_id)
        _, totals = _aggregate_trades(
            same_day, account_size, _extra_bucket=extra_bucket,
        )
        # Day-detail metrics include a pnlPercent (vs account size).
        pnl_pct = (
            totals["netPnlDollar"] / account_size if account_size > 0 else 0.0
        )

        metrics = {**totals, "pnlPercent": pnl_pct}
        # Account-balance basis: add the day's net-liq change + realized/open split.
        if (
            basis == "account"
            and account_id
            and _account_is_broker(user_id, account_id, conn)
        ):
            series = _load_equity_series(user_id, account_id, conn)
            by_date = {p["date"]: float(p["equity"]) for p in series}
            dates = sorted(by_date)
            if date in by_date:
                idx = dates.index(date)
                if idx > 0:
                    bal_change = by_date[date] - by_date[dates[idx - 1]]
                    realized = float(totals["netPnlDollar"])
                    metrics = {
                        **metrics,
                        "basis": "account",
                        "accountBalanceChange": bal_change,
                        "realizedPnl": realized,
                        "unrealizedChange": bal_change - realized,
                    }

        trades_out = []
        for r in same_day:
            trades_out.append(
                {
                    "id": r["id"],
                    "symbol": r["symbol"],
                    "side": r["side"],
                    "shares": float(r["shares"]),
                    "entryPrice": float(r["entry_price"]),
                    "entryDate": r["entry_date"],
                    "exitPrice": float(r["exit_price"]),
                    "exitDate": r["exit_date"],
                    "originalStop": float(r["original_stop"]),
                    "setup": r["setup"],
                    "notes": r["notes"],
                    "pnlDollar": float(r["pnl_dollar"]),
                    "pnlPercent": float(r["pnl_percent"]),
                    "rMultiple": (
                        None if r["r_multiple"] is None
                        else float(r["r_multiple"])
                    ),
                    "holdDays": int(r["hold_days"]),
                    "result": r["result"],
                }
            )

        notes = get_day_notes(user_id, date, conn=conn)

        # Strategy payloads: include a thin shape the day-detail UI can render
        # without needing another round-trip for leg data. Reuse options service
        # row→dict helpers by fetching full rows.
        strategies_out: dict[str, list[dict[str, Any]]] = {
            "closed": [],
            "expiring": [],
        }
        if same_day_strategies or expiring_strategy_ids:
            from api.services.journal_two.options import (
                _row_to_strategy, _fetch_legs,
            )
            ids_to_fetch = {s["id"] for s in same_day_strategies} | expiring_strategy_ids
            placeholders = ",".join("?" * len(ids_to_fetch))
            strategy_rows = conn.execute(
                f"SELECT * FROM j2_option_strategies "
                f"WHERE id IN ({placeholders}) AND user_id = ?",
                (*ids_to_fetch, user_id),
            ).fetchall()
            by_id = {r["id"]: r for r in strategy_rows}
            for s in same_day_strategies:
                full = by_id.get(s["id"])
                if full is None:
                    continue
                strategies_out["closed"].append(
                    _row_to_strategy(full, _fetch_legs(conn, full["id"])),
                )
            for sid in expiring_strategy_ids:
                full = by_id.get(sid)
                if full is None or full["status"] != "open":
                    continue
                strategies_out["expiring"].append(
                    _row_to_strategy(full, _fetch_legs(conn, sid)),
                )

        return {
            "date": date,
            "metrics": metrics,
            "trades": trades_out,
            "strategies": strategies_out,
            "notes": notes,
        }
    finally:
        if owned:
            conn.close()


# ── Day notes CRUD ───────────────────────────────────────────────────────────


MAX_NOTE_CHARS = 10_000
MAX_ATTACHMENTS = 5
MAX_RULES = 25


class DayNotesValidationError(ValueError):
    """Raised when day-notes payload is malformed or exceeds caps."""


def _validate_attachments(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise DayNotesValidationError("attachments must be a list")
    if len(raw) > MAX_ATTACHMENTS:
        raise DayNotesValidationError(
            f"attachments exceeds cap of {MAX_ATTACHMENTS}"
        )
    out = []
    for item in raw:
        if not isinstance(item, dict):
            raise DayNotesValidationError("attachment entries must be objects")
        kind = item.get("kind")
        url = item.get("url")
        if kind not in ("link", "image"):
            raise DayNotesValidationError("attachment.kind must be link|image")
        if not isinstance(url, str) or not url.strip():
            raise DayNotesValidationError("attachment.url is required")
        label = item.get("label")
        out.append(
            {
                "kind": kind,
                "url": url.strip(),
                "label": label.strip() if isinstance(label, str) else "",
                "addedAt": item.get("addedAt") or _now_iso(),
            }
        )
    return out


def _validate_rules(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise DayNotesValidationError("rules must be a list")
    if len(raw) > MAX_RULES:
        raise DayNotesValidationError(f"rules exceeds cap of {MAX_RULES}")
    out = []
    for item in raw:
        if not isinstance(item, dict):
            raise DayNotesValidationError("rule entries must be objects")
        rid = item.get("id") or str(uuid.uuid4())
        label = item.get("label", "")
        if not isinstance(label, str):
            raise DayNotesValidationError("rule.label must be string")
        out.append(
            {
                "id": str(rid),
                "label": label.strip(),
                "checked": bool(item.get("checked", False)),
            }
        )
    return out


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def get_day_notes(
    user_id: str,
    date: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Return the saved day-notes bundle, or None if nothing saved yet.

    The bundle has four narrative fields (general `notes`, `prepNotes`,
    `midDayNotes`, `recapNotes`) plus `attachments` and `rules`. New
    write paths (post-Phase-5) write prep/mid-day/recap; the general
    `notes` column stays as legacy / general-purpose reflection.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            """
            SELECT notes, prep_notes, mid_day_notes, recap_notes,
                   attachments, rules
              FROM j2_day_notes
             WHERE user_id = ? AND date = ?
            """,
            (user_id, date),
        ).fetchone()
        if row is None:
            return None
        keys = row.keys()
        return {
            "notes": row["notes"] or "",
            "prepNotes": (row["prep_notes"] if "prep_notes" in keys else None) or "",
            "midDayNotes": (row["mid_day_notes"] if "mid_day_notes" in keys else None) or "",
            "recapNotes": (row["recap_notes"] if "recap_notes" in keys else None) or "",
            "attachments": json.loads(row["attachments"] or "[]"),
            "rules": json.loads(row["rules"] or "[]"),
        }
    finally:
        if owned:
            conn.close()


# ── Image attachments ────────────────────────────────────────────────────────


_ATTACHMENT_ROOT = Path(
    os.environ.get(
        "J2_ATTACHMENT_ROOT",
        str(Path(__file__).resolve().parents[3] / "data" / "j2_attachments"),
    )
)
_ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_ALLOWED_IMAGE_MIMES = {
    "image/png", "image/jpeg", "image/gif", "image/webp",
}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


async def save_attachment(
    user_id: str,
    date: str,
    upload,  # FastAPI UploadFile
) -> dict[str, Any]:
    """Validate + persist an uploaded image. Returns the attachment dict
    the client merges into its day's attachments array."""
    # Date format check (router also validates; defense in depth)
    Date.fromisoformat(date)

    if upload.content_type not in _ALLOWED_IMAGE_MIMES:
        raise DayNotesValidationError(
            "Only PNG, JPG, GIF, or WebP images allowed"
        )

    raw = await upload.read()
    if len(raw) > _MAX_IMAGE_BYTES:
        raise DayNotesValidationError("Image must be < 5 MB")
    if len(raw) == 0:
        raise DayNotesValidationError("Empty file")

    ext = ""
    fname = (upload.filename or "").lower()
    for candidate in _ALLOWED_IMAGE_EXTS:
        if fname.endswith(candidate):
            ext = candidate
            break
    if not ext:
        # Fallback by MIME
        ext = {
            "image/png": ".png", "image/jpeg": ".jpg",
            "image/gif": ".gif", "image/webp": ".webp",
        }.get(upload.content_type, ".png")

    target_dir = _ATTACHMENT_ROOT / user_id / date
    target_dir.mkdir(parents=True, exist_ok=True)
    new_id = uuid.uuid4().hex
    target_path = target_dir / f"{new_id}{ext}"
    target_path.write_bytes(raw)

    public_url = f"/api/j2/attachments/{user_id}/{date}/{new_id}{ext}"
    return {
        "kind": "image",
        "url": public_url,
        "label": (upload.filename or "")[:120],
        "addedAt": _now_iso(),
    }


def serve_attachment_path(
    user_id: str,
    date: str,
    filename: str,
) -> Path | None:
    """Resolve an image filename to a disk path. Returns None if missing
    or attempting to escape the user/date directory (path traversal)."""
    Date.fromisoformat(date)  # validates date format
    if "/" in filename or "\\" in filename or filename.startswith("."):
        return None
    target = (_ATTACHMENT_ROOT / user_id / date / filename).resolve()
    root = (_ATTACHMENT_ROOT / user_id / date).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    if not target.exists():
        return None
    return target


def _validate_narrative(payload: dict[str, Any], key: str) -> str:
    v = payload.get(key, "")
    if v is None:
        return ""
    if not isinstance(v, str):
        raise DayNotesValidationError(f"{key} must be a string")
    if len(v) > MAX_NOTE_CHARS:
        raise DayNotesValidationError(
            f"{key} exceeds cap of {MAX_NOTE_CHARS} chars"
        )
    return v


def upsert_day_notes(
    user_id: str,
    date: str,
    payload: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Create or replace the day-notes row for (user, date)."""
    notes = _validate_narrative(payload, "notes")
    prep_notes = _validate_narrative(payload, "prepNotes")
    mid_day_notes = _validate_narrative(payload, "midDayNotes")
    recap_notes = _validate_narrative(payload, "recapNotes")
    attachments = _validate_attachments(payload.get("attachments", []))
    rules = _validate_rules(payload.get("rules", []))

    owned = conn is None
    conn = conn or get_connection()
    try:
        now = _now_iso()
        existing = conn.execute(
            "SELECT id, created_at FROM j2_day_notes "
            "WHERE user_id = ? AND date = ?",
            (user_id, date),
        ).fetchone()
        if existing is None:
            new_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO j2_day_notes
                  (id, user_id, date, notes, prep_notes, mid_day_notes,
                   recap_notes, attachments, rules, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id, user_id, date, notes,
                    prep_notes, mid_day_notes, recap_notes,
                    json.dumps(attachments), json.dumps(rules),
                    now, now,
                ),
            )
        else:
            conn.execute(
                """
                UPDATE j2_day_notes
                   SET notes = ?, prep_notes = ?, mid_day_notes = ?,
                       recap_notes = ?, attachments = ?, rules = ?,
                       updated_at = ?
                 WHERE id = ?
                """,
                (
                    notes, prep_notes, mid_day_notes, recap_notes,
                    json.dumps(attachments), json.dumps(rules),
                    now, existing["id"],
                ),
            )
        conn.commit()
        return {
            "notes": notes,
            "prepNotes": prep_notes,
            "midDayNotes": mid_day_notes,
            "recapNotes": recap_notes,
            "attachments": attachments,
            "rules": rules,
            "updatedAt": now,
        }
    finally:
        if owned:
            conn.close()
