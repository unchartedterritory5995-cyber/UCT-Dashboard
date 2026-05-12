"""Compass Chat orchestrator — persistence + history reconstruction.

The streaming Anthropic loop and tool dispatch land in Tasks 6 + 7.
This file ships only the storage primitives that those layers build on.
"""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.journal_two import db as j2_db

RATE_LIMIT_PER_DAY = 200


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH", j2_db.DEFAULT_DB_PATH)
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def append_message(
    *,
    user_id: str,
    account_id: str,
    role: str,
    content: str | None = None,
    tool_calls: list | None = None,
    tool_results: list | None = None,
    parent_id: str | None = None,
    metadata: dict | None = None,
    conn=None,
) -> str:
    _conn, _close = _get_conn(conn)
    try:
        mid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        _conn.execute(
            """INSERT INTO j2_chat_messages
               (id, user_id, account_id, role, content, tool_calls, tool_results,
                parent_id, metadata, created_at, forgotten)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (mid, user_id, account_id, role, content,
             json.dumps(tool_calls) if tool_calls is not None else None,
             json.dumps(tool_results) if tool_results is not None else None,
             parent_id,
             json.dumps(metadata) if metadata is not None else None,
             now),
        )
        _conn.commit()
        return mid
    finally:
        if _close:
            _conn.close()


def list_messages(
    *,
    user_id: str,
    account_id: str,
    limit: int = 50,
    before_id: str | None = None,
    include_forgotten: bool = False,
    conn=None,
) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        sql = """SELECT id, role, content, tool_calls, tool_results, parent_id,
                        metadata, created_at, forgotten
                 FROM j2_chat_messages
                 WHERE user_id = ? AND account_id = ?"""
        params: list[Any] = [user_id, account_id]
        if not include_forgotten:
            sql += " AND forgotten = 0"
        if before_id:
            row = _conn.execute(
                "SELECT created_at FROM j2_chat_messages WHERE id = ?", (before_id,)
            ).fetchone()
            if row:
                sql += " AND created_at < ?"
                params.append(row["created_at"])
        sql += " ORDER BY created_at ASC LIMIT ?"
        params.append(limit)
        rows = _conn.execute(sql, params).fetchall()
        out = [_row_to_dict(r) for r in rows]
        total = _conn.execute(
            "SELECT COUNT(*) AS n FROM j2_chat_messages WHERE user_id = ? AND account_id = ? AND forgotten = 0",
            (user_id, account_id),
        ).fetchone()["n"]
        return {"messages": out, "has_more": len(out) < total}
    finally:
        if _close:
            _conn.close()


def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "tool_calls": json.loads(row["tool_calls"]) if row["tool_calls"] else None,
        "tool_results": json.loads(row["tool_results"]) if row["tool_results"] else None,
        "parent_id": row["parent_id"],
        "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
        "created_at": row["created_at"],
        "forgotten": bool(row["forgotten"]),
    }


def forget_message(
    *,
    user_id: str,
    account_id: str,
    message_id: str | None = None,
    all: bool = False,
    conn=None,
) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        if all:
            cur = _conn.execute(
                "UPDATE j2_chat_messages SET forgotten = 1 "
                "WHERE user_id = ? AND account_id = ? AND role != 'summary'",
                (user_id, account_id),
            )
        else:
            if not message_id:
                return {"updated": 0, "error": "message_id required when all=False"}
            cur = _conn.execute(
                "UPDATE j2_chat_messages SET forgotten = 1 WHERE id = ? AND user_id = ?",
                (message_id, user_id),
            )
        _conn.commit()
        return {"updated": cur.rowcount}
    finally:
        if _close:
            _conn.close()


def get_rate_limit_info(*, user_id: str, account_id: str, conn=None) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        today_iso = datetime.now(timezone.utc).date().isoformat()
        cur = _conn.execute(
            """SELECT COUNT(*) AS n FROM j2_chat_messages
               WHERE user_id = ? AND account_id = ?
               AND role = 'user'
               AND substr(created_at, 1, 10) = ?""",
            (user_id, account_id, today_iso),
        ).fetchone()
        used = cur["n"]
        return {"limit": RATE_LIMIT_PER_DAY, "used": used,
                "remaining": max(0, RATE_LIMIT_PER_DAY - used)}
    finally:
        if _close:
            _conn.close()


def get_chat_status(*, user_id: str, account_id: str, conn=None) -> dict:
    enabled = os.environ.get("COMPASS_CHAT_ENABLED", "true").lower() != "false"
    rate = get_rate_limit_info(user_id=user_id, account_id=account_id, conn=conn)
    _conn, _close = _get_conn(conn)
    try:
        count_row = _conn.execute(
            "SELECT COUNT(*) AS n FROM j2_chat_messages WHERE user_id = ? AND account_id = ? AND forgotten = 0",
            (user_id, account_id),
        ).fetchone()
        return {
            "enabled": enabled,
            "rate_limit_remaining": rate["remaining"],
            "conversation_message_count": count_row["n"],
        }
    finally:
        if _close:
            _conn.close()
