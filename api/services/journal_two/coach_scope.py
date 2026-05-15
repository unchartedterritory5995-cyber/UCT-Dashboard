"""Compass scope resolution.

The Compass coaching surface accepts either a real account id (per-account
mode) or the literal string '_all_' (unified mode). Every read path that
backs a Compass call uses resolve_account_scope() to translate that
caller-supplied value into the list of real account ids it should query.

In unified mode the list is filtered to accounts the user has opted in to
via the per-account compass_enabled toggle. Turn that toggle off on an
account to exclude it from unified coaching while keeping its per-account
coach reachable when that account is the selected one.
"""

from __future__ import annotations

import sqlite3

from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID


def is_unified(account_id: str | None) -> bool:
    """True if the caller is asking for unified-mode behavior."""
    return account_id == UNIFIED_ACCOUNT_ID


def resolve_account_scope(
    conn: sqlite3.Connection,
    user_id: str,
    account_id: str,
) -> list[str]:
    """Return the list of real j2_accounts ids this Compass call should query.

    - account_id == '_all_': all of the user's accounts with compass_enabled = 1
    - any other value: [account_id] (assumed validated upstream)
    """
    if not is_unified(account_id):
        return [account_id]
    rows = conn.execute(
        "SELECT id FROM j2_accounts WHERE user_id = ? AND compass_enabled = 1 ORDER BY created_at ASC",
        (user_id,),
    ).fetchall()
    return [r["id"] for r in rows]
