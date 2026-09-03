"""
Intervention rule engine — detects tilt patterns at decision points.

4 rules with cooldowns:
- rapid_fire_trading: 3+ trades closed in last 60 min (1 hr cooldown)
- daily_loss_approach: net daily P&L past 75% of dailyLossLimitPct (4 hr cooldown)
- loss_streak: 3+ consecutive losses today (2 hr cooldown)
- cooling_off_active: within coolingOffMinutesAfterLoss of last loss (auto-clears)

evaluate_interventions returns active (non-dismissed, within-cooldown)
interventions. Persists new firings to j2_interventions; reuses existing
firings within cooldown rather than duplicating.
"""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from datetime import date as Date, datetime, timezone, timedelta
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.calendar import _row_et_day, et_today
from api.services.journal_two.coach_scope import is_unified, resolve_account_scope


COOLDOWNS_MIN = {
    "rapid_fire_trading": 60,
    "daily_loss_approach": 240,
    "loss_streak": 120,
    "cooling_off_active": 0,  # auto-clears via dynamic check
    # Portfolio-level (unified '_all_' scope) — higher thresholds since they
    # aggregate every account.
    "portfolio_rapid_fire": 60,
    "portfolio_daily_loss": 240,
    "portfolio_loss_streak": 120,
}


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def _active_firing(conn, *, user_id: str, account_id: str, rule: str) -> dict | None:
    """Return the most recent non-dismissed firing of `rule` whose cooldown hasn't expired."""
    now_iso = datetime.now(timezone.utc).isoformat()
    row = conn.execute(
        """SELECT id, severity, message, factors, fired_at, cooldown_until
           FROM j2_interventions
           WHERE user_id = ? AND account_id = ? AND rule = ?
             AND dismissed_at IS NULL
             AND cooldown_until > ?
           ORDER BY fired_at DESC LIMIT 1""",
        (user_id, account_id, rule, now_iso),
    ).fetchone()
    if row is None:
        return None
    try:
        factors = json.loads(row["factors"] or "[]")
    except (TypeError, json.JSONDecodeError):
        factors = []
    return {
        "id": row["id"], "rule": rule,
        "severity": row["severity"], "message": row["message"],
        "factors": factors, "fired_at": row["fired_at"],
        "cooldown_until": row["cooldown_until"],
    }


