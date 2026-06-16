"""Per-account broker sync pipeline.

sync_account():
  1. claim a per-account lock (on-open + scheduler + webhook may race)
  2. fetch activities — full backfill (no cursor) or incremental (from cursor
     minus an overlap window) — paginated
  3. store new activities in the raw ledger (deduped)
  4. reconstruct equity/short round-trips over the FULL ledger (idempotent)
  5. advance the cursor + record the sync result + write an audit log row

Balances/holdings reconciliation (Phase 3), the scheduler/webhooks (Phase 5),
and corrections heal (Phase 5) build on this.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Any

from api.services.auth_db import get_connection
from api.services import crypto_box
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import (
    connections, snaptrade_client as snap, activities_store, reconstruct, balances, dedup,
)

# Per-account async locks (process-local). Prevents on-open + scheduled +
# webhook syncs from double-processing the same account concurrently.
_locks: dict[str, asyncio.Lock] = {}

# How far before the cursor to re-pull on an incremental sync, to catch
# late-posted same-day activities. Dedup makes the overlap harmless.
_OVERLAP_DAYS = 3
_PAGE = 1000
_MAX_PAGES = 1000  # safety cap (≈1M activities)


class BrokerAccountNotFound(Exception):
    pass


def _lock_for(broker_account_id: str) -> asyncio.Lock:
    lock = _locks.get(broker_account_id)
    if lock is None:
        lock = asyncio.Lock()
        _locks[broker_account_id] = lock
    return lock


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cursor_to_start_date(cursor: str | None, *, full: bool) -> date | None:
    if full or not cursor:
        return None
    try:
        d = datetime.fromisoformat(cursor.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            d = date.fromisoformat(cursor[:10])
        except ValueError:
            return None
    return d - timedelta(days=_OVERLAP_DAYS)


async def _fetch_all_activities(snap_user_id: str, user_secret: str,
                                snap_account_id: str, start_date: date | None) -> list[dict]:
    """Paginate the activities endpoint until exhausted."""
    out: list[dict] = []
    offset = 0
    for _ in range(_MAX_PAGES):
        page = await snap.get_activities(
            snap_user_id, user_secret, snap_account_id,
            start_date=start_date, offset=offset, limit=_PAGE,
        )
        data = page.get("data") or []
        out.extend(data)
        if len(data) < _PAGE:
            break
        offset += _PAGE
    return out


def _start_log(user_id: str, broker_account_id: str) -> str:
    log_id = str(uuid.uuid4())
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_sync_log (id, user_id, broker_account_id, started_at) "
            "VALUES (?, ?, ?, ?)",
            (log_id, user_id, broker_account_id, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return log_id


def _finish_log(log_id: str, *, ok: bool, summary: dict | None = None, error: str | None = None) -> None:
    conn = get_connection()
    try:
        s = summary or {}
        conn.execute(
            """
            UPDATE j2_broker_sync_log
               SET finished_at = ?, status = ?, error = ?,
                   trades_imported = ?, positions_upserted = ?,
                   options_imported = ?
             WHERE id = ?
            """,
            (_now_iso(), "ok" if ok else "error", error,
             int(s.get("imported", 0)), int(s.get("positionsUpserted", 0)),
             int(s.get("optionsImported", 0)), log_id),
        )
        conn.commit()
    finally:
        conn.close()


async def sync_account(user_id: str, broker_account_id: str, *, full: bool = False) -> dict[str, Any]:
    """Sync one account. Serialized per account via an asyncio lock."""
    async with _lock_for(broker_account_id):
        return await _do_sync(user_id, broker_account_id, full=full)


async def sync_all_for_user(user_id: str, *, full: bool = False) -> dict[str, Any]:
    """Sync every sync-enabled account for a user. One failing account never
    blocks the others. Returns per-account results keyed by broker_account_id."""
    results: dict[str, Any] = {}
    for ba in connections.list_broker_accounts(user_id):
        if not ba["syncEnabled"]:
            results[ba["id"]] = {"skipped": True, "reason": "sync disabled"}
            continue
        try:
            results[ba["id"]] = await sync_account(user_id, ba["id"], full=full)
        except Exception as e:  # noqa: BLE001 — isolate per-account failures
            results[ba["id"]] = {"error": str(e)}
    return results


async def sync_due_accounts(
    *, interval_minutes: int | None = None, concurrency: int | None = None
) -> dict[str, Any]:
    """Scheduler entry: sync every account whose last sync is older than the
    interval, across all users, with bounded concurrency. One failing account
    never blocks the others (isolated per-account)."""
    import os
    interval = interval_minutes if interval_minutes is not None else int(
        os.getenv("BROKER_SYNC_INTERVAL_MIN", "20"))
    conc = concurrency if concurrency is not None else int(
        os.getenv("BROKER_SYNC_CONCURRENCY", "4"))
    due = connections.list_due_accounts(interval)
    sem = asyncio.Semaphore(max(1, conc))

    async def _one(acct: dict) -> Any:
        async with sem:
            try:
                return await sync_account(acct["userId"], acct["id"])
            except Exception as e:  # noqa: BLE001
                return {"error": str(e)}

    results = await asyncio.gather(*(_one(a) for a in due)) if due else []
    ok = sum(1 for r in results if isinstance(r, dict) and "error" not in r)
    return {"due": len(due), "synced": ok, "failed": len(results) - ok}


def run_due_sync_blocking() -> None:
    """Synchronous wrapper for the BackgroundScheduler (which runs jobs in a
    thread with no event loop). Never raises into the scheduler."""
    import logging
    try:
        asyncio.run(sync_due_accounts())
    except Exception as e:  # noqa: BLE001
        logging.getLogger("broker_sync").warning("scheduled broker sync failed: %s", e)


async def _do_sync(user_id: str, broker_account_id: str, *, full: bool) -> dict[str, Any]:
    ba = connections.get_broker_account(user_id, broker_account_id)
    if ba is None:
        raise BrokerAccountNotFound(broker_account_id)

    log_id = _start_log(user_id, broker_account_id)
    try:
        # Decrypt the user's SnapTrade secret. If the key is lost, mark broken.
        try:
            bu = connections.get_broker_user(user_id)
        except crypto_box.CryptoBoxError:
            connections.set_status(user_id, broker_account_id, "broken",
                                   error="Encryption key unavailable — reconnect required")
            connections.record_sync_result(user_id, broker_account_id, ok=False,
                                            error="encryption key unavailable")
            raise
        if bu is None:
            connections.record_sync_result(user_id, broker_account_id, ok=False, error="no broker identity")
            raise BrokerAccountNotFound(broker_account_id)

        start_date = _cursor_to_start_date(ba["activitiesCursor"], full=full)

        try:
            raw = await _fetch_all_activities(
                bu["snaptradeUserId"], bu["userSecret"], ba["snaptradeAccountId"], start_date
            )
        except snap.SnapUserSecretInvalid:
            connections.set_status(user_id, broker_account_id, "broken",
                                   error="SnapTrade user secret invalid — reconnect required")
            connections.record_sync_result(user_id, broker_account_id, ok=False,
                                            error="user secret invalid")
            raise
        except snap.SnapError as e:
            connections.record_sync_result(user_id, broker_account_id, ok=False, error=str(e))
            raise

        stored = activities_store.store_activities(user_id, broker_account_id, raw)

        # Corrections heal (ledger side): drop any ledger rows the broker no
        # longer returns within the re-fetched window (voided/amended). Bounded
        # to the window via `since` so we never delete un-refetched history.
        present_ids = {str(a["id"]) for a in raw if isinstance(a, dict) and a.get("id")}
        since = start_date.isoformat() if start_date is not None else None
        healed = activities_store.heal_window(
            user_id, broker_account_id, present_ids, since=since
        )

        # Reconstruct over the FULL (now-healed) ledger (FIFO needs complete
        # history). reconstruct_account also prunes broker trades/strategies
        # whose source activity is gone — the trade-side of the heal.
        all_acts = activities_store.get_activities(user_id, broker_account_id)
        settings = accounts_service.get_account_settings(user_id, ba["j2AccountId"])
        recon = reconstruct.reconstruct_account(
            user_id, broker_account_id, ba["j2AccountId"], all_acts, settings
        )

        # Holdings-as-truth: open positions + real balances from the broker's
        # CURRENT state. Best-effort — a balances hiccup must not fail the whole
        # sync (the trade import above already succeeded).
        pos_res: dict[str, Any] = {"upserted": 0}
        try:
            raw_positions = await snap.get_positions(
                bu["snaptradeUserId"], bu["userSecret"], ba["snaptradeAccountId"]
            )
            raw_balances = await snap.get_balances(
                bu["snaptradeUserId"], bu["userSecret"], ba["snaptradeAccountId"]
            )
            pos_res = balances.reconcile_positions(
                user_id, ba, raw_positions, recon["openPositions"]
            )
            bal_res = balances.write_balances(user_id, ba, raw_balances, raw_positions)
        except snap.SnapError:
            bal_res = None  # leave prior balances; surfaced via last_error if needed

        # Flag likely manual↔broker duplicate trades for user review (never
        # auto-deleted). Best-effort — must not fail the sync.
        try:
            dedup.scan_for_duplicates(user_id)
        except Exception:
            pass

        # Advance cursor to the newest activity we now hold.
        latest = activities_store.latest_occurred_at(user_id, broker_account_id)
        if latest:
            connections.update_cursor(user_id, broker_account_id, latest)
        if ba["status"] == "broken":
            connections.set_status(user_id, broker_account_id, "active")
        connections.record_sync_result(user_id, broker_account_id, ok=True)

        summary = {
            "fetched": len(raw),
            "newActivities": stored["new"],
            "imported": recon["imported"],
            "skipped": recon["skipped"],
            "positionsUpserted": pos_res.get("upserted", 0),
            "positionsClosed": pos_res.get("closed", 0),
            "optionsImported": recon.get("optionsImported", 0),
            "openPositions": recon["openPositions"],
            "optionEvents": recon["optionEvents"],
            "fifoErrors": recon["fifoErrors"],
        }
        _finish_log(log_id, ok=True, summary=summary)
        return summary
    except Exception as e:
        # Already recorded specific failures above; ensure the log closes.
        _finish_log(log_id, ok=False, error=str(e))
        raise
