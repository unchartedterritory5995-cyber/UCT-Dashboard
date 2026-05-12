"""
Per-trade Compass post-mortem.

One row per (user, trade) in `j2_trade_reviews`. Idempotent by default;
pass regenerate=True to overwrite.
"""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import coach_data_assembler


class AnthropicReviewClient:
    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, api_key: str | None = None):
        import anthropic
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self._client = anthropic.Anthropic(api_key=key)

    def write_review(self, *, system_prompt: str, user_message: str) -> dict:
        msg = self._client.messages.create(
            model=self.DEFAULT_MODEL,
            max_tokens=600,
            temperature=0.4,
            system=[{"type": "text", "text": system_prompt,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_message}],
        )
        body = msg.content[0].text if msg.content else ""
        return {"body": body}


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def _trade_row_to_dict(row) -> dict:
    out = dict(row)
    for k in ("mistake_tags", "emotion_tags"):
        try:
            out[k] = json.loads(out.get(k) or "[]")
        except (TypeError, json.JSONDecodeError):
            out[k] = []
    return out


def generate_review(
    *,
    user_id: str,
    account_id: str,
    trade_id: str,
    client=None,
    conn=None,
    regenerate: bool = False,
) -> dict:
    """Generate (or return existing) post-mortem for a closed trade."""
    _conn, _close = _get_conn(conn)
    try:
        # Idempotency check
        if not regenerate:
            existing = _conn.execute(
                """SELECT id, body, summary, metadata, feedback, created_at, trade_id
                   FROM j2_trade_reviews
                   WHERE user_id = ? AND trade_id = ? AND forgotten = 0""",
                (user_id, trade_id),
            ).fetchone()
            if existing:
                return _row_to_dict(existing)

        # Fetch trade
        trade_row = _conn.execute(
            """SELECT id, symbol, side, shares, entry_price, exit_price,
                      entry_date, exit_date, original_stop, setup, notes,
                      pnl_dollar, pnl_percent, r_multiple, hold_days, result,
                      mistake_tags, emotion_tags, regime
               FROM j2_trades WHERE id = ? AND user_id = ?""",
            (trade_id, user_id),
        ).fetchone()
        if trade_row is None:
            return {"error": f"trade {trade_id} not found"}
        trade = _trade_row_to_dict(trade_row)

        # Setup 90d context
        from api.services.journal_two import coach_prompts
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=90)
        recent_trades = coach_data_assembler._trades_in_range(_conn, user_id, account_id, start, end)
        setup_name = trade.get("setup")
        setup_trades = [t for t in recent_trades if t.get("setup") == setup_name] if setup_name else []
        setup_agg = coach_data_assembler._aggregate_trades(setup_trades)

        # Trader profile
        profile_row = _conn.execute(
            "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        profile = (profile_row["trader_profile"] or "")[:1500] if profile_row else ""

        # Build user message
        parts = [
            "# Trade post-mortem request",
            "",
            "## The trade",
            f"- Symbol: {trade.get('symbol')}",
            f"- Side: {trade.get('side')}",
            f"- Shares: {trade.get('shares')}",
            f"- Entry: {trade.get('entry_price')} on {trade.get('entry_date')}",
            f"- Exit: {trade.get('exit_price')} on {trade.get('exit_date')}",
            f"- Stop: {trade.get('original_stop')}",
            f"- Setup: {setup_name or '(unspecified)'}",
            f"- Result: {trade.get('result')}",
            f"- R-multiple: {trade.get('r_multiple')}",
            f"- $P&L: {trade.get('pnl_dollar')}",
            f"- Hold days: {trade.get('hold_days')}",
            f"- Regime: {trade.get('regime') or 'unknown'}",
            f"- Trader's notes: {trade.get('notes') or '(none)'}",
            f"- Mistake tags: {trade.get('mistake_tags')}",
            f"- Emotion tags: {trade.get('emotion_tags')}",
            "",
            f"## Setup performance over last 90 days ({setup_name or 'all'})",
            f"- Trades: {setup_agg.get('trade_count', 0)}",
            f"- Wins/Losses: {setup_agg.get('wins', 0)}/{setup_agg.get('losses', 0)}",
            f"- Avg R: {setup_agg.get('avg_r')}",
            f"- Profit factor: {setup_agg.get('profit_factor')}",
            "",
        ]
        if profile:
            parts.append("## Trader profile")
            parts.append(profile)
            parts.append("")
        parts.append("Write the post-mortem. Be Compass.")
        user_message = "\n".join(parts)

        system_prompt = getattr(
            coach_prompts, "COMPASS_TRADE_REVIEW_PROMPT",
            "You are Compass. Write a 3-5 sentence post-mortem on this trade. Cite at least one specific data point and end with one specific takeaway."
        )

        active_client = client or AnthropicReviewClient()
        response = active_client.write_review(
            system_prompt=system_prompt, user_message=user_message,
        )
        body = (response.get("body") or "").strip()
        summary = body[:200] if body else ""

        # Persist (UNIQUE constraint REPLACES on conflict)
        rid = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        meta = json.dumps({"setup": setup_name, "regime": trade.get("regime"),
                           "regenerated": bool(regenerate)})
        _conn.execute(
            """INSERT OR REPLACE INTO j2_trade_reviews
               (id, user_id, account_id, trade_id, body, summary, metadata,
                feedback, forgotten, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)""",
            (rid, user_id, account_id, trade_id, body, summary, meta, now_iso),
        )
        _conn.commit()
        return {
            "id": rid, "body": body, "summary": summary,
            "metadata": json.loads(meta), "feedback": None,
            "created_at": now_iso, "trade_id": trade_id,
        }
    finally:
        if _close:
            _conn.close()


def list_reviews(*, user_id: str, account_id: str, limit: int = 50, conn=None) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        rows = _conn.execute(
            """SELECT id, body, summary, metadata, feedback, created_at, trade_id
               FROM j2_trade_reviews
               WHERE user_id = ? AND account_id = ? AND forgotten = 0
               ORDER BY created_at DESC LIMIT ?""",
            (user_id, account_id, limit),
        ).fetchall()
        return {"reviews": [_row_to_dict(r) for r in rows]}
    finally:
        if _close:
            _conn.close()


def get_review(review_id: str, *, user_id: str, conn=None) -> dict | None:
    _conn, _close = _get_conn(conn)
    try:
        row = _conn.execute(
            """SELECT id, body, summary, metadata, feedback, created_at, trade_id
               FROM j2_trade_reviews
               WHERE id = ? AND user_id = ? AND forgotten = 0""",
            (review_id, user_id),
        ).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        if _close:
            _conn.close()


def set_feedback(review_id: str, *, feedback: str, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        cur = _conn.execute(
            "UPDATE j2_trade_reviews SET feedback = ? WHERE id = ? AND user_id = ?",
            (feedback, review_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def forget_review(review_id: str, *, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        cur = _conn.execute(
            "UPDATE j2_trade_reviews SET forgotten = 1 WHERE id = ? AND user_id = ?",
            (review_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def _row_to_dict(row) -> dict:
    if row is None:
        return None
    try:
        meta = json.loads(row["metadata"]) if row["metadata"] else {}
    except (TypeError, json.JSONDecodeError):
        meta = {}
    return {
        "id": row["id"], "body": row["body"], "summary": row["summary"] or "",
        "metadata": meta, "feedback": row["feedback"],
        "created_at": row["created_at"], "trade_id": row["trade_id"],
    }
