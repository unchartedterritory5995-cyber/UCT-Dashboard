"""
Journal service — per-user trade journal CRUD with filtering, stats, and review tracking.
All data in auth.db, completely isolated from existing DBs.
"""

import os
import uuid
from datetime import date as _date
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.journal_taxonomy import (
    VALID_DIRECTIONS, VALID_STATUSES, VALID_ASSET_CLASSES, VALID_SESSIONS,
    REVIEW_STATUSES, compute_review_status,
)

# All columns on journal_entries (for SELECT *)
_ALL_COLS = [
    "id", "user_id", "sym", "direction", "setup", "entry_price", "exit_price",
    "stop_price", "target_price", "size_pct", "status", "entry_date", "exit_date",
    "pnl_pct", "pnl_dollar", "notes", "rating", "created_at", "updated_at",
    # v2 columns
    "account", "asset_class", "strategy", "playbook_id", "tags", "mistake_tags",
    "emotion_tags", "entry_time", "exit_time", "fees", "shares", "risk_dollars",
    "planned_r", "realized_r", "thesis", "market_context", "confidence",
    "process_score", "outcome_score", "ps_setup", "ps_entry", "ps_exit",
    "ps_sizing", "ps_stop", "lesson", "follow_up", "review_status", "review_date",
    "session", "day_of_week", "holding_minutes", "ai_summary",
]

_WRITABLE_FIELDS = {
    "sym", "direction", "setup", "entry_price", "exit_price", "stop_price",
    "target_price", "size_pct", "status", "entry_date", "exit_date", "notes",
    "rating", "account", "asset_class", "strategy", "playbook_id", "tags",
    "mistake_tags", "emotion_tags", "entry_time", "exit_time", "fees", "shares",
    "risk_dollars", "planned_r", "thesis", "market_context", "confidence",
    "process_score", "outcome_score", "ps_setup", "ps_entry", "ps_exit",
    "ps_sizing", "ps_stop", "lesson", "follow_up", "review_status", "review_date",
    "session",
}

_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _safe_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _safe_int(val):
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _compute_derived(data: dict, existing: dict = None) -> dict:
    """Compute P&L, R-multiple, day_of_week, holding_minutes from fields."""
    merged = {**(existing or {}), **data}

    entry_price = _safe_float(merged.get("entry_price"))
    exit_price = _safe_float(merged.get("exit_price"))
    stop_price = _safe_float(merged.get("stop_price"))
    direction = (merged.get("direction") or "long").lower()

    # P&L
    if entry_price and entry_price > 0 and exit_price:
        if direction == "short":
            pnl_pct = ((entry_price - exit_price) / entry_price) * 100
        else:
            pnl_pct = ((exit_price - entry_price) / entry_price) * 100
        data["pnl_pct"] = round(pnl_pct, 2)

        shares = _safe_float(merged.get("shares"))
        if shares:
            if direction == "short":
                data["pnl_dollar"] = round((entry_price - exit_price) * abs(shares), 2)
            else:
                data["pnl_dollar"] = round((exit_price - entry_price) * abs(shares), 2)

    # R-multiple
    if entry_price and stop_price and exit_price and entry_price != stop_price:
        risk_per_share = abs(entry_price - stop_price)
        if direction == "short":
            reward = entry_price - exit_price
        else:
            reward = exit_price - entry_price
        data["realized_r"] = round(reward / risk_per_share, 2)

    # Planned R
    target_price = _safe_float(merged.get("target_price"))
    if entry_price and stop_price and target_price and entry_price != stop_price:
        risk = abs(entry_price - stop_price)
        if direction == "short":
            reward = entry_price - target_price
        else:
            reward = target_price - entry_price
        data["planned_r"] = round(reward / risk, 2)

    # Day of week
    entry_date = merged.get("entry_date")
    if entry_date and len(entry_date) >= 10:
        try:
            dt = datetime.strptime(entry_date[:10], "%Y-%m-%d")
            data["day_of_week"] = _DAY_NAMES[dt.weekday()]
        except ValueError:
            pass

    # Holding minutes (from entry_date+time to exit_date+time)
    ed = merged.get("entry_date", "")
    et = merged.get("entry_time", "")
    xd = merged.get("exit_date", "")
    xt = merged.get("exit_time", "")
    if ed and xd and len(ed) >= 10 and len(xd) >= 10:
        try:
            entry_dt = datetime.strptime(f"{ed[:10]} {et or '09:30'}", "%Y-%m-%d %H:%M")
            exit_dt = datetime.strptime(f"{xd[:10]} {xt or '16:00'}", "%Y-%m-%d %H:%M")
            data["holding_minutes"] = max(0, int((exit_dt - entry_dt).total_seconds() / 60))
        except ValueError:
            pass

    # Process score composite
    ps_fields = [merged.get(f"ps_{d}") for d in ("setup", "entry", "exit", "sizing", "stop")]
    ps_values = [_safe_int(v) for v in ps_fields if v is not None]
    if ps_values:
        data["process_score"] = sum(ps_values)

    # Auto-compute review status (unless manually flagged — check merged state)
    if merged.get("review_status") != "flagged":
        data["review_status"] = compute_review_status(merged)

    return data


