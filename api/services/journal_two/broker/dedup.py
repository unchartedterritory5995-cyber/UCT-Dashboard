"""Duplicate detection between manually-entered trades and broker-imported
trades.

When a user has logged a trade by hand AND later connects the broker that
executed it, both rows exist. We never delete silently — instead we flag the
likely-same pairs (j2_broker_dup_flags) for the user to Merge or Dismiss.

Match heuristic (per user, across accounts): same symbol + side, with a
confidence score from how closely shares / entry-date / exit-date / prices
align. Pairs scoring >= THRESHOLD are flagged.

Merge keeps the BROKER trade (it carries the stable external_id, so it won't
re-duplicate on the next sync) and copies the user's manual enrichment
(setup / notes / original stop / tags) onto it, then deletes the manual row.
Dismiss just records the user's decision; both rows stay.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

THRESHOLD = 0.70


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _days_apart(a: str, b: str) -> float:
    try:
        da = datetime.fromisoformat((a or "").replace("Z", "+00:00"))
        db = datetime.fromisoformat((b or "").replace("Z", "+00:00"))
        return abs((da - db).total_seconds()) / 86400.0
    except (ValueError, AttributeError):
        return 999.0


def _close_ratio(a: float, b: float) -> float:
    hi = max(abs(a), abs(b), 1e-9)
    return max(0.0, 1.0 - abs(a - b) / hi)


def _date_score(a: str, b: str) -> float:
    d = _days_apart(a, b)
    if d <= 0.5:
        return 1.0
    if d >= 5:
        return 0.0
    return max(0.0, 1.0 - d / 5.0)


def confidence(manual: dict, broker: dict) -> float:
    """0..1 likelihood the two trades are the same. 0 if symbol/side differ."""
    if manual["symbol"] != broker["symbol"] or manual["side"] != broker["side"]:
        return 0.0
    sh = _close_ratio(manual["shares"], broker["shares"])
    ed = _date_score(manual["entry_date"], broker["entry_date"])
    xd = _date_score(manual["exit_date"], broker["exit_date"])
    ep = _close_ratio(manual["entry_price"], broker["entry_price"])
    xp = _close_ratio(manual["exit_price"], broker["exit_price"])
    return round(0.30 * sh + 0.20 * ed + 0.20 * xd + 0.15 * ep + 0.15 * xp, 3)


def _load_trades(conn, user_id):
    rows = conn.execute(
        """
        SELECT id, symbol, side, shares, entry_price, entry_date, exit_price,
               exit_date, source, setup, notes, original_stop, mistake_tags,
               emotion_tags
          FROM j2_trades WHERE user_id = ?
        """,
        (user_id,),
    ).fetchall()
    manual, broker = [], []
    for r in rows:
        d = {k: r[k] for k in r.keys()}
        (broker if r["source"] == "broker" else manual).append(d)
    return manual, broker


def scan_for_duplicates(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Find likely manual↔broker duplicate pairs and upsert pending flags.
    Idempotent (UNIQUE on user_id+manual+broker). Returns {flagged}."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        manual, broker = _load_trades(conn, user_id)
        if not manual or not broker:
            return {"flagged": 0}
        flagged = 0
        for m in manual:
            for b in broker:
                c = confidence(m, b)
                if c < THRESHOLD:
                    continue
                # Upsert pending flag (skip if a row already exists in any state).
                exists = conn.execute(
                    "SELECT 1 FROM j2_broker_dup_flags "
                    "WHERE user_id = ? AND manual_trade_id = ? AND broker_trade_id = ?",
                    (user_id, m["id"], b["id"]),
                ).fetchone()
                if exists:
                    continue
                conn.execute(
                    "INSERT INTO j2_broker_dup_flags "
                    "(id, user_id, manual_trade_id, broker_trade_id, confidence, status, created_at) "
                    "VALUES (?, ?, ?, ?, ?, 'pending', ?)",
                    (str(uuid.uuid4()), user_id, m["id"], b["id"], c, _now_iso()),
                )
                flagged += 1
        conn.commit()
        return {"flagged": flagged}
    finally:
        if owned:
            conn.close()


def list_flags(user_id: str, status: str = "pending",
               conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """Pending dup flags with a summary of both trades for side-by-side review."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        flags = conn.execute(
            "SELECT * FROM j2_broker_dup_flags WHERE user_id = ? AND status = ? "
            "ORDER BY confidence DESC, created_at DESC",
            (user_id, status),
        ).fetchall()
        out = []
        for f in flags:
            m = _trade_summary(conn, user_id, f["manual_trade_id"])
            b = _trade_summary(conn, user_id, f["broker_trade_id"])
            if m is None or b is None:
                continue  # one side deleted since flagging — stale flag, skip
            out.append({
                "id": f["id"], "confidence": f["confidence"], "status": f["status"],
                "manual": m, "broker": b, "createdAt": f["created_at"],
            })
        return out
    finally:
        if owned:
            conn.close()


def _trade_summary(conn, user_id, trade_id):
    r = conn.execute(
        "SELECT id, symbol, side, shares, entry_price, entry_date, exit_price, "
        "exit_date, pnl_dollar, setup, notes, source FROM j2_trades "
        "WHERE id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchone()
    if r is None:
        return None
    return {k: r[k] for k in r.keys()}


class DupFlagError(Exception):
    pass


def resolve_flag(user_id: str, flag_id: str, action: str,
                 conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """action='merge' → copy the manual trade's enrichment onto the broker
    trade (which keeps its external_id, so no re-duplication) and delete the
    manual row. action='dismiss' → just record the decision. Both idempotent-ish
    (a resolved flag won't re-resolve)."""
    if action not in ("merge", "dismiss"):
        raise DupFlagError("action must be 'merge' or 'dismiss'")
    owned = conn is None
    conn = conn or get_connection()
    try:
        f = conn.execute(
            "SELECT * FROM j2_broker_dup_flags WHERE id = ? AND user_id = ?",
            (flag_id, user_id),
        ).fetchone()
        if f is None:
            raise DupFlagError("flag not found")
        if f["status"] != "pending":
            return {"id": flag_id, "status": f["status"], "noop": True}

        conn.execute("BEGIN")
        try:
            if action == "merge":
                m = conn.execute(
                    "SELECT setup, notes, original_stop, mistake_tags, emotion_tags "
                    "FROM j2_trades WHERE id = ? AND user_id = ?",
                    (f["manual_trade_id"], user_id),
                ).fetchone()
                if m is not None:
                    # Copy manual enrichment onto the broker trade (only fill
                    # fields the broker trade lacks; broker facts stay).
                    conn.execute(
                        """
                        UPDATE j2_trades
                           SET setup = COALESCE(NULLIF(setup, ''), ?),
                               notes = COALESCE(NULLIF(notes, ''), ?),
                               original_stop = ?,
                               mistake_tags = COALESCE(mistake_tags, ?),
                               emotion_tags = COALESCE(emotion_tags, ?)
                         WHERE id = ? AND user_id = ?
                        """,
                        (m["setup"], m["notes"], m["original_stop"],
                         m["mistake_tags"], m["emotion_tags"],
                         f["broker_trade_id"], user_id),
                    )
                    conn.execute(
                        "DELETE FROM j2_trades WHERE id = ? AND user_id = ?",
                        (f["manual_trade_id"], user_id),
                    )
                new_status = "merged"
            else:
                new_status = "dismissed"
            conn.execute(
                "UPDATE j2_broker_dup_flags SET status = ? WHERE id = ? AND user_id = ?",
                (new_status, flag_id, user_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return {"id": flag_id, "status": new_status}
    finally:
        if owned:
            conn.close()
