"""
Compass Overview — aggregates state from across all coaching surfaces
for a single horizontal command-center card.
"""
from __future__ import annotations
import json
import os
from datetime import datetime, timezone, timedelta, time
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import coach_data_assembler


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def _eod_recap_eta() -> str | None:
    """Next EOD recap scheduled time (4:30 PM ET Mon-Fri). Returns ISO or None on weekends."""
    try:
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
        now_et = datetime.now(et)
        weekday = now_et.weekday()  # 0=Mon..6=Sun
        if weekday >= 5:  # Sat/Sun — next Monday
            days_until_mon = 7 - weekday
            target = (now_et + timedelta(days=days_until_mon)).replace(
                hour=16, minute=30, second=0, microsecond=0,
            )
        else:
            target = now_et.replace(hour=16, minute=30, second=0, microsecond=0)
            if target <= now_et:
                # Past 4:30 PM ET today — next is tomorrow if weekday, else Monday
                next_day = now_et + timedelta(days=1)
                while next_day.weekday() >= 5:
                    next_day += timedelta(days=1)
                target = next_day.replace(hour=16, minute=30, second=0, microsecond=0)
        return target.astimezone(timezone.utc).isoformat()
    except Exception:
        return None


def get_overview(*, user_id: str, account_id: str, conn=None) -> dict:
    """Aggregate everything Compass knows about the trader's CURRENT state."""
    _conn, _close = _get_conn(conn)
    try:
        # Trader profile excerpt
        acc_row = _conn.execute(
            "SELECT trader_profile, onboarded FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        profile = (acc_row["trader_profile"] if acc_row else "") or ""
        profile_excerpt = profile[:250] + ("…" if len(profile) > 250 else "")
        onboarded = bool(acc_row and int(acc_row["onboarded"] or 0))

        # This week's focus (from latest weekly_review's metadata)
        this_weeks_focus = None
        wr_row = _conn.execute(
            """SELECT metadata FROM j2_coach_outputs
               WHERE user_id = ? AND account_id = ? AND output_type='weekly_review' AND forgotten=0
               ORDER BY created_at DESC LIMIT 1""",
            (user_id, account_id),
        ).fetchone()
        if wr_row:
            try:
                meta = json.loads(wr_row["metadata"] or "{}")
                this_weeks_focus = meta.get("this_weeks_focus")
            except (TypeError, json.JSONDecodeError):
                pass

        # Week-to-date aggregates (Mon → now, ET)
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
        now_et = datetime.now(et)
        wtd_start_et = now_et - timedelta(days=now_et.weekday())
        wtd_start_et = wtd_start_et.replace(hour=0, minute=0, second=0, microsecond=0)
        wtd_start = wtd_start_et.astimezone(timezone.utc)
        wtd_end = datetime.now(timezone.utc)
        wtd_trades = coach_data_assembler._trades_in_range(
            _conn, user_id, account_id, wtd_start, wtd_end,
        )
        wtd_agg = coach_data_assembler._aggregate_trades(wtd_trades)

        # Today (ET calendar day)
        today_start_et = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
        today_start = today_start_et.astimezone(timezone.utc)
        today_trades = coach_data_assembler._trades_in_range(
            _conn, user_id, account_id, today_start, wtd_end,
        )
        today_agg = coach_data_assembler._aggregate_trades(today_trades)
        today_iso = now_et.date().isoformat()
        eod_row = _conn.execute(
            """SELECT id FROM j2_coach_outputs
               WHERE user_id = ? AND account_id = ? AND output_type='eod_recap' AND forgotten=0
                 AND json_extract(metadata, '$.day') = ?
               ORDER BY created_at DESC LIMIT 1""",
            (user_id, account_id, today_iso),
        ).fetchone()
        has_eod_recap_today = bool(eod_row)

        # Regime
        regime_label = None
        try:
            from api.services.journal_two import regime as regime_service
            info = regime_service.get_current_regime() or {}
            regime_label = info.get("regime")
        except Exception:
            pass

        # Active interventions count
        active_interventions_count = 0
        try:
            from api.services.journal_two import interventions as iv
            active_interventions_count = len(iv.list_active(
                user_id=user_id, account_id=account_id, conn=_conn,
            ))
        except Exception:
            pass

        # Recent 3 trade reviews
        recent_reviews_rows = _conn.execute(
            """SELECT tr.id, tr.body, tr.summary, tr.created_at, tr.trade_id,
                      t.symbol, t.r_multiple, t.result
               FROM j2_trade_reviews tr
               LEFT JOIN j2_trades t ON t.id = tr.trade_id
               WHERE tr.user_id = ? AND tr.account_id = ? AND tr.forgotten = 0
               ORDER BY tr.created_at DESC LIMIT 3""",
            (user_id, account_id),
        ).fetchall()
        recent_reviews = []
        for r in recent_reviews_rows:
            recent_reviews.append({
                "id": r["id"], "trade_id": r["trade_id"],
                "symbol": r["symbol"], "r_multiple": r["r_multiple"],
                "result": r["result"], "summary": (r["summary"] or r["body"] or "")[:160],
                "created_at": r["created_at"],
            })

        # Pending profile suggestions count
        pending_suggestions_count = 0
        try:
            from api.services.journal_two import profile_suggestions as ps
            pending_suggestions_count = len(ps.list_pending(
                user_id=user_id, account_id=account_id, conn=_conn,
            )["suggestions"])
        except Exception:
            pass

        # Celebration moments (P6-7) — positive CoachStrip rows, once-per via
        # calendar_seen. Cheap: reuses the shared connection; each achievement
        # fires at most once ever. Defensive — never breaks the overview payload.
        celebrations: list[dict] = []
        try:
            from api.services.journal_two import celebrations as celebrations_service
            from api.services.journal_two import nudges as nudges_service
            from api.services.journal_two import discipline as discipline_service
            goal = accounts_service.goal_progress(user_id, account_id, conn=_conn)
            nudges_state = nudges_service.get_nudges_state(
                user_id, account_id, conn=_conn,
            )
            discipline_state = discipline_service.compute_discipline_state(
                user_id, account_id, conn=_conn,
            )
            celebrations = celebrations_service.detect(
                user_id, account_id,
                goal=goal,
                nudges=nudges_state,
                discipline=discipline_state,
                today_date=today_iso,
                traded_today=(today_agg.get("trade_count", 0) or 0) > 0,
                day_complete=has_eod_recap_today,
            )
        except Exception:
            celebrations = []

        return {
            "profile_excerpt": profile_excerpt,
            "onboarded": onboarded,
            "this_weeks_focus": this_weeks_focus,
            "week_to_date": {
                "trade_count": wtd_agg.get("trade_count", 0),
                "wins": wtd_agg.get("wins", 0),
                "losses": wtd_agg.get("losses", 0),
                "net_pnl_dollar": wtd_agg.get("net_pnl_dollar"),
                "net_pnl_pct": wtd_agg.get("net_pnl_pct"),
                "avg_r": wtd_agg.get("avg_r"),
                "range": f"{wtd_start_et.date().isoformat()} to {today_iso}",
            },
            "today": {
                "date": today_iso,
                "trade_count": today_agg.get("trade_count", 0),
                "net_pnl_dollar": today_agg.get("net_pnl_dollar"),
                "has_eod_recap": has_eod_recap_today,
                "eod_recap_eta_utc": _eod_recap_eta(),
            },
            "regime": regime_label,
            "active_interventions_count": active_interventions_count,
            "pending_profile_suggestions_count": pending_suggestions_count,
            "recent_trade_reviews": recent_reviews,
            "celebrations": celebrations,
        }
    finally:
        if _close:
            _conn.close()
