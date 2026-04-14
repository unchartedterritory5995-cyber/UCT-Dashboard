"""
Ticker tag service — per-user color tags for tickers.
One color per ticker per user (UNIQUE constraint).
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


def get_user_tags(user_id: str) -> dict:
    """Return {sym: color} for all tagged tickers."""
    conn = get_connection()
    try:
        rows = conn.execute("SELECT sym, color FROM ticker_tags WHERE user_id = ?", (user_id,)).fetchall()
        return {r["sym"]: r["color"] for r in rows}
    finally:
        conn.close()


def set_tag(user_id: str, sym: str, color: str) -> dict:
    """Set or update a tag. Returns the tag dict."""
    conn = get_connection()
    try:
        s = sym.upper()
        now = datetime.now(timezone.utc).isoformat()
        existing = conn.execute(
            "SELECT id FROM ticker_tags WHERE user_id = ? AND sym = ?", (user_id, s)
        ).fetchone()
        if existing:
            conn.execute("UPDATE ticker_tags SET color = ? WHERE id = ?", (color, existing["id"]))
        else:
            tag_id = str(uuid.uuid4())[:12]
            conn.execute(
                "INSERT INTO ticker_tags (id, user_id, sym, color, created_at) VALUES (?,?,?,?,?)",
                (tag_id, user_id, s, color, now),
            )
        conn.commit()
        return {"sym": s, "color": color}
    finally:
        conn.close()


def remove_tag(user_id: str, sym: str) -> bool:
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM ticker_tags WHERE user_id = ? AND sym = ?", (user_id, sym.upper())
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def get_tags_for_symbols(user_id: str, symbols: list[str]) -> dict:
    """Batch query: return {sym: color} for given symbols."""
    if not symbols:
        return {}
    conn = get_connection()
    try:
        placeholders = ",".join("?" * len(symbols))
        rows = conn.execute(
            f"SELECT sym, color FROM ticker_tags WHERE user_id = ? AND sym IN ({placeholders})",
            [user_id] + [s.upper() for s in symbols],
        ).fetchall()
        return {r["sym"]: r["color"] for r in rows}
    finally:
        conn.close()