def create_entry(user_id: str, data: dict) -> dict:
    entry_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    direction = (data.get("direction") or "long").lower()
    if direction not in VALID_DIRECTIONS:
        direction = "long"
    status = (data.get("status") or "open").lower()
    if status not in VALID_STATUSES:
        status = "open"
    sym = (data.get("sym") or "").upper().strip()
    asset_class = (data.get("asset_class") or "equity").lower()
    if asset_class not in VALID_ASSET_CLASSES:
        asset_class = "equity"

    # Sanitize prices — abs() to prevent negative values
    _entry_p = _safe_float(data.get("entry_price"))
    _exit_p = _safe_float(data.get("exit_price"))
    _stop_p = _safe_float(data.get("stop_price"))
    _target_p = _safe_float(data.get("target_price"))

    clean = {
        "sym": sym, "direction": direction, "status": status,
        "setup": (data.get("setup") or "")[:100],
        "entry_price": abs(_entry_p) if _entry_p is not None else None,
        "exit_price": abs(_exit_p) if _exit_p is not None else None,
        "stop_price": abs(_stop_p) if _stop_p is not None else None,
        "target_price": abs(_target_p) if _target_p is not None else None,
        "size_pct": _safe_float(data.get("size_pct")),
        "entry_date": (data.get("entry_date") or "")[:10],
        "exit_date": data.get("exit_date") or None,
        "notes": (data.get("notes") or "")[:5000],
        "rating": min(max(_safe_int(data.get("rating")) or 0, 0), 5),
        "account": (data.get("account") or "default")[:50],
        "asset_class": asset_class,
        "strategy": (data.get("strategy") or "")[:100],
        "playbook_id": data.get("playbook_id"),
        "tags": (data.get("tags") or "")[:500],
        "mistake_tags": data.get("mistake_tags"),
        "emotion_tags": data.get("emotion_tags"),
        "entry_time": (data.get("entry_time") or "")[:5] or None,
        "exit_time": (data.get("exit_time") or "")[:5] or None,
        "fees": _safe_float(data.get("fees")) or 0,
        "shares": _safe_float(data.get("shares")),
        "risk_dollars": _safe_float(data.get("risk_dollars")),
        "thesis": (data.get("thesis") or "")[:5000],
        "market_context": (data.get("market_context") or "")[:2000],
        "confidence": min(max(_safe_int(data.get("confidence")) or 0, 0), 5) or None,
        "ps_setup": _safe_int(data.get("ps_setup")),
        "ps_entry": _safe_int(data.get("ps_entry")),
        "ps_exit": _safe_int(data.get("ps_exit")),
        "ps_sizing": _safe_int(data.get("ps_sizing")),
        "ps_stop": _safe_int(data.get("ps_stop")),
        "outcome_score": _safe_int(data.get("outcome_score")),
        "lesson": (data.get("lesson") or "")[:5000],
        "follow_up": (data.get("follow_up") or "")[:2000],
        "session": (data.get("session") or "")[:20],
    }

    # Compute derived fields
    clean = _compute_derived(clean)

    cols = list(clean.keys()) + ["id", "user_id", "created_at", "updated_at"]
    vals = list(clean.values()) + [entry_id, user_id, now, now]
    placeholders = ",".join(["?"] * len(cols))
    col_names = ",".join(cols)

    conn = get_connection()
    try:
        conn.execute(f"INSERT INTO journal_entries ({col_names}) VALUES ({placeholders})", vals)
        conn.commit()
        # Recompute playbook stats if linked
        if clean.get("playbook_id"):
            try:
                from api.services.playbook_service import recompute_playbook_stats
                recompute_playbook_stats(user_id, clean["playbook_id"])
            except Exception:
                pass
        return get_entry(user_id, entry_id)
    finally:
        conn.close()


