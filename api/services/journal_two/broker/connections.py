"""Broker-connection persistence + SnapTrade↔j2_account mapping.

This module is the DB layer for broker sync. It is provider-agnostic and
synchronous (testable against an in-memory SQLite). The SnapTrade network
calls live in `snaptrade_client`; the async orchestration that ties them
together lives in `sync` / the router.

Tables: j2_broker_users (one SnapTrade identity per UCT user, encrypted
secret) and j2_broker_accounts (each connected brokerage account mapped
1:1 to a j2_accounts row).
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services import crypto_box
from api.services.journal_two import accounts as accounts_service


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Broker user (SnapTrade identity) ─────────────────────────────────────────

def save_broker_user(
    user_id: str,
    snaptrade_user_id: str,
    user_secret: str,
    conn: sqlite3.Connection | None = None,
    *,
    record_consent: bool = True,
) -> None:
    """Upsert the user's SnapTrade identity, encrypting the secret at rest.
    Sets consent_at on first save (or when record_consent and currently null)."""
    enc = crypto_box.encrypt(user_secret)
    owned = conn is None
    conn = conn or get_connection()
    try:
        now = _now_iso()
        existing = conn.execute(
            "SELECT user_id, consent_at FROM j2_broker_users WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO j2_broker_users
                    (user_id, snaptrade_user_id, user_secret_enc, consent_at,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, snaptrade_user_id, enc,
                 now if record_consent else None, now, now),
            )
        else:
            consent = existing["consent_at"]
            if record_consent and not consent:
                consent = now
            conn.execute(
                """
                UPDATE j2_broker_users
                   SET snaptrade_user_id = ?, user_secret_enc = ?,
                       consent_at = ?, updated_at = ?
                 WHERE user_id = ?
                """,
                (snaptrade_user_id, enc, consent, now, user_id),
            )
        conn.commit()
    finally:
        if owned:
            conn.close()


def get_broker_user(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Return {snaptradeUserId, userSecret, consentAt} with the secret
    DECRYPTED, or None if the user has no SnapTrade identity.

    Raises crypto_box.CryptoBoxError if the stored secret cannot be
    decrypted (encryption key lost/rotated) — caller should mark the
    connection broken and prompt reconnect, not crash."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_broker_users WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            return None
        secret = crypto_box.decrypt(row["user_secret_enc"])
        return {
            "userId": row["user_id"],
            "snaptradeUserId": row["snaptrade_user_id"],
            "userSecret": secret,
            "consentAt": row["consent_at"],
        }
    finally:
        if owned:
            conn.close()


def has_broker_user(user_id: str, conn: sqlite3.Connection | None = None) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        return conn.execute(
            "SELECT 1 FROM j2_broker_users WHERE user_id = ?", (user_id,)
        ).fetchone() is not None
    finally:
        if owned:
            conn.close()


def delete_broker_user(user_id: str, conn: sqlite3.Connection | None = None) -> None:
    """Remove the SnapTrade identity + every broker-account mapping + the
    raw activity ledger for this user. Does NOT delete imported trades —
    that's a separate, explicit choice in the disconnect flow."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM j2_broker_accounts WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM j2_broker_activities WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM j2_broker_users WHERE user_id = ?", (user_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


# ── SnapTrade account → our fields ───────────────────────────────────────────

def _mask_number(raw: Any) -> str | None:
    """Keep only the last 4 chars of an account number. SnapTrade may
    already mask it; we mask again defensively so we never store a full
    account number."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    tail = s[-4:]
    return f"••{tail}"


def summarize_account(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a raw SnapTrade account dict into the fields we persist.
    Defensive about field names across SDK versions."""
    institution = raw.get("institution_name") or raw.get("brokerage")
    auth = raw.get("brokerage_authorization")
    if not institution and isinstance(auth, dict):
        # Connection object can carry the brokerage name nested.
        brk = auth.get("brokerage")
        if isinstance(brk, dict):
            institution = brk.get("name") or brk.get("display_name")
        institution = institution or auth.get("name")
    # balance/currency may be nested under balance/total
    currency = None
    bal = raw.get("balance")
    if isinstance(bal, dict):
        cur = bal.get("total") or {}
        if isinstance(cur, dict):
            currency = cur.get("currency")
    meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
    return {
        "snaptrade_account_id": raw.get("id"),
        "brokerage_name": institution or meta.get("brokerage_name"),
        "account_number_masked": _mask_number(raw.get("number")),
        "account_type": raw.get("raw_type") or raw.get("type") or meta.get("type"),
        "currency": currency,
        "name": raw.get("name") or institution or "Brokerage account",
    }


