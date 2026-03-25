"""Community analytics — anonymous aggregate stats from all user journals."""

from fastapi import APIRouter, Depends
from api.middleware.auth_middleware import get_current_user
from api.services.auth_db import get_connection

router = APIRouter()

# Minimum number of unique traders before showing community stats
_MIN_TRADERS = 2


@router.get("/api/community/stats")
def community_stats(user: dict = Depends(get_current_user)):
    conn = get_connection()
    try:
        _empty = {
            "total_closed_trades": 0,
            "unique_traders": 0,
            "community_win_rate": 0,
            "avg_win_pct": 0,
            "avg_loss_pct": 0,
            "profit_factor": 0,
            "popular_setups": [],
            "best_setups": [],
            "direction_split": {"long": 0, "short": 0},
            "recent_activity": 0,
        }

        total = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE status = 'closed' AND pnl_pct IS NOT NULL"
        ).fetchone()["c"]
        if total == 0:
            return _empty

        unique_traders = conn.execute(
            "SELECT COUNT(DISTINCT user_id) as c FROM journal_entries WHERE status = 'closed' AND pnl_pct IS NOT NULL"
        ).fetchone()["c"]

        # Suppress stats until enough traders contribute (privacy)
        if unique_traders < _MIN_TRADERS:
            return {**_empty, "total_closed_trades": total, "unique_traders": unique_traders}

        wins = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE status = 'closed' AND pnl_pct > 0"
        ).fetchone()["c"]

        avg_win_row = conn.execute(
            "SELECT AVG(pnl_pct) as v FROM journal_entries WHERE status = 'closed' AND pnl_pct > 0"
        ).fetchone()
        avg_win = (avg_win_row["v"] or 0) if avg_win_row else 0

        avg_loss_row = conn.execute(
            "SELECT AVG(ABS(pnl_pct)) as v FROM journal_entries WHERE status = 'closed' AND pnl_pct <= 0 AND pnl_pct IS NOT NULL"
        ).fetchone()
        avg_loss = (avg_loss_row["v"] or 0) if avg_loss_row else 0

        total_win_sum = conn.execute(
            "SELECT SUM(pnl_pct) as v FROM journal_entries WHERE status = 'closed' AND pnl_pct > 0"
        ).fetchone()["v"] or 0
        total_loss_sum = conn.execute(
            "SELECT SUM(ABS(pnl_pct)) as v FROM journal_entries WHERE status = 'closed' AND pnl_pct <= 0 AND pnl_pct IS NOT NULL"
        ).fetchone()["v"] or 0
        pf = round(total_win_sum / total_loss_sum, 2) if total_loss_sum > 0 else 0

        # Popular setups (most used)
        popular_rows = conn.execute(
            "SELECT setup, COUNT(*) as cnt FROM journal_entries WHERE status = 'closed' AND setup != '' "
            "GROUP BY setup ORDER BY cnt DESC LIMIT 8"
        ).fetchall()
        popular_setups = [{"setup": r["setup"], "count": r["cnt"]} for r in popular_rows]

        # Best setups by win rate (min 3 trades across all users)
        setup_rows = conn.execute(
            "SELECT setup, COUNT(*) as total, "
            "SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins, "
            "AVG(pnl_pct) as avg_pnl "
            "FROM journal_entries WHERE status = 'closed' AND setup != '' AND pnl_pct IS NOT NULL "
            "GROUP BY setup HAVING total >= 3 ORDER BY (wins * 1.0 / total) DESC LIMIT 5"
        ).fetchall()
        best_setups = [{
            "setup": r["setup"],
            "total": r["total"],
            "win_rate": round(r["wins"] / r["total"] * 100, 1),
            "avg_pnl": round(r["avg_pnl"] or 0, 2),
        } for r in setup_rows]

        # Direction split — query both explicitly
        long_count = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE status = 'closed' AND direction = 'long'"
        ).fetchone()["c"]
        short_count = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE status = 'closed' AND direction = 'short'"
        ).fetchone()["c"]

        # Recent activity (trades closed in last 7 days)
        recent = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE status = 'closed' "
            "AND exit_date >= date('now', '-7 days')"
        ).fetchone()["c"]

        return {
            "total_closed_trades": total,
            "unique_traders": unique_traders,
            "community_win_rate": round(wins / total * 100, 1) if total > 0 else 0,
            "avg_win_pct": round(avg_win, 2),
            "avg_loss_pct": round(avg_loss, 2),
            "profit_factor": pf,
            "popular_setups": popular_setups,
            "best_setups": best_setups,
            "direction_split": {"long": long_count, "short": short_count},
            "recent_activity": recent,
        }
    finally:
        conn.close()
