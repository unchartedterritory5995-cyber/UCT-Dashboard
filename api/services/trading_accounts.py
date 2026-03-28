"""
Trading Accounts service — manage multiple brokerage accounts per user.
Each account tracks balance, risk parameters, and acts as a container for trades.
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


def list_accounts(user_id: str) -> list[dict]:
    """Return all active accounts for user, default account first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM trading_accounts
               WHERE user_id = ? AND is_active = 1
               ORDER BY is_default DESC, created_at ASC""",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_account(user_id: str, account_id: int) -> dict | None:
    """Get a single account by ID."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM trading_accounts WHERE id = ? AND user_id = ? AND is_active = 1",
            (account_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_account(user_id: str, data: dict) -> dict:
    """Create a new trading account. First account auto-becomes default."""
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        # Check if user has any active accounts
        existing_count = conn.execute(
            "SELECT COUNT(*) as c FROM trading_accounts WHERE user_id = ? AND is_active = 1",
            (user_id,),
        ).fetchone()["c"]

        is_default = 1 if existing_count == 0 else (1 if data.get("is_default") else 0)

        # If setting this as default, unset others first
        if is_default:
            conn.execute(
                "UPDATE trading_accounts SET is_default = 0 WHERE user_id = ?",
                (user_id,),
            )

        name = (data.get("name") or "Main Account")[:100]
        broker = (data.get("broker") or "")[:100] or None
        account_number = (data.get("account_number") or "")[:50] or None
        balance = float(data.get("balance", 50000))
        initial_balance = float(data.get("initial_balance", balance))
        max_risk_pct = float(data.get("max_risk_pct", 1.0))
        max_position_pct = float(data.get("max_position_pct", 10.0))

        cursor = conn.execute(
            """INSERT INTO trading_accounts
               (user_id, name, broker, account_number, balance, initial_balance,
                max_risk_pct, max_position_pct, is_default, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            (user_id, name, broker, account_number, balance, initial_balance,
             max_risk_pct, max_position_pct, is_default, now, now),
        )
        conn.commit()
        account_id = cursor.lastrowid
        return get_account(user_id, account_id)
    finally:
        conn.close()


def update_account(user_id: str, account_id: int, data: dict) -> dict | None:
    """Update account fields (name, broker, balance, risk settings)."""
    existing = get_account(user_id, account_id)
    if not existing:
        return None

    allowed = {"name", "broker", "account_number", "balance", "initial_balance",
               "max_risk_pct", "max_position_pct"}
    updates = {}
    for k, v in data.items():
        if k in allowed and v is not None:
            if k in ("balance", "initial_balance", "max_risk_pct", "max_position_pct"):
                updates[k] = float(v)
            else:
                updates[k] = str(v)[:100]

    if not updates:
        return existing

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [account_id, user_id]

    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE trading_accounts SET {set_clause} WHERE id = ? AND user_id = ?",
            values,
        )
        conn.commit()
        return get_account(user_id, account_id)
    finally:
        conn.close()


def delete_account(user_id: str, account_id: int) -> bool:
    """Soft delete an account (set is_active = 0)."""
    conn = get_connection()
    try:
        result = conn.execute(
            "UPDATE trading_accounts SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ? AND is_active = 1",
            (datetime.now(timezone.utc).isoformat(), account_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def set_default(user_id: str, account_id: int) -> dict | None:
    """Set an account as the default, unsetting all others."""
    account = get_account(user_id, account_id)
    if not account:
        return None

    conn = get_connection()
    try:
        conn.execute(
            "UPDATE trading_accounts SET is_default = 0 WHERE user_id = ?",
            (user_id,),
        )
        conn.execute(
            "UPDATE trading_accounts SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?",
            (datetime.now(timezone.utc).isoformat(), account_id, user_id),
        )
        conn.commit()
        return get_account(user_id, account_id)
    finally:
        conn.close()


def get_default_account(user_id: str) -> dict | None:
    """Return the user's default account, or None."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM trading_accounts WHERE user_id = ? AND is_default = 1 AND is_active = 1",
            (user_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_account_balance(user_id: str, account_name: str = None) -> float | None:
    """Get balance for an account by name, or the default account if no name given.
    Used by journal_service for size_pct calculation."""
    conn = get_connection()
    try:
        if account_name and account_name != "default":
            row = conn.execute(
                "SELECT balance FROM trading_accounts WHERE user_id = ? AND name = ? AND is_active = 1",
                (user_id, account_name),
            ).fetchone()
            if row:
                return row["balance"]

        # Fall back to default account
        row = conn.execute(
            "SELECT balance FROM trading_accounts WHERE user_id = ? AND is_default = 1 AND is_active = 1",
            (user_id,),
        ).fetchone()
        return row["balance"] if row else None
    finally:
        conn.close()
