"""
Journal service — per-user trade journal CRUD.
All data in auth.db (journal_entries table), completely isolated from existing DBs.
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection

VALID_DIRECTIONS = {"long", "short"}
VALID_STATUSES = {"open", "closed", "stopped"}


def _safe_float(val):
    """Coerce to float, return None if not possible."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


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

    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO journal_entries
               (id, user_id, sym, direction, setup, entry_price, exit_price,
                stop_price, target_price, size_pct, status, entry_date, exit_date,
                pnl_pct, pnl_dollar, notes, rating, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                entry_id, user_id, sym, direction,
                (data.get("setup") or "")[:100],
                _safe_float(data.get("entry_price")),
                _safe_float(data.get("exit_price")),
                _safe_float(data.get("stop_price")),
                _safe_float(data.get("target_price")),
                _safe_float(data.get("size_pct")),
                status,
                (data.get("entry_date") or "")[:10],
                (data.get("exit_date") or None),
                None, None,  # pnl computed on close
                (data.get("notes") or "")[:2000],
                min(max(int(data.get("rating") or 0), 0), 5),
                now, now,
            ),
        )
        conn.commit()
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


def list_entries(user_id: str, status: str = None, limit: int = 200) -> list[dict]:
    limit = min(limit, 500)
    conn = get_connection()
    try:
        if status and status in VALID_STATUSES:
            rows = conn.execute(
                "SELECT * FROM journal_entries WHERE user_id = ? AND status = ? ORDER BY entry_date DESC LIMIT ?",
                (user_id, status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_entry(user_id: str, entry_id: str, data: dict) -> dict | None:
    existing = get_entry(user_id, entry_id)
    if not existing:
        return None

    allowed = {
        "sym", "direction", "setup", "entry_price", "exit_price",
        "stop_price", "target_price", "size_pct", "status",
        "entry_date", "exit_date", "pnl_pct", "pnl_dollar", "notes", "rating",
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return existing

    # Normalize direction
    if "direction" in updates:
        updates["direction"] = (updates["direction"] or "long").lower()
        if updates["direction"] not in VALID_DIRECTIONS:
            updates["direction"] = "long"

    # Normalize status
    if "status" in updates:
        updates["status"] = (updates["status"] or "open").lower()
        if updates["status"] not in VALID_STATUSES:
            updates["status"] = "open"

    if "sym" in updates:
        updates["sym"] = (updates["sym"] or "").upper().strip()

    if "notes" in updates:
        updates["notes"] = (updates["notes"] or "")[:2000]

    if "setup" in updates:
        updates["setup"] = (updates["setup"] or "")[:100]

    if "rating" in updates:
        updates["rating"] = min(max(int(updates["rating"] or 0), 0), 5)

    # Auto-compute P&L when closing a trade
    if updates.get("status") in ("closed", "stopped") or updates.get("exit_price") is not None:
        entry_price = _safe_float(updates.get("entry_price", existing["entry_price"]))
        exit_price = _safe_float(updates.get("exit_price", existing["exit_price"]))
        direction = updates.get("direction", existing["direction"] or "long").lower()
        if entry_price and entry_price > 0 and exit_price:
            if direction == "short":
                pnl_pct = ((entry_price - exit_price) / entry_price) * 100
            else:
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
            updates["pnl_pct"] = round(pnl_pct, 2)

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
        return get_entry(user_id, entry_id)
    finally:
        conn.close()


def delete_entry(user_id: str, entry_id: str) -> bool:
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM journal_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def get_stats(user_id: str) -> dict:
    """Aggregate stats for a user's journal."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM journal_entries WHERE user_id = ? AND status = 'closed'",
            (user_id,),
        ).fetchall()
        entries = [dict(r) for r in rows]

        open_count = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE user_id = ? AND status = 'open'",
            (user_id,),
        ).fetchone()["c"]

        if not entries:
            return {
                "total_trades": 0, "open_trades": open_count, "wins": 0, "losses": 0,
                "win_rate": 0, "avg_win_pct": 0, "avg_loss_pct": 0,
                "profit_factor": 0, "total_pnl_pct": 0,
                "best_trade": None, "worst_trade": None,
                "top_setups": [],
            }

        # Filter to entries that have valid P&L
        with_pnl = [e for e in entries if e["pnl_pct"] is not None]
        wins = [e for e in with_pnl if e["pnl_pct"] > 0]
        losses = [e for e in with_pnl if e["pnl_pct"] <= 0]

        avg_win = sum(e["pnl_pct"] for e in wins) / len(wins) if wins else 0
        avg_loss = sum(abs(e["pnl_pct"]) for e in losses) / len(losses) if losses else 0
        total_win = sum(e["pnl_pct"] for e in wins)
        total_loss = sum(abs(e["pnl_pct"]) for e in losses)
        pf = total_win / total_loss if total_loss > 0 else 0

        sorted_by_pnl = sorted(with_pnl, key=lambda e: e["pnl_pct"])
        best = sorted_by_pnl[-1] if sorted_by_pnl else None
        worst = sorted_by_pnl[0] if sorted_by_pnl else None

        # Top setups by win rate (min 2 trades)
        setup_map = {}
        for e in with_pnl:
            s = e["setup"] or "Unknown"
            if s not in setup_map:
                setup_map[s] = {"setup": s, "wins": 0, "total": 0, "pnl_sum": 0}
            setup_map[s]["total"] += 1
            setup_map[s]["pnl_sum"] += e["pnl_pct"]
            if e["pnl_pct"] > 0:
                setup_map[s]["wins"] += 1
        top_setups = sorted(
            [v for v in setup_map.values() if v["total"] >= 2],
            key=lambda x: x["wins"] / x["total"],
            reverse=True,
        )[:5]
        for s in top_setups:
            s["win_rate"] = round(s["wins"] / s["total"] * 100, 1)
            s["avg_pnl"] = round(s["pnl_sum"] / s["total"], 2)

        return {
            "total_trades": len(entries),
            "open_trades": open_count,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / len(with_pnl) * 100, 1) if with_pnl else 0,
            "avg_win_pct": round(avg_win, 2),
            "avg_loss_pct": round(avg_loss, 2),
            "profit_factor": round(pf, 2),
            "total_pnl_pct": round(sum(e["pnl_pct"] for e in with_pnl), 2),
            "best_trade": {"sym": best["sym"], "pnl_pct": best["pnl_pct"]} if best else None,
            "worst_trade": {"sym": worst["sym"], "pnl_pct": worst["pnl_pct"]} if worst else None,
            "top_setups": top_setups,
        }
    finally:
        conn.close()