def get_entry(user_id: str, entry_id: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM journal_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_entries(user_id: str, filters: dict = None, limit: int = 50, offset: int = 0) -> dict:
    """List trades with filtering. Returns {trades: [...], total: int}."""
    filters = filters or {}
    limit = min(limit, 500)

    where = ["user_id = ?"]
    params = [user_id]

    # Status filters
    if filters.get("status") and filters["status"] in VALID_STATUSES:
        where.append("status = ?")
        params.append(filters["status"])
    if filters.get("review_status") and filters["review_status"] in REVIEW_STATUSES:
        where.append("review_status = ?")
        params.append(filters["review_status"])

    # Text filters
    for field in ("symbol", "sym"):
        if filters.get(field):
            where.append("sym = ?")
            params.append(filters[field].upper())
            break
    if filters.get("setup"):
        where.append("setup = ?")
        params.append(filters["setup"])
    if filters.get("direction") and filters["direction"] in VALID_DIRECTIONS:
        where.append("direction = ?")
        params.append(filters["direction"])
    if filters.get("asset_class") and filters["asset_class"] in VALID_ASSET_CLASSES:
        where.append("asset_class = ?")
        params.append(filters["asset_class"])
    if filters.get("playbook_id"):
        where.append("playbook_id = ?")
        params.append(filters["playbook_id"])
    if filters.get("session"):
        where.append("session = ?")
        params.append(filters["session"])
    if filters.get("day_of_week"):
        where.append("day_of_week = ?")
        params.append(filters["day_of_week"])
    if filters.get("account"):
        where.append("account = ?")
        params.append(filters["account"])

    # Date range
    if filters.get("date_from"):
        where.append("entry_date >= ?")
        params.append(filters["date_from"])
    if filters.get("date_to"):
        where.append("entry_date <= ?")
        params.append(filters["date_to"])

    # Tag filters (LIKE for comma-separated)
    if filters.get("tag"):
        where.append("tags LIKE ?")
        params.append(f"%{filters['tag']}%")
    if filters.get("mistake_tag"):
        where.append("mistake_tags LIKE ?")
        params.append(f"%{filters['mistake_tag']}%")

    # Boolean filters
    if filters.get("has_screenshots") == "true":
        where.append("id IN (SELECT trade_id FROM journal_screenshots)")
    elif filters.get("has_screenshots") == "false":
        where.append("id NOT IN (SELECT DISTINCT trade_id FROM journal_screenshots)")
    if filters.get("has_notes") == "true":
        where.append("(notes != '' AND notes IS NOT NULL)")
    elif filters.get("has_notes") == "false":
        where.append("(notes IS NULL OR notes = '')")
    if filters.get("has_process_score") == "true":
        where.append("process_score IS NOT NULL")
    elif filters.get("has_process_score") == "false":
        where.append("process_score IS NULL")

    # Numeric range filters
    if filters.get("min_r") is not None:
        where.append("realized_r >= ?")
        params.append(float(filters["min_r"]))
    if filters.get("max_r") is not None:
        where.append("realized_r <= ?")
        params.append(float(filters["max_r"]))
    if filters.get("min_pnl") is not None:
        where.append("pnl_pct >= ?")
        params.append(float(filters["min_pnl"]))
    if filters.get("max_pnl") is not None:
        where.append("pnl_pct <= ?")
        params.append(float(filters["max_pnl"]))

    where_clause = " AND ".join(where)

    # Sort
    sort_by = filters.get("sort_by", "entry_date")
    if sort_by not in _ALL_COLS:
        sort_by = "entry_date"
    sort_dir = "ASC" if filters.get("sort_dir", "desc").lower() == "asc" else "DESC"

    conn = get_connection()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) as c FROM journal_entries WHERE {where_clause}", params
        ).fetchone()["c"]

        rows = conn.execute(
            f"SELECT * FROM journal_entries WHERE {where_clause} ORDER BY {sort_by} {sort_dir} LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

        return {"trades": [dict(r) for r in rows], "total": total}
    finally:
        conn.close()


def update_entry(user_id: str, entry_id: str, data: dict) -> dict | None:
    existing = get_entry(user_id, entry_id)
    if not existing:
        return None

    updates = {k: v for k, v in data.items() if k in _WRITABLE_FIELDS}
    if not updates:
        return existing

    # Normalize
    if "direction" in updates:
        updates["direction"] = (updates["direction"] or "long").lower()
        if updates["direction"] not in VALID_DIRECTIONS:
            updates["direction"] = "long"
    if "status" in updates:
        updates["status"] = (updates["status"] or "open").lower()
        if updates["status"] not in VALID_STATUSES:
            updates["status"] = "open"
    if "sym" in updates:
        updates["sym"] = (updates["sym"] or "").upper().strip()
    if "notes" in updates:
        updates["notes"] = (updates["notes"] or "")[:5000]
    if "setup" in updates:
        updates["setup"] = (updates["setup"] or "")[:100]
    if "thesis" in updates:
        updates["thesis"] = (updates["thesis"] or "")[:5000]
    if "lesson" in updates:
        updates["lesson"] = (updates["lesson"] or "")[:5000]
    if "rating" in updates:
        updates["rating"] = min(max(_safe_int(updates["rating"]) or 0, 0), 5)

    # Compute derived fields
    updates = _compute_derived(updates, existing)
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [entry_id, user_id]

    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE journal_entries SET {set_clause} WHERE id = ? AND user_id = ?",
            values,
        )
        conn.commit()
        # Recompute playbook stats if playbook changed
        try:
            from api.services.playbook_service import recompute_playbook_stats
            new_pb = updates.get("playbook_id")
            old_pb = existing.get("playbook_id")
            if new_pb:
                recompute_playbook_stats(user_id, new_pb)
            if old_pb and old_pb != new_pb:
                recompute_playbook_stats(user_id, old_pb)
        except Exception:
            pass
        return get_entry(user_id, entry_id)
    finally:
        conn.close()