def authorization_disabled(raw_account: dict[str, Any]) -> bool | None:
    """Best-effort read of the SnapTrade brokerage-authorization "disabled"
    (token-expiry) flag from a raw account dict — the Sync Trust Center's
    token-expiry hook (Task B6).

    Returns True/False ONLY when the `brokerage_authorization` value is a
    nested object that actually carries `disabled`/`disabled_date`; returns
    None when the flag isn't exposed. On the current SnapTrade plan the
    account's `brokerage_authorization` is just the authorization id STRING —
    the `disabled`/`disabled_date` fields live on the separate Authorization
    resource (`list_brokerage_authorizations`), which we neither fetch here
    nor have a column to persist. So in practice this returns None and
    `trust_summary` emits only 'ok'/'broken'.

    # TODO: SnapTrade authorization.disabled is not available on the account
    # object on the current plan. Promoting tokenState 'ok' → 'expiring' needs
    # (a) an authorizations fetch and (b) a persisted column — both out of B6.
    """
    if not isinstance(raw_account, dict):
        return None
    auth = raw_account.get("brokerage_authorization")
    if isinstance(auth, dict):
        if auth.get("disabled") is not None:
            return bool(auth.get("disabled"))
        if auth.get("disabled_date"):
            return True
    return None


def token_state(
    *, account_status: str, authorization_disabled: bool | None = None
) -> str:
    """Coarse token health for the Trust Center: 'broken' | 'expiring' | 'ok'.

    'broken'   → the connection needs a reconnect (account status='broken').
    'expiring' → the brokerage authorization is flagged disabled/near-expiry,
                 IF that data was capturable (see `authorization_disabled` —
                 not exposed on the current plan, so never emitted from the
                 DB-read path; the branch exists for when it becomes available).
    'ok'       → default.
    """
    if account_status == "broken":
        return "broken"
    if authorization_disabled:
        return "expiring"
    return "ok"


# ── Broker account mapping ───────────────────────────────────────────────────

_BROKER_COLORS = [
    "blue", "purple", "teal", "magenta", "orange", "lime",
    "cyan", "pink", "slate", "sky", "emerald", "amber",
]


def _next_color(user_id: str, conn: sqlite3.Connection) -> str:
    used = {
        r["color"]
        for r in conn.execute(
            "SELECT color FROM j2_accounts WHERE user_id = ?", (user_id,)
        ).fetchall()
    }
    for c in _BROKER_COLORS:
        if c not in used:
            return c
    return "slate"


