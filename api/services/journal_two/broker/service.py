"""Broker-sync orchestration (connect / refresh / disconnect / status).

Glues the async SnapTrade client to the synchronous connections DB layer.
Kept thin and provider-agnostic so the HTTP router stays declarative.

Connection lifecycle:
  connect()          → register a SnapTrade user (once) + return the
                       Connection-Portal redirect URL. Requires prior
                       user consent (router enforces the checkbox).
  refresh_accounts() → after the portal, list the user's brokerage
                       accounts and map each to a j2_account.
  disconnect()       → revoke at SnapTrade + purge our credential rows
                       (optionally also purge imported trade data).
  status()           → connection + per-account summary (no secret).
"""

from __future__ import annotations

from typing import Any

from api.services.auth_db import get_connection
from api.services import crypto_box
from api.services.journal_two.broker import connections, snaptrade_client as snap


class NoBrokerConnection(Exception):
    """User has not registered a SnapTrade identity yet."""


async def connect(
    user_id: str,
    *,
    custom_redirect: str | None = None,
    reconnect: str | None = None,
) -> dict[str, Any]:
    """Ensure the user has a SnapTrade identity, then return a
    Connection-Portal redirect URL. Registers + records consent on first
    call. If the stored secret can't be decrypted (encryption key lost),
    we re-register — old connections are already unrecoverable in that
    case, so a fresh identity is the only path forward."""
    snap_uid: str | None = None
    secret: str | None = None
    try:
        bu = connections.get_broker_user(user_id)
        if bu is not None:
            snap_uid, secret = bu["snaptradeUserId"], bu["userSecret"]
    except crypto_box.CryptoBoxError:
        snap_uid = None  # fall through to re-register

    if not snap_uid or not secret:
        reg = await snap.register_user(user_id)
        snap_uid, secret = reg["snaptrade_user_id"], reg["user_secret"]
        connections.save_broker_user(user_id, snap_uid, secret, record_consent=True)

    uri = await snap.login_redirect_uri(
        snap_uid, secret, custom_redirect=custom_redirect, reconnect=reconnect
    )
    return {"redirectUri": uri}


async def refresh_accounts(user_id: str) -> list[dict[str, Any]]:
    """List the user's connected brokerage accounts and map each to a
    j2_account. Returns the broker-account rows."""
    bu = connections.get_broker_user(user_id)
    if bu is None:
        raise NoBrokerConnection("no SnapTrade identity for user")

    try:
        raw_accounts = await snap.list_accounts(bu["snaptradeUserId"], bu["userSecret"])
    except snap.SnapUserSecretInvalid:
        # Stored secret is stale — mark every connection broken so the UI
        # prompts a reconnect.
        for ba in connections.list_broker_accounts(user_id):
            connections.set_status(user_id, ba["id"], "broken",
                                   error="SnapTrade user secret invalid — reconnect required")
        raise

    mapped = []
    for raw in raw_accounts:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        mapped.append(connections.map_snaptrade_account(user_id, raw))
    return mapped


async def disconnect(user_id: str, *, purge_trades: bool = False) -> dict[str, Any]:
    """Revoke at SnapTrade (best-effort) and purge our credential rows.
    Optionally also delete broker-imported trade data."""
    bu = None
    try:
        bu = connections.get_broker_user(user_id)
    except crypto_box.CryptoBoxError:
        bu = None  # can't decrypt; we still know the snaptrade id via row

    snap_uid = bu["snaptradeUserId"] if bu else _snap_uid_no_decrypt(user_id)
    if snap_uid:
        try:
            await snap.delete_user(snap_uid)
        except snap.SnapError:
            pass  # best-effort; we still purge locally

    purged = {"trades": 0, "positions": 0, "optionStrategies": 0}
    conn = get_connection()
    try:
        if purge_trades:
            purged = _purge_imported(user_id, conn)
        conn.commit()
    finally:
        conn.close()

    connections.delete_broker_user(user_id)
    return {"disconnected": True, "purged": purged}


def _snap_uid_no_decrypt(user_id: str) -> str | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT snaptrade_user_id FROM j2_broker_users WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return row["snaptrade_user_id"] if row else None
    finally:
        conn.close()


def _purge_imported(user_id: str, conn) -> dict[str, int]:
    """Delete broker-sourced trades/positions/option strategies. Manual
    rows (source NULL or 'manual'/'csv') are untouched. Option legs cascade
    via FK ON DELETE CASCADE (foreign_keys=ON)."""
    t = conn.execute(
        "DELETE FROM j2_trades WHERE user_id = ? AND source = 'broker'", (user_id,)
    ).rowcount
    p = conn.execute(
        "DELETE FROM j2_positions WHERE user_id = ? AND source = 'broker'", (user_id,)
    ).rowcount
    o = conn.execute(
        "DELETE FROM j2_option_strategies WHERE user_id = ? AND source = 'broker'", (user_id,)
    ).rowcount
    return {"trades": t, "positions": p, "optionStrategies": o}


def purge_on_account_deletion(user_id: str, conn) -> dict[str, Any]:
    """GDPR/CCPA cascade: remove all broker rows (encrypted secret + data) for
    a user being deleted, and best-effort revoke at SnapTrade. Synchronous and
    safe to call inside an account-deletion transaction; the SnapTrade revoke
    never blocks or raises (the local purge is the compliance-critical part).

    `conn` is the caller's open connection (the deletion transaction)."""
    import asyncio

    snap_uid = None
    try:
        row = conn.execute(
            "SELECT snaptrade_user_id FROM j2_broker_users WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        snap_uid = row["snaptrade_user_id"] if row else None
    except Exception:
        snap_uid = None

    # Local purge (always — the encrypted secret + financial data).
    for tbl in ("j2_broker_activities", "j2_broker_accounts", "j2_broker_sync_log",
                "j2_broker_dup_flags", "j2_broker_users"):
        try:
            conn.execute(f"DELETE FROM {tbl} WHERE user_id = ?", (user_id,))
        except Exception:
            pass  # table may not exist on very old DBs

    # Best-effort revoke at SnapTrade (never block deletion).
    if snap_uid and snap.is_configured():
        try:
            asyncio.run(snap.delete_user(snap_uid))
        except Exception:
            pass
    return {"purged": True, "snaptradeUserId": snap_uid}


def status(user_id: str) -> dict[str, Any]:
    """Connection + per-account summary for the Settings panel. Never
    decrypts the secret (works even if the key is lost — surfaces 'broken')."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT consent_at FROM j2_broker_users WHERE user_id = ?", (user_id,)
        ).fetchone()
        connected = row is not None
        accounts = connections.list_broker_accounts(user_id, conn=conn)
        dup_pending = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_dup_flags "
            "WHERE user_id = ? AND status = 'pending'",
            (user_id,),
        ).fetchone()["n"]
        return {
            "connected": connected,
            "consentAt": row["consent_at"] if row else None,
            "accounts": accounts,
            "dupFlagsPending": dup_pending,
            "snaptradeConfigured": snap.is_configured(),
        }
    finally:
        conn.close()