def delete_entry(user_id: str, entry_id: str) -> bool:
    conn = get_connection()
    try:
        # Clean up screenshot files from disk before deleting the trade
        sc_rows = conn.execute(
            "SELECT filename FROM journal_screenshots WHERE trade_id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchall()
        screenshot_dir = os.environ.get("SCREENSHOT_DIR", "/data/journal_screenshots")
        if not os.path.exists(os.path.dirname(screenshot_dir)):
            screenshot_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "journal_screenshots")
        for sc in sc_rows:
            filepath = os.path.join(screenshot_dir, sc["filename"])
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except OSError:
                    pass
        # Delete screenshot DB records
        conn.execute(
            "DELETE FROM journal_screenshots WHERE trade_id = ? AND user_id = ?",
            (entry_id, user_id),
        )
        # Delete execution records
        conn.execute(
            "DELETE FROM trade_executions WHERE trade_id = ? AND user_id = ?",
            (entry_id, user_id),
        )
        result = conn.execute(
            "DELETE FROM journal_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def get_stats(user_id: str, date_from: str = None, date_to: str = None) -> dict:
    """Aggregate stats for a user's journal."""
    conn = get_connection()
    try:
        where = "user_id = ? AND status = 'closed'"
        params = [user_id]
        if date_from:
            where += " AND entry_date >= ?"
            params.append(date_from)
        if date_to:
            where += " AND entry_date <= ?"
            params.append(date_to)

        rows = conn.execute(f"SELECT * FROM journal_entries WHERE {where}", params).fetchall()
        entries = [dict(r) for r in rows]

        open_count = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE user_id = ? AND status = 'open'",
            (user_id,),
        ).fetchone()["c"]

        today = _date.today().isoformat()
        today_count = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE user_id = ? AND entry_date = ?",
            (user_id, today),
        ).fetchone()["c"]

        if not entries:
            return {
                "total_trades": 0, "open_trades": open_count, "today_trade_count": today_count, "wins": 0, "losses": 0,
                "win_rate": 0, "avg_win_pct": 0, "avg_loss_pct": 0,
                "profit_factor": 0, "total_pnl_pct": 0, "avg_r": 0,
                "expectancy": 0, "avg_process_score": 0,
                "best_trade": None, "worst_trade": None, "top_setups": [],
                "review_counts": _get_review_counts(conn, user_id),
            }

        with_pnl = [e for e in entries if e["pnl_pct"] is not None]
        wins = [e for e in with_pnl if e["pnl_pct"] > 0]
        losses = [e for e in with_pnl if e["pnl_pct"] <= 0]

        avg_win = sum(e["pnl_pct"] for e in wins) / len(wins) if wins else 0
        avg_loss = sum(abs(e["pnl_pct"]) for e in losses) / len(losses) if losses else 0
        total_win = sum(e["pnl_pct"] for e in wins)
        total_loss = sum(abs(e["pnl_pct"]) for e in losses)
        pf = total_win / total_loss if total_loss > 0 else 0

        # Expectancy
        wr = len(wins) / len(with_pnl) if with_pnl else 0
        expectancy = (wr * avg_win) - ((1 - wr) * avg_loss) if with_pnl else 0

        # Avg R
        with_r = [e for e in with_pnl if e.get("realized_r") is not None]
        avg_r = sum(e["realized_r"] for e in with_r) / len(with_r) if with_r else 0

        # Avg process score
        with_ps = [e for e in entries if e.get("process_score") is not None]
        avg_ps = sum(e["process_score"] for e in with_ps) / len(with_ps) if with_ps else 0

        sorted_by_pnl = sorted(with_pnl, key=lambda e: e["pnl_pct"])
        best = sorted_by_pnl[-1] if sorted_by_pnl else None
        worst = sorted_by_pnl[0] if sorted_by_pnl else None

        # Top setups
        setup_map = {}
        for e in with_pnl:
            s = e["setup"] or "Unknown"
            if s not in setup_map:
                setup_map[s] = {"setup": s, "wins": 0, "total": 0, "pnl_sum": 0, "r_sum": 0, "r_count": 0}
            setup_map[s]["total"] += 1
            setup_map[s]["pnl_sum"] += e["pnl_pct"]
            if e["pnl_pct"] > 0:
                setup_map[s]["wins"] += 1
            if e.get("realized_r") is not None:
                setup_map[s]["r_sum"] += e["realized_r"]
                setup_map[s]["r_count"] += 1

        top_setups = sorted(
            [v for v in setup_map.values() if v["total"] >= 2],
            key=lambda x: x["wins"] / x["total"],
            reverse=True,
        )[:5]
        for s in top_setups:
            s["win_rate"] = round(s["wins"] / s["total"] * 100, 1)
            s["avg_pnl"] = round(s["pnl_sum"] / s["total"], 2)
            s["avg_r"] = round(s["r_sum"] / s["r_count"], 2) if s["r_count"] else None

        return {
            "total_trades": len(entries),
            "open_trades": open_count,
            "today_trade_count": today_count,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(wr * 100, 1) if with_pnl else 0,
            "avg_win_pct": round(avg_win, 2),
            "avg_loss_pct": round(avg_loss, 2),
            "profit_factor": round(pf, 2),
            "total_pnl_pct": round(sum(e["pnl_pct"] for e in with_pnl), 2),
            "avg_r": round(avg_r, 2),
            "expectancy": round(expectancy, 2),
            "avg_process_score": round(avg_ps, 1),
            "best_trade": {"sym": best["sym"], "pnl_pct": best["pnl_pct"], "id": best["id"]} if best else None,
            "worst_trade": {"sym": worst["sym"], "pnl_pct": worst["pnl_pct"], "id": worst["id"]} if worst else None,
            "top_setups": top_setups,
            "review_counts": _get_review_counts(conn, user_id),
        }
    finally:
        conn.close()