def list_broker_accounts(
    user_id: str, conn: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_broker_accounts WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        return [_row_to_broker_account(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_broker_account(
    user_id: str, broker_account_id: str, conn: sqlite3.Connection | None = None
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_broker_accounts WHERE id = ? AND user_id = ?",
            (broker_account_id, user_id),
        ).fetchone()
        return _row_to_broker_account(row) if row else None
    finally:
        if owned:
            conn.close()


def list_all_sync_enabled_accounts(
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Every sync-enabled account across ALL users (any status). Used by the
    Recent Orders poll, which filters status itself."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_broker_accounts WHERE sync_enabled = 1"
        ).fetchall()
        return [_row_to_broker_account(r) for r in rows]
    finally:
        if owned:
            conn.close()


def list_due_accounts(
    interval_minutes: int, conn: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    """All sync-enabled, active broker accounts (across ALL users) whose last
    sync is older than `interval_minutes` (or never synced). Used by the
    background scheduler. Excludes 'broken' (needs reconnect) + 'disabled'."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=interval_minutes)).isoformat()
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT * FROM j2_broker_accounts
             WHERE sync_enabled = 1 AND status = 'active'
               AND (last_sync_at IS NULL OR last_sync_at < ?)
             ORDER BY (last_sync_at IS NOT NULL), last_sync_at ASC
            """,
            (cutoff,),
        ).fetchall()
        return [_row_to_broker_account(r) for r in rows]
    finally:
        if owned:
            conn.close()


def map_snaptrade_account(
    user_id: str,
    raw_account: dict[str, Any],
    conn: sqlite3.Connection | None = None,
    *,
    starting_balance: float = 1.0,
) -> dict[str, Any]:
    """Ensure a j2_broker_accounts row exists for this SnapTrade account,
    creating a matching j2_account (balance_source='broker') the first
    time. Idempotent on (user_id, snaptrade_account_id). Returns the
    broker-account dict.

    `starting_balance` seeds the new j2_account; for broker accounts the
    real equity comes from the balance sync and the resolver prefers it,
    so this is only a placeholder until the first balance pull."""
    summary = summarize_account(raw_account)
    snap_id = summary["snaptrade_account_id"]
    if not snap_id:
        raise ValueError("SnapTrade account missing id")

    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_broker_accounts WHERE user_id = ? AND snaptrade_account_id = ?",
            (user_id, snap_id),
        ).fetchone()
        if existing:
            # Refresh descriptive fields (broker may have updated them).
            conn.execute(
                """
                UPDATE j2_broker_accounts
                   SET brokerage_name = ?, account_number_masked = ?,
                       account_type = ?, currency = ?, updated_at = ?
                 WHERE id = ?
                """,
                (summary["brokerage_name"], summary["account_number_masked"],
                 summary["account_type"], summary["currency"], _now_iso(),
                 existing["id"]),
            )
            conn.commit()
            return _row_to_broker_account(
                conn.execute("SELECT * FROM j2_broker_accounts WHERE id = ?",
                             (existing["id"],)).fetchone()
            )

        # New mapping → create a dedicated j2_account.
        acct_name = _unique_account_name(user_id, summary, conn)
        j2 = accounts_service.create_account(
            user_id,
            {
                "name": acct_name,
                "color": _next_color(user_id, conn),
                "broker": summary["brokerage_name"] or "Brokerage",
                "startingBalance": float(starting_balance),
            },
            conn=conn,
        )
        # Mark it broker-sourced so the balance resolver uses real equity.
        conn.execute(
            "UPDATE j2_accounts SET balance_source = 'broker', updated_at = ? WHERE id = ? AND user_id = ?",
            (_now_iso(), j2["id"], user_id),
        )

        new_id = str(uuid.uuid4())
        now = _now_iso()
        conn.execute(
            """
            INSERT INTO j2_broker_accounts
                (id, user_id, snaptrade_account_id, brokerage_name,
                 account_number_masked, account_type, currency, j2_account_id,
                 sync_enabled, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
            """,
            (new_id, user_id, snap_id, summary["brokerage_name"],
             summary["account_number_masked"], summary["account_type"],
             summary["currency"], j2["id"], now, now),
        )
        conn.commit()
        return _row_to_broker_account(
            conn.execute("SELECT * FROM j2_broker_accounts WHERE id = ?", (new_id,)).fetchone()
        )
    finally:
        if owned:
            conn.close()


def _unique_account_name(user_id: str, summary: dict, conn: sqlite3.Connection) -> str:
    base = summary["brokerage_name"] or "Brokerage"
    masked = summary["account_number_masked"]
    name = f"{base} {masked}".strip() if masked else base
    name = name[:60]
    # Disambiguate collisions (e.g. two IRAs at the same broker).
    existing = {
        r["name"]
        for r in conn.execute(
            "SELECT name FROM j2_accounts WHERE user_id = ?", (user_id,)
        ).fetchall()
    }
    if name not in existing:
        return name
    for i in range(2, 100):
        candidate = f"{name} ({i})"[:60]
        if candidate not in existing:
            return candidate
    return f"{name} {uuid.uuid4().hex[:4]}"[:60]


# ── Sync-state mutations ─────────────────────────────────────────────────────

def set_sync_enabled(
    user_id: str, broker_account_id: str, enabled: bool,
    conn: sqlite3.Connection | None = None,
) -> bool:
    return _update_account_fields(
        user_id, broker_account_id, {"sync_enabled": 1 if enabled else 0}, conn
    )


def list_accounts_by_authorization(
    user_id: str, authorization_id: str, conn: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    """Accounts mapped under one SnapTrade brokerage authorization (the id is
    stamped during sync — accounts not yet stamped won't match)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_broker_accounts "
            "WHERE user_id = ? AND brokerage_authorization_id = ?",
            (user_id, authorization_id),
        ).fetchall()
        return [_row_to_broker_account(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_account_by_snaptrade_id(
    user_id: str, snaptrade_account_id: str, conn: sqlite3.Connection | None = None
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_broker_accounts "
            "WHERE user_id = ? AND snaptrade_account_id = ?",
            (user_id, snaptrade_account_id),
        ).fetchone()
        return _row_to_broker_account(row)
    finally:
        if owned:
            conn.close()


def set_status(
    user_id: str, broker_account_id: str, status: str,
    conn: sqlite3.Connection | None = None, *, error: str | None = None,
) -> bool:
    if status not in ("active", "broken", "disabled"):
        raise ValueError(f"invalid status {status!r}")
    return _update_account_fields(
        user_id, broker_account_id,
        {"status": status, "last_error": error}, conn,
    )


def update_cursor(
    user_id: str, broker_account_id: str, cursor: str | None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    return _update_account_fields(
        user_id, broker_account_id, {"activities_cursor": cursor}, conn
    )


def record_holdings_meta(
    user_id: str, broker_account_id: str, *,
    holdings_synced_at: str | None = None,
    authorization_id: str | None = None,
    tx_initial_sync_completed: bool | None = None,
    tx_last_successful_sync: str | None = None,
    first_transaction_date: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Persist SnapTrade sync_status metadata: the broker-reported holdings
    snapshot time, the authorization id (needed for manual refresh), and the
    transactions sync-status trio (backfill completeness + synced-through
    date + first known transaction). None values are skipped so a payload
    without sync_status never blanks a prior stamp."""
    fields: dict[str, Any] = {}
    if holdings_synced_at is not None:
        fields["holdings_synced_at"] = holdings_synced_at
    if authorization_id is not None:
        fields["brokerage_authorization_id"] = authorization_id
    if tx_initial_sync_completed is not None:
        fields["tx_initial_sync_completed"] = 1 if tx_initial_sync_completed else 0
    if tx_last_successful_sync is not None:
        fields["tx_last_successful_sync"] = tx_last_successful_sync
    if first_transaction_date is not None:
        fields["first_transaction_date"] = first_transaction_date
    if not fields:
        return False
    return _update_account_fields(user_id, broker_account_id, fields, conn)


def record_manual_refresh(
    user_id: str, broker_account_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    return _update_account_fields(
        user_id, broker_account_id,
        {"last_manual_refresh_at": datetime.now(timezone.utc).isoformat()}, conn,
    )


def record_sync_result(
    user_id: str, broker_account_id: str, *, ok: bool, error: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    return _update_account_fields(
        user_id, broker_account_id,
        {
            "last_sync_at": _now_iso(),
            "last_sync_status": "ok" if ok else "error",
            "last_error": None if ok else error,
        },
        conn,
    )


def set_warming(
    user_id: str, broker_account_id: str, until_iso: str | None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Begin (or extend) the post-connect warming window. Resets tick state."""
    return _update_account_fields(
        user_id, broker_account_id,
        {"warming_until": until_iso, "warming_last_activity_count": None,
         "warming_stable_ticks": 0},
        conn,
    )


def clear_warming(
    user_id: str, broker_account_id: str, conn: sqlite3.Connection | None = None
) -> bool:
    """End the warming window (backfill settled or window expired)."""
    return _update_account_fields(
        user_id, broker_account_id, {"warming_until": None}, conn
    )


def bump_warming_state(
    user_id: str, broker_account_id: str, *, activity_count: int, stable_ticks: int,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Record the latest warming-tick observation (activity count + stability)."""
    return _update_account_fields(
        user_id, broker_account_id,
        {"warming_last_activity_count": int(activity_count),
         "warming_stable_ticks": int(stable_ticks)},
        conn,
    )


def list_warming_accounts(
    now_iso: str, conn: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    """Active, sync-enabled accounts still inside their warming window."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT * FROM j2_broker_accounts
             WHERE sync_enabled = 1 AND status = 'active'
               AND warming_until IS NOT NULL AND warming_until > ?
             ORDER BY warming_until ASC
            """,
            (now_iso,),
        ).fetchall()
        return [_row_to_broker_account(r) for r in rows]
    finally:
        if owned:
            conn.close()


def _update_account_fields(
    user_id: str, broker_account_id: str, fields: dict[str, Any],
    conn: sqlite3.Connection | None,
) -> bool:
    if not fields:
        return False
    owned = conn is None
    conn = conn or get_connection()
    try:
        sets = ", ".join(f"{k} = ?" for k in fields)
        params = list(fields.values()) + [_now_iso(), broker_account_id, user_id]
        cur = conn.execute(
            f"UPDATE j2_broker_accounts SET {sets}, updated_at = ? "
            f"WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def delete_broker_account(
    user_id: str, broker_account_id: str, conn: sqlite3.Connection | None = None
) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_broker_accounts WHERE id = ? AND user_id = ?",
            (broker_account_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def _row_to_broker_account(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "snaptradeAccountId": row["snaptrade_account_id"],
        "brokerageName": row["brokerage_name"],
        "accountNumberMasked": row["account_number_masked"],
        "accountType": row["account_type"],
        "currency": row["currency"],
        "j2AccountId": row["j2_account_id"],
        "syncEnabled": bool(row["sync_enabled"]),
        "status": row["status"],
        "activitiesCursor": row["activities_cursor"],
        "lastSyncAt": row["last_sync_at"],
        "lastSyncStatus": row["last_sync_status"],
        "lastError": row["last_error"],
        "warmingUntil": row["warming_until"],
        "warmingLastActivityCount": row["warming_last_activity_count"],
        "warmingStableTicks": row["warming_stable_ticks"] or 0,
        "holdingsSyncedAt": row["holdings_synced_at"],
        "brokerageAuthorizationId": row["brokerage_authorization_id"],
        "lastManualRefreshAt": row["last_manual_refresh_at"],
        "txInitialSyncCompleted": (None if row["tx_initial_sync_completed"] is None
                                   else bool(row["tx_initial_sync_completed"])),
        "txLastSuccessfulSync": row["tx_last_successful_sync"],
        "firstTransactionDate": row["first_transaction_date"],
        "warming": bool(
            row["warming_until"]
            and row["warming_until"] > datetime.now(timezone.utc).isoformat()
        ),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