def _record_firing(
    conn, *, user_id: str, account_id: str, rule: str,
    severity: str, message: str, factors: list,
) -> dict:
    iid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    cooldown_min = COOLDOWNS_MIN.get(rule, 60)
    cooldown_until = (now + timedelta(minutes=cooldown_min)).isoformat()
    fired_at = now.isoformat()
    conn.execute(
        """INSERT INTO j2_interventions
           (id, user_id, account_id, rule, severity, message, factors,
            fired_at, cooldown_until, dismissed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
        (iid, user_id, account_id, rule, severity, message,
         json.dumps(factors), fired_at, cooldown_until),
    )
    conn.commit()
    return {
        "id": iid, "rule": rule, "severity": severity, "message": message,
        "factors": factors, "fired_at": fired_at, "cooldown_until": cooldown_until,
    }


def _check_rapid_fire(conn, *, user_id, account_id) -> dict | None:
    """3+ closed trades in last 60 min."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=60)).isoformat()
    n = conn.execute(
        """SELECT COUNT(*) AS n FROM j2_trades
           WHERE user_id = ? AND account_id = ? AND exit_date >= ?""",
        (user_id, account_id, cutoff),
    ).fetchone()["n"]
    if n >= 3:
        return {
            "severity": "warning",
            "message": f"You've closed {n} trades in the last hour. Compass thinks you're hunting — slow down.",
            "factors": [f"{n} closed trades in last 60 minutes"],
        }
    return None


# ⛔ Bucketing a trade into "today" is a TWO-sided question, and both sides
# have to speak the same calendar. Until 2026-09-02 both sides here spoke
# UTC: `substr(exit_date,1,10)` on the row, `datetime.now(timezone.utc)` on
# the comparison. UTC midnight is 8pm ET, so a member trading the evening
# session rolled onto a new "day" mid-session and the consecutive-loss
# counter reset under them -- the step-away warning going quiet exactly when
# tilt is likeliest. Every other module in journal_two (accounts, analytics,
# calendar) already buckets on the ET trading-session day; this was the
# holdout.
#
# ⛔ The fix is NOT simply comparing against an ET date in SQL. A row without
# the stamped `trading_day_et` spine (legacy rows predating it) still yields
# its UTC prefix, so comparing that to an ET day mismatches for the same four
# hours -- a half-conversion, worse than either whole one.
# `calendar._row_et_day` is this codebase's answer and resolves both cases:
# the stamped column when present, a DST-correct `to_et_date()` conversion
# when not. accounts.py:931 filters exactly this way. SQL narrows to a
# generous UTC window; Python decides.
def _rows_on_et_day(rows, day: str) -> list:
    """The rows whose ET trading-session day is `day`, spine-aware."""
    return [r for r in rows if _row_et_day(r, "exit_date") == day]


def _utc_lower_bound(day: str) -> str:
    """A safe lexicographic floor for a UTC-ISO `exit_date` when looking for
    ET day `day`. ET is behind UTC, so one calendar day back always covers
    it, and `_rows_on_et_day` does the exact filtering afterwards."""
    return (Date.fromisoformat(day) - timedelta(days=1)).isoformat()


def _check_daily_loss_approach(conn, *, user_id, account_id) -> dict | None:
    """Net daily P&L past 75% of dailyLossLimitPct."""
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    limit_pct = settings.get("dailyLossLimitPct")
    if limit_pct is None or account_size <= 0:
        return None
    threshold_dollar = -0.75 * float(limit_pct) * account_size / 100.0
    today_iso = et_today()
    rows = _rows_on_et_day(conn.execute(
        """SELECT pnl_dollar, exit_date, trading_day_et FROM j2_trades
           WHERE user_id = ? AND account_id = ? AND exit_date >= ?""",
        (user_id, account_id, _utc_lower_bound(today_iso)),
    ).fetchall(), today_iso)
    net = sum(float(r["pnl_dollar"] or 0) for r in rows)
    if net <= threshold_dollar:
        return {
            "severity": "danger",
            "message": f"You're down ${abs(net):.0f} today — past 75% of your {limit_pct}% daily loss limit. Compass strongly recommends stepping away.",
            "factors": [
                f"today realized {net:.0f}",
                f"75% threshold = {threshold_dollar:.0f}",
            ],
        }
    return None


def _check_loss_streak(conn, *, user_id, account_id) -> dict | None:
    """3+ consecutive losses today (no winner since the streak started)."""
    today_iso = et_today()
    rows = _rows_on_et_day(conn.execute(
        """SELECT result, exit_date, trading_day_et FROM j2_trades
           WHERE user_id = ? AND account_id = ? AND exit_date >= ?
           ORDER BY exit_date DESC""",
        (user_id, account_id, _utc_lower_bound(today_iso)),
    ).fetchall(), today_iso)
    streak = 0
    for r in rows:
        if r["result"] == "Loss":
            streak += 1
        else:
            break
    if streak >= 3:
        return {
            "severity": "danger",
            "message": f"{streak} consecutive losses today. Compass strongly suggests stepping away before the next trade.",
            "factors": [f"{streak} consecutive losses today"],
        }
    return None


def _check_cooling_off_active(conn, *, user_id, account_id) -> dict | None:
    """Within coolingOffMinutesAfterLoss of last closed loss."""
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    cooling_min = settings.get("coolingOffMinutesAfterLoss")
    if cooling_min is None or int(cooling_min) <= 0:
        return None
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=int(cooling_min))).isoformat()
    row = conn.execute(
        """SELECT exit_date FROM j2_trades
           WHERE user_id = ? AND account_id = ? AND result = 'Loss'
             AND exit_date >= ?
           ORDER BY exit_date DESC LIMIT 1""",
        (user_id, account_id, cutoff),
    ).fetchone()
    if row is None:
        return None
    # Cooling-off ALWAYS fires while a recent loss is within window (no cooldown).
    # We deliberately bypass _active_firing for this rule.
    return {
        "severity": "warning",
        "message": f"Cooling-off active — you took a loss in the last {cooling_min} minutes. Pause before the next entry.",
        "factors": [f"last loss at {row['exit_date'][:16]}"],
    }