def _get_review_counts(conn, user_id: str) -> dict:
    """Count trades by review status."""
    rows = conn.execute(
        "SELECT review_status, COUNT(*) as c FROM journal_entries WHERE user_id = ? GROUP BY review_status",
        (user_id,),
    ).fetchall()
    counts = {r["review_status"]: r["c"] for r in rows}
    # Also count special cases
    missing_screenshots = conn.execute(
        """SELECT COUNT(*) as c FROM journal_entries
           WHERE user_id = ? AND status = 'closed'
           AND id NOT IN (SELECT trade_id FROM journal_screenshots)""",
        (user_id,),
    ).fetchone()["c"]
    missing_notes = conn.execute(
        "SELECT COUNT(*) as c FROM journal_entries WHERE user_id = ? AND status = 'closed' AND (notes IS NULL OR notes = '')",
        (user_id,),
    ).fetchone()["c"]
    counts["missing_screenshots"] = missing_screenshots
    counts["missing_notes"] = missing_notes
    return counts


def get_review_queue(user_id: str, limit: int = 30) -> list[dict]:
    """Get trades needing review, ordered by priority."""
    conn = get_connection()
    try:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        items = []

        # 1. Today's unreviewed
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status, status,
                      CASE WHEN process_score IS NOT NULL THEN 1 ELSE 0 END as has_process_score,
                      CASE WHEN (notes IS NOT NULL AND notes != '') OR (lesson IS NOT NULL AND lesson != '') THEN 1 ELSE 0 END as has_notes,
                      CASE WHEN id IN (SELECT trade_id FROM journal_screenshots) THEN 1 ELSE 0 END as has_screenshots
               FROM journal_entries WHERE user_id = ? AND entry_date = ?
               AND review_status IN ('draft', 'logged')
               ORDER BY created_at DESC""",
            (user_id, today),
        ).fetchall()
        for r in rows:
            items.append({"type": "today_unreviewed", "priority": 1, **dict(r)})

        # 2. Follow-up needed
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status, follow_up,
                      CASE WHEN process_score IS NOT NULL THEN 1 ELSE 0 END as has_process_score,
                      CASE WHEN (notes IS NOT NULL AND notes != '') OR (lesson IS NOT NULL AND lesson != '') THEN 1 ELSE 0 END as has_notes,
                      CASE WHEN id IN (SELECT trade_id FROM journal_screenshots) THEN 1 ELSE 0 END as has_screenshots
               FROM journal_entries WHERE user_id = ? AND review_status = 'follow_up'
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "follow_up", "priority": 2, **dict(r)})

        # 3. Missing process scores (closed trades)
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status,
                      CASE WHEN process_score IS NOT NULL THEN 1 ELSE 0 END as has_process_score,
                      CASE WHEN (notes IS NOT NULL AND notes != '') OR (lesson IS NOT NULL AND lesson != '') THEN 1 ELSE 0 END as has_notes,
                      CASE WHEN id IN (SELECT trade_id FROM journal_screenshots) THEN 1 ELSE 0 END as has_screenshots
               FROM journal_entries WHERE user_id = ? AND status = 'closed'
               AND process_score IS NULL
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "missing_process", "priority": 3, **dict(r)})

        # 4. Flagged for deep review
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status,
                      CASE WHEN process_score IS NOT NULL THEN 1 ELSE 0 END as has_process_score,
                      CASE WHEN (notes IS NOT NULL AND notes != '') OR (lesson IS NOT NULL AND lesson != '') THEN 1 ELSE 0 END as has_notes,
                      CASE WHEN id IN (SELECT trade_id FROM journal_screenshots) THEN 1 ELSE 0 END as has_screenshots
               FROM journal_entries WHERE user_id = ? AND review_status = 'flagged'
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "flagged", "priority": 4, **dict(r)})

        # 5. Missing screenshots (closed)
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status,
                      CASE WHEN process_score IS NOT NULL THEN 1 ELSE 0 END as has_process_score,
                      CASE WHEN (notes IS NOT NULL AND notes != '') OR (lesson IS NOT NULL AND lesson != '') THEN 1 ELSE 0 END as has_notes,
                      CASE WHEN id IN (SELECT trade_id FROM journal_screenshots) THEN 1 ELSE 0 END as has_screenshots
               FROM journal_entries WHERE user_id = ? AND status = 'closed'
               AND id NOT IN (SELECT trade_id FROM journal_screenshots)
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "missing_screenshots", "priority": 5, **dict(r)})

        # 6. Missing notes (closed)
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status,
                      CASE WHEN process_score IS NOT NULL THEN 1 ELSE 0 END as has_process_score,
                      CASE WHEN (notes IS NOT NULL AND notes != '') OR (lesson IS NOT NULL AND lesson != '') THEN 1 ELSE 0 END as has_notes,
                      CASE WHEN id IN (SELECT trade_id FROM journal_screenshots) THEN 1 ELSE 0 END as has_screenshots
               FROM journal_entries WHERE user_id = ? AND status = 'closed'
               AND (notes IS NULL OR notes = '') AND (lesson IS NULL OR lesson = '')
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "missing_notes", "priority": 6, **dict(r)})

        # Sort by priority, dedup by trade id
        seen = set()
        result = []
        for item in sorted(items, key=lambda x: x["priority"]):
            if item["id"] not in seen and len(result) < limit:
                seen.add(item["id"])
                result.append(item)

        return result
    finally:
        conn.close()


def get_calendar(user_id: str, month: str) -> dict:
    """Get calendar data for a month (YYYY-MM format)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM journal_entries
               WHERE user_id = ? AND entry_date LIKE ?
               ORDER BY entry_date""",
            (user_id, f"{month}%"),
        ).fetchall()
        trades = [dict(r) for r in rows]

        # Daily journals for this month
        dj_rows = conn.execute(
            "SELECT date, review_complete FROM daily_journals WHERE user_id = ? AND date LIKE ?",
            (user_id, f"{month}%"),
        ).fetchall()
        dj_map = {r["date"]: bool(r["review_complete"]) for r in dj_rows}

        # Screenshots count per trade
        sc_rows = conn.execute(
            """SELECT trade_id, COUNT(*) as c FROM journal_screenshots
               WHERE user_id = ? AND trade_id IN (SELECT id FROM journal_entries WHERE entry_date LIKE ?)
               GROUP BY trade_id""",
            (user_id, f"{month}%"),
        ).fetchall()
        sc_map = {r["trade_id"]: r["c"] for r in sc_rows}

        # Group by date
        days = {}
        for t in trades:
            d = t["entry_date"][:10] if t.get("entry_date") else None
            if not d:
                continue
            if d not in days:
                days[d] = {
                    "trade_count": 0, "wins": 0, "losses": 0,
                    "net_pnl_pct": 0, "net_pnl_dollar": 0,
                    "avg_process_score": 0, "_ps_sum": 0, "_ps_count": 0,
                    "has_daily_journal": d in dj_map,
                    "daily_review_complete": dj_map.get(d, False),
                    "mistake_count": 0, "screenshot_count": 0,
                    "review_statuses": [],
                }
            day = days[d]
            day["trade_count"] += 1
            if t.get("pnl_pct") is not None:
                if t["pnl_pct"] > 0:
                    day["wins"] += 1
                else:
                    day["losses"] += 1
                day["net_pnl_pct"] += t["pnl_pct"]
                day["net_pnl_dollar"] += (t.get("pnl_dollar") or 0)
            if t.get("process_score") is not None:
                day["_ps_sum"] += t["process_score"]
                day["_ps_count"] += 1
            if t.get("mistake_tags"):
                day["mistake_count"] += len(t["mistake_tags"].split(","))
            day["screenshot_count"] += sc_map.get(t["id"], 0)
            day["review_statuses"].append(t.get("review_status", "draft"))

        # Finalize
        for d, day in days.items():
            day["net_pnl_pct"] = round(day["net_pnl_pct"], 2)
            day["net_pnl_dollar"] = round(day["net_pnl_dollar"], 2)
            day["avg_process_score"] = round(day["_ps_sum"] / day["_ps_count"], 1) if day["_ps_count"] else None
            del day["_ps_sum"]
            del day["_ps_count"]

        return {"month": month, "days": days}
    finally:
        conn.close()
