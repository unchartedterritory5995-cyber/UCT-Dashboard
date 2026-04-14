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


def get_shared_tag_colors(user_id: str) -> list[str]:
    """Return list of color keys the user has shared publicly."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = 'shared_tag_colors'",
            (user_id,),
        ).fetchone()
        if row:
            import json
            try:
                return json.loads(row["pref_value"])
            except (json.JSONDecodeError, TypeError):
                pass
        return []
    finally:
        conn.close()


def set_shared_tag_colors(user_id: str, colors: list[str]) -> list[str]:
    """Set which color tag lists are shared publicly."""
    import json
    from api.services.auth_service import set_user_preference
    set_user_preference(user_id, "shared_tag_colors", json.dumps(colors))
    return colors


def get_public_tag_lists(limit: int = 50) -> list[dict]:
    """Return all public tag lists across all users."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT user_id, pref_value FROM user_preferences WHERE pref_key = 'shared_tag_colors'"
        ).fetchall()
        results = []
        for r in rows:
            import json
            try:
                colors = json.loads(r["pref_value"])
            except (json.JSONDecodeError, TypeError):
                continue
            if not colors:
                continue
            user = conn.execute("SELECT display_name, email FROM users WHERE id = ?", (r["user_id"],)).fetchone()
            owner_name = (user["display_name"] or user["email"].split("@")[0]) if user else "Unknown"
            # Get tags for each shared color
            for color in colors:
                tags = conn.execute(
                    "SELECT sym FROM ticker_tags WHERE user_id = ? AND color = ?",
                    (r["user_id"], color),
                ).fetchall()
                syms = [t["sym"] for t in tags]
                if syms:
                    results.append({
                        "user_id": r["user_id"],
                        "owner_name": owner_name,
                        "color": color,
                        "symbols": syms,
                    })
        return results[:limit]
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