RULE_CHECKS = {
    "rapid_fire_trading": _check_rapid_fire,
    "daily_loss_approach": _check_daily_loss_approach,
    "loss_streak": _check_loss_streak,
    "cooling_off_active": _check_cooling_off_active,
}


# ── Portfolio-level rules (unified '_all_' scope) ────────────────────────────
#
# Same tilt patterns, but aggregated across every compass_enabled account.
# Thresholds are raised vs. the single-account rules because a multi-account
# trader naturally has more total activity. account_id is always '_all_' here,
# so firings persist + cooldown under the unified bucket.


def _check_portfolio_rapid_fire(conn, *, user_id, account_id) -> dict | None:
    """6+ closed trades across ALL accounts in the last 60 min."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return None
    ph = ",".join("?" * len(ids))
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=60)).isoformat()
    n = conn.execute(
        f"""SELECT COUNT(*) AS n FROM j2_trades
            WHERE user_id = ? AND account_id IN ({ph}) AND exit_date >= ?""",
        [user_id, *ids, cutoff],
    ).fetchone()["n"]
    if n >= 6:
        return {
            "severity": "warning",
            "message": f"You've closed {n} trades across your accounts in the last hour. Compass thinks you're hunting — slow down everywhere.",
            "factors": [f"{n} closed trades across all accounts in last 60 minutes"],
        }
    return None


def _check_portfolio_daily_loss(conn, *, user_id, account_id) -> dict | None:
    """Aggregate today's realized P&L across all accounts past 75% of the
    SUM of each account's own dailyLossLimit threshold. Only accounts that
    actually set a dailyLossLimitPct contribute to the threshold."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return None
    total_threshold = 0.0
    have_any_limit = False
    for aid in ids:
        s = accounts_service.get_account_settings(user_id, aid, conn=conn) or {}
        acct_size = float(s.get("accountSize") or 0)
        lim = s.get("dailyLossLimitPct")
        if lim is not None and acct_size > 0:
            have_any_limit = True
            total_threshold += -0.75 * float(lim) * acct_size / 100.0
    if not have_any_limit:
        return None
    ph = ",".join("?" * len(ids))
    today_iso = et_today()
    rows = _rows_on_et_day(conn.execute(
        f"""SELECT pnl_dollar, exit_date, trading_day_et FROM j2_trades
            WHERE user_id = ? AND account_id IN ({ph}) AND exit_date >= ?""",
        [user_id, *ids, _utc_lower_bound(today_iso)],
    ).fetchall(), today_iso)
    net = sum(float(r["pnl_dollar"] or 0) for r in rows)
    if net <= total_threshold:
        return {
            "severity": "danger",
            "message": f"You're down ${abs(net):.0f} across your accounts today — past 75% of your combined daily loss limits. Compass strongly recommends stepping away.",
            "factors": [
                f"portfolio realized today {net:.0f}",
                f"combined 75% threshold = {total_threshold:.0f}",
            ],
        }
    return None


