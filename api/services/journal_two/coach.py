"""Compass Coach orchestrator for Journal 2.0.

Public API
----------
generate_weekly_review(user_id, account_id, week_start, *, client=None, conn=None) -> dict
list_weekly_reviews(user_id, account_id, *, conn=None) -> list[dict]
get_weekly_review(review_id, *, conn=None) -> dict | None
set_feedback(review_id, feedback, *, conn=None) -> None
forget_review(review_id, *, conn=None) -> None

Production Anthropic calls go through AnthropicClient; tests inject FakeClient.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import coach_data_assembler
from api.services.journal_two import coach_prompts
from api.services.journal_two import db as j2_db


# ---------------------------------------------------------------------------
# Protocol — lets tests inject a fake without subclassing AnthropicClient
# ---------------------------------------------------------------------------

@runtime_checkable
class CoachClientProto(Protocol):
    def write_review(self, *, system_prompt: str, user_message: str) -> dict: ...
    def write_profile_update(self, *, system_prompt: str, user_message: str) -> dict: ...


# ---------------------------------------------------------------------------
# Production Anthropic wrapper
# ---------------------------------------------------------------------------

class AnthropicClient:
    """Thin wrapper around the Anthropic Python SDK for Compass coach calls."""

    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, api_key: str | None = None) -> None:
        import anthropic  # deferred so the module is importable without the package installed

        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self._client = anthropic.Anthropic(api_key=key)

    # ------------------------------------------------------------------
    # Review generation
    # ------------------------------------------------------------------

    def write_review(self, *, system_prompt: str, user_message: str) -> dict:
        """Call Claude to produce a weekly review.

        Returns dict with keys: body, summary, key_observations.
        """
        msg = self._client.messages.create(
            model=self.DEFAULT_MODEL,
            max_tokens=2000,
            temperature=0.4,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_message}],
        )
        body = msg.content[0].text if msg.content else ""
        summary = _extract_first_paragraph(body)
        return {"body": body, "summary": summary, "key_observations": []}

    # ------------------------------------------------------------------
    # Profile update
    # ------------------------------------------------------------------

    def write_profile_update(self, *, system_prompt: str, user_message: str) -> dict:
        """Call Claude to update the trader profile narrative.

        Returns dict with key: updated_profile.
        """
        msg = self._client.messages.create(
            model=self.DEFAULT_MODEL,
            max_tokens=2000,
            temperature=0.3,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_message}],
        )
        text = msg.content[0].text if msg.content else ""
        return {"updated_profile": text.strip()}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_first_paragraph(text: str) -> str:
    """Return the first non-empty paragraph of *text* (up to 300 chars)."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return stripped[:300]
    return text[:300]


def _row_to_dict(row) -> dict:
    """Convert a sqlite3.Row (or dict-like) from j2_coach_outputs to plain dict."""
    keys = row.keys() if hasattr(row, "keys") else row
    d = dict(zip(keys, tuple(row))) if not hasattr(row, "keys") else {k: row[k] for k in row.keys()}
    # Parse metadata JSON so callers get a real dict
    if isinstance(d.get("metadata"), str):
        try:
            d["metadata"] = json.loads(d["metadata"])
        except (json.JSONDecodeError, TypeError):
            d["metadata"] = {}
    return d


def _get_conn(conn=None):
    """Return *conn* if provided, otherwise open a fresh connection to the auth DB."""
    if conn is not None:
        return conn, False  # (conn, should_close)
    import sqlite3 as _sqlite3

    path = os.environ.get("AUTH_DB_PATH", j2_db.DEFAULT_DB_PATH)
    c = _sqlite3.connect(path)
    c.row_factory = _sqlite3.Row
    return c, True


# ---------------------------------------------------------------------------
# Core orchestration
# ---------------------------------------------------------------------------

