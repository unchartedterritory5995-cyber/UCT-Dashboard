"""
Journal resources service — CRUD for checklists, rules, templates, psychology notes, plans.
All data in the journal_resources table (created in Phase 1 migration).
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


VALID_CATEGORIES = {"checklist", "rule", "template", "psychology", "plan"}

_WRITABLE_FIELDS = {"category", "title", "content", "sort_order", "is_pinned"}


def list_resources(user_id: str, category: str = None) -> list[dict]:
    """List resources, optionally filtered by category."""
    conn = get_connection()
    try:
        where = "user_id = ?"
        params = [user_id]
        if category and category in VALID_CATEGORIES:
            where += " AND category = ?"
            params.append(category)

        rows = conn.execute(
            f"""SELECT * FROM journal_resources
                WHERE {where}
                ORDER BY is_pinned DESC, sort_order ASC, created_at DESC""",
            params,
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_resource(user_id: str, resource_id: str) -> dict | None:
    """Get a single resource by ID."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM journal_resources WHERE id = ? AND user_id = ?",
            (resource_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_resource(user_id: str, data: dict) -> dict:
    """Create a new resource."""
    res_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    category = (data.get("category") or "").lower()
    if category not in VALID_CATEGORIES:
        category = "checklist"

    title = (data.get("title") or "Untitled")[:500]
    content = (data.get("content") or "")[:10000]
    sort_order = int(data.get("sort_order") or 0)
    is_pinned = 1 if data.get("is_pinned") else 0

    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO journal_resources
               (id, user_id, category, title, content, sort_order, is_pinned, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (res_id, user_id, category, title, content, sort_order, is_pinned, now, now),
        )
        conn.commit()
        return get_resource(user_id, res_id)
    finally:
        conn.close()


def update_resource(user_id: str, resource_id: str, data: dict) -> dict | None:
    """Update a resource's fields."""
    existing = get_resource(user_id, resource_id)
    if not existing:
        return None

    updates = {k: v for k, v in data.items() if k in _WRITABLE_FIELDS}
    if not updates:
        return existing

    # Validate/sanitize
    if "category" in updates:
        cat = (updates["category"] or "").lower()
        if cat not in VALID_CATEGORIES:
            del updates["category"]
        else:
            updates["category"] = cat
    if "title" in updates:
        updates["title"] = (updates["title"] or "Untitled")[:500]
    if "content" in updates:
        updates["content"] = (updates["content"] or "")[:10000]
    if "sort_order" in updates:
        updates["sort_order"] = int(updates["sort_order"] or 0)
    if "is_pinned" in updates:
        updates["is_pinned"] = 1 if updates["is_pinned"] else 0

    if not updates:
        return existing

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [resource_id, user_id]

    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE journal_resources SET {set_clause} WHERE id = ? AND user_id = ?",
            values,
        )
        conn.commit()
        return get_resource(user_id, resource_id)
    finally:
        conn.close()


def delete_resource(user_id: str, resource_id: str) -> bool:
    """Delete a resource."""
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM journal_resources WHERE id = ? AND user_id = ?",
            (resource_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()
