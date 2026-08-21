"""Broker-sync orchestration (connect / refresh / disconnect / status).

Glues the async SnapTrade client to the synchronous connections DB layer.
Kept thin and provider-agnostic so the HTTP router stays declarative.

Connection lifecycle:
  connect()          → register a SnapTrade user (once) + return the
                       Connection-Portal redirect URL. Requires prior
                       user consent (router enforces the checkbox).
  refresh_accounts() → after the portal, list the user's brokerage
                       accounts and map each to a j2_account.
  disconnect()       → revoke at SnapTrade + purge our credential rows,
                       and undo the j2_accounts rows the connection created
                       (optionally also purge imported trade data).
  status()           → connection + per-account summary (no secret).
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services import crypto_box
from api.services.journal_two.broker import connections, snaptrade_client as snap


class NoBrokerConnection(Exception):
    """User has not registered a SnapTrade identity yet."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def connect(
    user_id: str,
    *,
    custom_redirect: str | None = None,
    reconnect: str | None = None,
) -> dict[str, Any]:
    """Ensure the user has a SnapTrade identity, then return a
    Connection-Portal redirect URL. Registers + records consent on first
    call. If the stored secret can't be decrypted because the ENCRYPTION KEY
    IS MISSING, we refuse (don't silently mint a new identity over the real
    one). Only if a key IS configured but the ciphertext is genuinely
    undecryptable do we re-register (the old connections are unrecoverable);
    we best-effort revoke the old SnapTrade user first to avoid orphans."""
    snap_uid: str | None = None
    secret: str | None = None
    decrypt_failed = False
    try:
        bu = connections.get_broker_user(user_id)
        if bu is not None:
            snap_uid, secret = bu["snaptradeUserId"], bu["userSecret"]
    except crypto_box.CryptoBoxError:
        if not crypto_box.is_configured():
            # Transient/mis-deploy (key unset) — do NOT abandon the real
            # identity. Surface as a clear error so the operator restores the key.
            raise
        decrypt_failed = True  # key present but ciphertext bad → must re-register

    if decrypt_failed:
        old_uid = _snap_uid_no_decrypt(user_id)
        if old_uid:
            try:
                await snap.delete_user(old_uid)  # best-effort, avoid orphan
            except snap.SnapError:
                pass
        snap_uid = None

    if not snap_uid or not secret:
        reg = await snap.register_user(user_id)
        snap_uid, secret = reg["snaptrade_user_id"], reg["user_secret"]
        connections.save_broker_user(user_id, snap_uid, secret, record_consent=True)

    try:
        uri = await snap.login_redirect_uri(
            snap_uid, secret, custom_redirect=custom_redirect, reconnect=reconnect
        )
    except snap.SnapUserSecretInvalid:
        # The stored secret is no longer valid AT SnapTrade — happens on an
        # API-key swap (test→production), secret rotation, or revocation. The
        # ciphertext decrypts fine; it's just rejected by the partner. Re-register
        # a fresh identity under the CURRENT key and retry, so the user never has
        # to manually Disconnect first. Drop `reconnect` — the fresh user has no
        # brokerage authorization to repair.
        try:
            await snap.delete_user(snap_uid)  # best-effort; clear any stale prior
        except snap.SnapError:
            pass
        reg = await snap.register_user(user_id)
        snap_uid, secret = reg["snaptrade_user_id"], reg["user_secret"]
        connections.save_broker_user(user_id, snap_uid, secret, record_consent=True)
        uri = await snap.login_redirect_uri(
            snap_uid, secret, custom_redirect=custom_redirect
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
    """Revoke at SnapTrade (best-effort), purge our credential rows, and undo
    the j2_accounts rows this connection created — an emptied one is deleted,
    one still holding trades reverts to a plain manual account (see
    `_unlink_broker_accounts`). Optionally also delete imported trade data."""
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

    # Drop per-account sync locks (bound _locks growth). Capture the mapped
    # j2_account ids in the same pass — j2_broker_accounts (which holds the
    # mapping) is about to be deleted, so this is the last chance to read it.
    linked_j2_ids: list[str] = []
    try:
        from api.services.journal_two.broker import sync as _sync_engine
        for ba in connections.list_broker_accounts(user_id):
            _sync_engine.release_lock(ba["id"])
            if ba.get("j2AccountId"):
                linked_j2_ids.append(ba["j2AccountId"])
    except Exception:
        pass
    if not linked_j2_ids:  # lock-release import failed — read the mapping directly
        linked_j2_ids = [
            ba["j2AccountId"]
            for ba in connections.list_broker_accounts(user_id)
            if ba.get("j2AccountId")
        ]

    purged = {"trades": 0, "positions": 0, "optionStrategies": 0}
    conn = get_connection()
    try:
        if purge_trades:
            purged = _purge_imported(user_id, conn)
        conn.commit()
    finally:
        conn.close()

    connections.delete_broker_user(user_id)
    unlinked = _unlink_broker_accounts(user_id, linked_j2_ids)
    return {"disconnected": True, "purged": purged, **unlinked}


# Journal content the user authored or imported. A broker-created account with
# none of these is a pure connection artifact — nothing is lost by removing it,
# and leaving it behind is what strands a phantom account.
_CONTENT_TABLES = (
    "j2_trades", "j2_positions", "j2_option_strategies", "j2_notes",
)

# Coaching/derived rows are ABOUT an account rather than content in it, so they
# never keep a phantom account alive — but they must not be orphaned either.
# When the account goes, these follow the user to their surviving account.
_REASSIGN_TABLES = (
    "j2_chat_messages", "j2_coach_outputs", "j2_onboarding_responses",
    "j2_verdicts", "j2_trade_reviews", "j2_interventions",
    "j2_profile_suggestions", "j2_journal_rules",
)


def _account_is_empty(conn, user_id: str, account_id: str) -> bool:
    for table in _CONTENT_TABLES:
        try:
            row = conn.execute(
                f"SELECT 1 FROM {table} WHERE user_id = ? AND account_id = ? LIMIT 1",
                (user_id, account_id),
            ).fetchone()
        except sqlite3.OperationalError:
            continue  # table/column not present in this schema revision
        if row is not None:
            return False
    return True


def _surviving_account_id(conn, user_id: str) -> str | None:
    """The account a removed broker account's coaching history should follow.
    Prefers an existing account; if the broker account was the user's ONLY one,
    materializes their Default so the history has somewhere to land (the same
    Default `get_or_migrate_default_account` would create on next page load)."""
    row = conn.execute(
        """
        SELECT id FROM j2_accounts WHERE user_id = ?
         ORDER BY (CASE WHEN name='Default' THEN 0 ELSE 1 END), created_at ASC
         LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    if row:
        return row["id"]
    try:
        from api.services.journal_two import accounts as accounts_service
        conn.commit()  # publish the delete before the migration helper reads
        return accounts_service.get_or_migrate_default_account(user_id)["id"]
    except Exception:
        return None  # leave the rows put rather than lose them


def _reassign_coaching_rows(conn, user_id: str, from_account_id: str) -> None:
    """Move an emptied account's coaching history onto the user's surviving
    account so deleting the phantom never silently drops their Compass
    conversation. Best-effort per table — a missing table or a schema without
    the column must not abort the disconnect."""
    present = []
    for table in _REASSIGN_TABLES:
        try:
            row = conn.execute(
                f"SELECT 1 FROM {table} WHERE user_id = ? AND account_id = ? LIMIT 1",
                (user_id, from_account_id),
            ).fetchone()
        except sqlite3.OperationalError:
            continue
        if row is not None:
            present.append(table)
    if not present:
        return  # nothing to preserve — don't materialize an account for no reason

    target = _surviving_account_id(conn, user_id)
    if not target or target == from_account_id:
        return
    for table in present:
        conn.execute(
            f"UPDATE {table} SET account_id = ? WHERE user_id = ? AND account_id = ?",
            (target, user_id, from_account_id),
        )


def _unlink_broker_accounts(user_id: str, account_ids: list[str]) -> dict[str, int]:
    """Undo what `map_snaptrade_account` created, for accounts whose broker
    connection has just been removed.

    A broker-created j2_account is an artifact of the connection, not something
    the user authored. Left behind it keeps `balance_source='broker'` plus the
    last-synced broker_* balances frozen on the row, and every broker surface
    (balance_resolver, BrokerAccountHero, Today/Calendar/Analytics) keeps
    rendering that stale net-liq with no connection able to refresh it.

    So: delete the account when nothing was ever logged against it; otherwise
    keep it (the user's trades live there — disconnect explicitly promises to
    preserve them) but revert it to a plain manual account with every broker
    balance column cleared, so it can never present broker numbers again."""
    out = {"accountsRemoved": 0, "accountsReverted": 0}
    if not account_ids:
        return out
    conn = get_connection()
    try:
        for account_id in account_ids:
            if _account_is_empty(conn, user_id, account_id):
                cur = conn.execute(
                    "DELETE FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id),
                )
                if cur.rowcount:
                    _reassign_coaching_rows(conn, user_id, account_id)
                out["accountsRemoved"] += cur.rowcount
                continue
            out["accountsReverted"] += _revert_to_manual(conn, user_id, account_id)
        conn.commit()
    finally:
        conn.close()
    return out


def _revert_to_manual(conn, user_id: str, account_id: str) -> int:
    """Strip an account's broker identity: back to a plain manual account with
    every cached broker balance cleared. The single chokepoint for "this is no
    longer a broker account" — `balance_source` is what balance_resolver and
    every broker surface gate on, and the broker_* columns are the stale values
    they would otherwise keep rendering."""
    return conn.execute(
        """
        UPDATE j2_accounts
           SET balance_source = 'manual',
               broker_total_equity = NULL,
               broker_cash = NULL,
               broker_buying_power = NULL,
               broker_market_value = NULL,
               broker_balance_synced_at = NULL,
               updated_at = ?
         WHERE id = ? AND user_id = ?
        """,
        (_now_iso(), account_id, user_id),
    ).rowcount


def demote_broker_accounts(user_id: str, account_ids: list[str]) -> int:
    """Revert j2_accounts to manual WITHOUT deleting anything.

    This is the webhook-safe half of `_unlink_broker_accounts`. When SnapTrade
    reports a connection as gone (the member revoked access at their broker, or
    the account left the connection) the stale broker balances must stop being
    rendered — but the trigger is an inbound event we do not control, so a
    spurious or replayed one must never destroy a member's account. Reverting
    is idempotent and self-heals: a genuine reconnect re-flags the row."""
    ids = [a for a in account_ids if a]
    if not ids:
        return 0
    conn = get_connection()
    try:
        n = sum(_revert_to_manual(conn, user_id, a) for a in ids)
        conn.commit()
        return n
    finally:
        conn.close()


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
    import logging
    import sqlite3
    log = logging.getLogger("broker_sync")
    errors: list[str] = []

    snap_uid = None
    try:
        row = conn.execute(
            "SELECT snaptrade_user_id FROM j2_broker_users WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        snap_uid = row["snaptrade_user_id"] if row else None
    except sqlite3.OperationalError:
        snap_uid = None  # table absent on very old DBs

    # Local purge (always — the encrypted secret + financial data). Only a
    # missing-table error is benign; any other failure means data may remain,
    # so we record it and report purged=False rather than falsely succeeding.
    for tbl in ("j2_broker_activities", "j2_broker_accounts", "j2_broker_sync_log",
                "j2_broker_dup_flags", "j2_broker_users"):
        try:
            conn.execute(f"DELETE FROM {tbl} WHERE user_id = ?", (user_id,))
        except sqlite3.OperationalError as e:
            if "no such table" not in str(e).lower():
                errors.append(f"{tbl}: {e}")
                log.warning("broker purge DELETE failed on %s: %s", tbl, e)

    # Revoke at SnapTrade. This is a compliance obligation (erase the link at
    # the third party), so a failure is LOGGED + recorded, not silently
    # swallowed. asyncio.run is fine here (sync request thread, no running loop).
    revoked = False
    if snap_uid and snap.is_configured():
        try:
            asyncio.run(snap.delete_user(snap_uid))
            revoked = True
        except Exception as e:  # noqa: BLE001
            errors.append(f"revoke: {e}")
            log.warning("SnapTrade revoke failed for deleted user %s: %s", user_id, e)

    return {"purged": not errors, "revoked": revoked, "errors": errors,
            "snaptradeUserId": snap_uid}


def _row_to_sync_log(row) -> dict[str, Any]:
    """camelCase a j2_broker_sync_log row for the Trust Center audit list."""
    return {
        "id": row["id"],
        "brokerAccountId": row["broker_account_id"],
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
        "tradesImported": row["trades_imported"],
        "positionsUpserted": row["positions_upserted"],
        "optionsImported": row["options_imported"],
        "dupCandidates": row["dup_candidates"],
        "status": row["status"],
        "error": row["error"],
    }


def sync_log(
    user_id: str, *, account_id: str | None = None, limit: int = 50
) -> list[dict[str, Any]]:
    """Recent sync-audit-log rows for THIS user (newest first), optionally
    filtered to one broker account. Read-only; the log is written by
    sync.py::_start_log/_finish_log. Parameterized + user-scoped."""
    limit = max(1, min(int(limit or 50), 500))
    conn = get_connection()
    try:
        sql = (
            "SELECT id, broker_account_id, started_at, finished_at, "
            "trades_imported, positions_upserted, options_imported, "
            "dup_candidates, status, error FROM j2_broker_sync_log "
            "WHERE user_id = ?"
        )
        params: list[Any] = [user_id]
        if account_id:
            sql += " AND broker_account_id = ?"
            params.append(account_id)
        sql += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_sync_log(r) for r in rows]
    finally:
        conn.close()


async def admin_user_debug(user_id: str) -> dict[str, Any]:
    """Admin triage bundle for ONE member's broker chain: our DB state plus
    live SnapTrade probes. Answers where a "connect isn't working" report
    actually died — no identity, not registered SnapTrade-side, a DISABLED
    brokerage authorization, zero live accounts, or failing syncs. Every
    probe is best-effort: a SnapTrade hiccup shows as an error string, the
    call itself never raises."""
    out: dict[str, Any] = {
        "userId": user_id,
        "dbIdentity": False,
        "accounts": connections.list_broker_accounts(user_id),
        "recentSyncs": sync_log(user_id, limit=10),
        "snaptradeRegistered": False,
        "authorizations": [],
        "liveAccounts": None,
    }
    bu = None
    try:
        bu = connections.get_broker_user(user_id)
    except crypto_box.CryptoBoxError as e:
        out["dbIdentityError"] = f"identity present but secret undecryptable: {e}"
    out["dbIdentity"] = bu is not None or "dbIdentityError" in out

    try:
        out["snaptradeRegistered"] = user_id in await snap.list_users()
    except Exception as e:  # noqa: BLE001 — diagnostic must never raise
        out["snaptradeRegisteredError"] = str(e)

    if bu:
        try:
            auths = await snap.list_authorizations(bu["snaptradeUserId"], bu["userSecret"])
            out["authorizations"] = [{
                "id": a.get("id"),
                "brokerage": (a.get("brokerage") or {}).get("name"),
                "disabled": a.get("disabled"),
                "disabledDate": a.get("disabled_date"),
                "createdDate": a.get("created_date"),
            } for a in auths if isinstance(a, dict)]
        except Exception as e:  # noqa: BLE001
            out["authorizationsError"] = str(e)
        try:
            out["liveAccounts"] = len(
                await snap.list_accounts(bu["snaptradeUserId"], bu["userSecret"]))
        except Exception as e:  # noqa: BLE001
            out["liveAccountsError"] = str(e)
    return out


def trust_summary(user_id: str) -> dict[str, Any]:
    """Sync Trust Center summary: per broker account, the health fields +
    imported-vs-broker counts + a coarse token state. Read-only (never
    mutates broker data, never decrypts the secret, never calls SnapTrade).

    Counts:
      importedActivityCount = raw SnapTrade ledger rows (broker truth) for the
                              broker account.
      tradeCount            = broker-sourced closed trades on the linked
                              j2 account.
      positionCount         = broker-sourced OPEN positions on the linked
                              j2 account.
    tokenState ∈ 'ok'|'expiring'|'broken' (see connections.token_state — only
    'ok'/'broken' are reachable today; SnapTrade doesn't expose the
    authorization disabled flag on the current plan)."""
    from api.services.journal_two.broker import mirror_check as _mirror

    conn = get_connection()
    try:
        accounts = connections.list_broker_accounts(user_id, conn=conn)
        verdicts = _mirror.latest_verdicts(user_id, conn=conn)
        out: list[dict[str, Any]] = []
        for ba in accounts:
            broker_account_id = ba["id"]
            j2_account_id = ba["j2AccountId"]
            imported_activity_count = conn.execute(
                "SELECT COUNT(*) AS n FROM j2_broker_activities "
                "WHERE user_id = ? AND broker_account_id = ?",
                (user_id, broker_account_id),
            ).fetchone()["n"]
            trade_count = conn.execute(
                "SELECT COUNT(*) AS n FROM j2_trades "
                "WHERE user_id = ? AND account_id = ? AND source = 'broker'",
                (user_id, j2_account_id),
            ).fetchone()["n"]
            position_count = conn.execute(
                "SELECT COUNT(*) AS n FROM j2_positions "
                "WHERE user_id = ? AND account_id = ? AND source = 'broker' "
                "AND closed_at IS NULL",
                (user_id, j2_account_id),
            ).fetchone()["n"]
            out.append({
                "brokerAccountId": broker_account_id,
                "j2AccountId": j2_account_id,
                "brokerageName": ba["brokerageName"],
                "accountNumberMasked": ba["accountNumberMasked"],
                "status": ba["status"],
                "lastSyncAt": ba["lastSyncAt"],
                "lastSyncStatus": ba["lastSyncStatus"],
                "lastError": ba["lastError"],
                "syncEnabled": ba["syncEnabled"],
                "warming": ba.get("warming", False),
                "importedActivityCount": imported_activity_count,
                "tradeCount": trade_count,
                "positionCount": position_count,
                # DB-read path has no live authorization → ok/broken only.
                "tokenState": connections.token_state(account_status=ba["status"]),
                # Mirror-drift sentinel verdict (broker/mirror_check.py):
                # {ok, checkedAt, driftDollar, driftPct, consecutiveDrifts}
                # or null before the first post-deploy sync.
                "mirror": verdicts.get(broker_account_id),
            })
        return {"anyBroker": len(out) > 0, "accounts": out}
    finally:
        conn.close()


def status(user_id: str) -> dict[str, Any]:
    """Connection + per-account summary for the Settings panel. Never
    decrypts the secret (works even if the key is lost — surfaces 'broken')."""
    # Opportunistic freshness: a member looking at their journal during
    # trading hours with a stale (nightly) holdings snapshot triggers a
    # budgeted SnapTrade re-pull. Fire-and-forget; never blocks the response.
    try:
        from api.services.journal_two.broker import manual_refresh
        manual_refresh.maybe_refresh_user_background(user_id)
    except Exception:
        pass
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT consent_at FROM j2_broker_users WHERE user_id = ?", (user_id,)
        ).fetchone()
        connected = row is not None
        accounts = connections.list_broker_accounts(user_id, conn=conn)
        # Pin `warming` into the status contract explicitly so the Settings
        # panel sees the post-connect warming flag even if the connections
        # dict shape ever changes.
        # Also carry the linked j2 account's display name (user-renamable —
        # the "nickname" for this broker account) so the panel can show and
        # edit it in place.
        names = {
            r["id"]: r["name"]
            for r in conn.execute(
                "SELECT id, name FROM j2_accounts WHERE user_id = ?", (user_id,)
            ).fetchall()
        }
        for ba in accounts:
            ba["warming"] = ba.get("warming", False)
            ba["accountName"] = names.get(ba.get("j2AccountId"))
        dup_pending = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_dup_flags "
            "WHERE user_id = ? AND status = 'pending'",
            (user_id,),
        ).fetchone()["n"]
        # Per-broker operational health (cache-only; refreshes in background).
        # Lets the UI say "Webull data is degraded right now" instead of the
        # member blaming the journal.
        broker_health: list[dict[str, Any]] = []
        try:
            from api.services.journal_two.broker import partner_health
            broker_health = partner_health.degraded_connected_brokers_cached(accounts)
        except Exception:
            pass
        return {
            "connected": connected,
            "consentAt": row["consent_at"] if row else None,
            "accounts": accounts,
            "dupFlagsPending": dup_pending,
            "snaptradeConfigured": snap.is_configured(),
            "brokerHealth": broker_health,
        }
    finally:
        conn.close()