def generate_weekly_review(
    user_id: str,
    account_id: str,
    week_start: str,
    *,
    client: CoachClientProto | None = None,
    conn=None,
) -> dict:
    """Generate (or return cached) weekly Compass review for *week_start*.

    Idempotent on (user_id, account_id, week_start) — returns the existing row
    if one already exists without calling the LLM again.

    Parameters
    ----------
    user_id:     JWT sub for the trader.
    account_id:  j2_accounts.id for the trading account.
    week_start:  ISO date string (YYYY-MM-DD) for Monday of the review week.
    client:      CoachClientProto implementation. Defaults to AnthropicClient().
    conn:        sqlite3 connection to reuse (tests inject a temp-file conn here).

    Returns
    -------
    dict — the j2_coach_outputs row (output_type='weekly_review').
    """
    _conn, _should_close = _get_conn(conn)
    try:
        return _generate_weekly_review_inner(
            user_id=user_id,
            account_id=account_id,
            week_start=week_start,
            client=client or AnthropicClient(),
            conn=_conn,
        )
    finally:
        if _should_close:
            _conn.close()


def _generate_weekly_review_inner(
    *,
    user_id: str,
    account_id: str,
    week_start: str,
    client: CoachClientProto,
    conn,
) -> dict:
    # ------------------------------------------------------------------
    # 1. Idempotency guard — return existing row if present
    # ------------------------------------------------------------------
    existing = conn.execute(
        """
        SELECT id, body, summary, metadata, feedback, created_at
          FROM j2_coach_outputs
         WHERE user_id     = ?
           AND account_id  = ?
           AND output_type = 'weekly_review'
           AND forgotten   = 0
           AND json_extract(metadata, '$.week_start') = ?
         LIMIT 1
        """,
        (user_id, account_id, week_start),
    ).fetchone()
    if existing:
        return _row_to_dict(existing)

    # ------------------------------------------------------------------
    # 2. Assemble context data for this week
    # ------------------------------------------------------------------
    data = coach_data_assembler.assemble_week(
        user_id=user_id,
        account_id=account_id,
        week_start=week_start,
        conn=conn,
    )

    # ------------------------------------------------------------------
    # 3. Fetch current trader profile to include in prompts
    # ------------------------------------------------------------------
    acc_row = conn.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? LIMIT 1",
        (account_id,),
    ).fetchone()
    current_profile: str = (acc_row["trader_profile"] if acc_row else "") or ""

    # ------------------------------------------------------------------
    # 4. Build prompts and call LLM for the weekly review
    # ------------------------------------------------------------------
    system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT
    user_message = coach_prompts.assemble_user_message(data=data)

    review_result = client.write_review(
        system_prompt=system_prompt,
        user_message=user_message,
    )

    body: str = review_result.get("body", "")
    summary: str = review_result.get("summary", "") or _extract_first_paragraph(body)
    key_observations: list = review_result.get("key_observations", [])

    # ------------------------------------------------------------------
    # 5. Persist the weekly_review row
    # ------------------------------------------------------------------
    review_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    metadata = json.dumps(
        {
            "week_start": week_start,
            "key_observations": key_observations,
        }
    )

    conn.execute(
        """
        INSERT INTO j2_coach_outputs
            (id, user_id, account_id, output_type, body, summary, metadata, forgotten, created_at)
        VALUES (?, ?, ?, 'weekly_review', ?, ?, ?, 0, ?)
        """,
        (review_id, user_id, account_id, body, summary, metadata, now_iso),
    )
    conn.commit()

    # ------------------------------------------------------------------
    # 6. Best-effort: update trader profile (failure must not block review)
    # ------------------------------------------------------------------
    try:
        profile_message = (
            f"Current profile:\n{current_profile}\n\n"
            f"Weekly review just produced:\n{body}"
        )
        profile_result = client.write_profile_update(
            system_prompt=coach_prompts.PROFILE_UPDATE_SYSTEM_PROMPT,
            user_message=profile_message,
        )
        updated_profile: str = profile_result.get("updated_profile", "").strip()

        if updated_profile:
            # Persist profile_update output row
            pu_id = str(uuid.uuid4())
            pu_metadata = json.dumps({"week_start": week_start, "source_review_id": review_id})
            conn.execute(
                """
                INSERT INTO j2_coach_outputs
                    (id, user_id, account_id, output_type, body, summary, metadata, forgotten, created_at)
                VALUES (?, ?, ?, 'profile_update', ?, '', ?, 0, ?)
                """,
                (pu_id, user_id, account_id, updated_profile, pu_metadata, now_iso),
            )
            # Update j2_accounts.trader_profile (scoped by user_id for defense-in-depth)
            conn.execute(
                "UPDATE j2_accounts SET trader_profile = ? WHERE id = ? AND user_id = ?",
                (updated_profile, account_id, user_id),
            )
            conn.commit()
    except Exception:
        pass  # Best-effort — review is already committed

    # ------------------------------------------------------------------
    # 7. Return the persisted review dict
    # ------------------------------------------------------------------
    row = conn.execute(
        """
        SELECT id, body, summary, metadata, feedback, created_at
          FROM j2_coach_outputs
         WHERE id = ?
        """,
        (review_id,),
    ).fetchone()
    return _row_to_dict(row)


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def list_weekly_reviews(user_id: str, account_id: str, *, conn=None) -> list[dict]:
    """Return all non-forgotten weekly reviews for *account_id*, newest first."""
    _conn, _should_close = _get_conn(conn)
    try:
        rows = _conn.execute(
            """
            SELECT id, body, summary, metadata, feedback, created_at
              FROM j2_coach_outputs
             WHERE user_id     = ?
               AND account_id  = ?
               AND output_type = 'weekly_review'
               AND forgotten   = 0
             ORDER BY created_at DESC
            """,
            (user_id, account_id),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        if _should_close:
            _conn.close()


def get_weekly_review(review_id: str, *, user_id: str | None = None, conn=None) -> dict | None:
    """Return a single weekly review row by *review_id*, or None if not found.
    When *user_id* is provided, scopes the lookup so users can't read each
    other's reviews even with a guessed UUID."""
    _conn, _should_close = _get_conn(conn)
    try:
        if user_id is not None:
            row = _conn.execute(
                """
                SELECT id, body, summary, metadata, feedback, created_at
                  FROM j2_coach_outputs
                 WHERE id = ? AND user_id = ? AND forgotten = 0
                 LIMIT 1
                """,
                (review_id, user_id),
            ).fetchone()
        else:
            row = _conn.execute(
                """
                SELECT id, body, summary, metadata, feedback, created_at
                  FROM j2_coach_outputs
                 WHERE id = ? AND forgotten = 0
                 LIMIT 1
                """,
                (review_id,),
            ).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        if _should_close:
            _conn.close()


def set_feedback(review_id: str, feedback: str, *, user_id: str | None = None, conn=None) -> int:
    """Attach user feedback text to a review row. Returns the number of rows
    affected (0 if not found / not owned)."""
    _conn, _should_close = _get_conn(conn)
    try:
        if user_id is not None:
            cur = _conn.execute(
                "UPDATE j2_coach_outputs SET feedback = ? WHERE id = ? AND user_id = ?",
                (feedback, review_id, user_id),
            )
        else:
            cur = _conn.execute(
                "UPDATE j2_coach_outputs SET feedback = ? WHERE id = ?",
                (feedback, review_id),
            )
        _conn.commit()
        return cur.rowcount
    finally:
        if _should_close:
            _conn.close()


def forget_review(review_id: str, *, user_id: str | None = None, conn=None) -> int:
    """Soft-delete a review row (sets forgotten = 1). Returns rowcount."""
    _conn, _should_close = _get_conn(conn)
    try:
        if user_id is not None:
            cur = _conn.execute(
                "UPDATE j2_coach_outputs SET forgotten = 1 WHERE id = ? AND user_id = ?",
                (review_id, user_id),
            )
        else:
            cur = _conn.execute(
                "UPDATE j2_coach_outputs SET forgotten = 1 WHERE id = ?",
                (review_id,),
            )
        _conn.commit()
        return cur.rowcount
    finally:
        if _should_close:
            _conn.close()