def _check_portfolio_loss_streak(conn, *, user_id, account_id) -> dict | None:
    """4+ consecutive losses today across ALL accounts (global exit_date order,
    no winner since the streak started anywhere)."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return None
    ph = ",".join("?" * len(ids))
    today_iso = et_today()
    rows = _rows_on_et_day(conn.execute(
        f"""SELECT result, exit_date, trading_day_et FROM j2_trades
            WHERE user_id = ? AND account_id IN ({ph}) AND exit_date >= ?
            ORDER BY exit_date DESC""",
        [user_id, *ids, _utc_lower_bound(today_iso)],
    ).fetchall(), today_iso)
    streak = 0
    for r in rows:
        if r["result"] == "Loss":
            streak += 1
        else:
            break
    if streak >= 4:
        return {
            "severity": "danger",
            "message": f"{streak} consecutive losses across your accounts today. Compass strongly suggests stepping away before the next trade — anywhere.",
            "factors": [f"{streak} consecutive losses across all accounts today"],
        }
    return None


UNIFIED_RULE_CHECKS = {
    "portfolio_rapid_fire": _check_portfolio_rapid_fire,
    "portfolio_daily_loss": _check_portfolio_daily_loss,
    "portfolio_loss_streak": _check_portfolio_loss_streak,
}


def evaluate_interventions(
    *, user_id: str, account_id: str, conn=None,
) -> list[dict]:
    """Run all rule checks. Return active firings (existing within-cooldown
    or newly fired). Cooling-off bypasses cooldown semantics and fires
    every time the underlying condition is true."""
    _conn, _close = _get_conn(conn)
    try:
        active: list[dict] = []
        rule_checks = UNIFIED_RULE_CHECKS if is_unified(account_id) else RULE_CHECKS
        for rule, check_fn in rule_checks.items():
            # Cooling-off is special — always re-evaluate fresh, no cooldown
            if rule == "cooling_off_active":
                detected = check_fn(_conn, user_id=user_id, account_id=account_id)
                if detected:
                    # Find existing un-dismissed firing or insert new
                    existing = _conn.execute(
                        """SELECT id, severity, message, factors, fired_at, cooldown_until
                           FROM j2_interventions
                           WHERE user_id = ? AND account_id = ? AND rule = ?
                             AND dismissed_at IS NULL
                           ORDER BY fired_at DESC LIMIT 1""",
                        (user_id, account_id, rule),
                    ).fetchone()
                    if existing:
                        try:
                            factors = json.loads(existing["factors"] or "[]")
                        except (TypeError, json.JSONDecodeError):
                            factors = []
                        active.append({
                            "id": existing["id"], "rule": rule,
                            "severity": existing["severity"],
                            "message": existing["message"],
                            "factors": factors,
                            "fired_at": existing["fired_at"],
                            "cooldown_until": existing["cooldown_until"],
                        })
                    else:
                        rec = _record_firing(
                            _conn, user_id=user_id, account_id=account_id, rule=rule,
                            **detected,
                        )
                        active.append(rec)
                continue

            # Standard rules — respect cooldown
            existing = _active_firing(_conn, user_id=user_id, account_id=account_id, rule=rule)
            if existing:
                active.append(existing)
                continue

            detected = check_fn(_conn, user_id=user_id, account_id=account_id)
            if detected:
                rec = _record_firing(
                    _conn, user_id=user_id, account_id=account_id, rule=rule,
                    **detected,
                )
                active.append(rec)
        return active
    finally:
        if _close:
            _conn.close()


def dismiss_intervention(*, intervention_id: str, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        cur = _conn.execute(
            "UPDATE j2_interventions SET dismissed_at = ? WHERE id = ? AND user_id = ?",
            (now_iso, intervention_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def list_active(*, user_id: str, account_id: str, conn=None) -> list[dict]:
    """Read-only: list currently active interventions WITHOUT evaluating new rules."""
    _conn, _close = _get_conn(conn)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        rows = _conn.execute(
            """SELECT id, rule, severity, message, factors, fired_at, cooldown_until
               FROM j2_interventions
               WHERE user_id = ? AND account_id = ?
                 AND dismissed_at IS NULL
                 AND cooldown_until > ?
               ORDER BY fired_at DESC""",
            (user_id, account_id, now_iso),
        ).fetchall()
        out = []
        for r in rows:
            try:
                factors = json.loads(r["factors"] or "[]")
            except (TypeError, json.JSONDecodeError):
                factors = []
            out.append({
                "id": r["id"], "rule": r["rule"],
                "severity": r["severity"], "message": r["message"],
                "factors": factors, "fired_at": r["fired_at"],
                "cooldown_until": r["cooldown_until"],
            })
        return out
    finally:
        if _close:
            _conn.close()
