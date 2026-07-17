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
import random
import sqlite3
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Any

from api.services.auth_db import get_connection
from api.services import crypto_box
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import (
    connections, snaptrade_client as snap, activities_store, reconstruct, balances, dedup,
    notifications,
)

# Per-account async locks (process-local). Prevents on-open + scheduled +
# webhook syncs from double-processing the same account concurrently.
_locks: dict[str, asyncio.Lock] = {}

# How far before the cursor to re-pull on an incremental sync, to catch
# late-posted same-day activities. Dedup makes the overlap harmless.
_OVERLAP_DAYS = 3
_PAGE = 1000
_MAX_PAGES = 1000  # safety cap (≈1M activities)

WARMING_WINDOW_HOURS = 2
WARMING_STABLE_TICKS = 2  # consecutive no-growth ticks before warming stops

# Backoff delays (seconds) after a transient SQLite "database is locked" —
# auth.db write contention on the single web pod (prod 2026-07-13/15: one
# member's scheduled syncs failed every cycle with no retry). _do_sync is
# idempotent (stable external_ids), so re-running it whole is safe. Each
# delay is JITTERED ×[0.5, 1.5] at sleep time so parallel retriers don't
# re-collide in lockstep, and the tail is patient enough to outlast a big
# concurrent backfill (prod 2026-07-16: multi-member bursts exhausted a
# ~4s budget).
_LOCKED_RETRY_DELAYS = (1.0, 3.0, 8.0)


class BrokerAccountNotFound(Exception):
    pass


def _lock_for(broker_account_id: str) -> asyncio.Lock:
    # setdefault is atomic (no await in between) → no lazy-create TOCTOU race
    # that could hand two coroutines distinct locks for the same account.
    return _locks.setdefault(broker_account_id, asyncio.Lock())


def release_lock(broker_account_id: str) -> None:
    """Drop a per-account lock (call on disconnect/delete) to bound _locks growth."""
    _locks.pop(broker_account_id, None)


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


def _within_cooldown(ba: dict, cooldown_seconds: float) -> bool:
    """True if this account was synced within the cooldown window."""
    if cooldown_seconds <= 0 or not ba.get("lastSyncAt"):
        return False
    try:
        last = datetime.fromisoformat(str(ba["lastSyncAt"]).replace("Z", "+00:00"))
    except ValueError:
        return False
    return (datetime.now(timezone.utc) - last).total_seconds() < cooldown_seconds


async def sync_account(user_id: str, broker_account_id: str, *,
                       full: bool = False, cooldown_seconds: float = 0.0) -> dict[str, Any]:
    """Sync one account. Serialized per account via an asyncio lock. When
    `cooldown_seconds` is set and the account synced that recently, skip the
    live pull and return the cached state (debounces on-open/repeated /sync)."""
    if cooldown_seconds and not full:
        ba = connections.get_broker_account(user_id, broker_account_id)
        if ba and _within_cooldown(ba, cooldown_seconds):
            return {"skipped": "cooldown", "lastSyncAt": ba.get("lastSyncAt")}
    async with _lock_for(broker_account_id):
        attempts = 1 + len(_LOCKED_RETRY_DELAYS)
        for attempt in range(attempts):
            try:
                return await _do_sync(user_id, broker_account_id, full=full)
            except sqlite3.OperationalError as e:
                if "locked" not in str(e).lower() or attempt == attempts - 1:
                    raise
                await asyncio.sleep(_LOCKED_RETRY_DELAYS[attempt] * random.uniform(0.5, 1.5))
        raise RuntimeError("unreachable")  # loop always returns or raises


async def sync_all_for_user(user_id: str, *, full: bool = False,
                            cooldown_seconds: float = 0.0) -> dict[str, Any]:
    """Sync every sync-enabled account for a user. One failing account never
    blocks the others. Returns per-account results keyed by broker_account_id."""
    results: dict[str, Any] = {}
    for ba in connections.list_broker_accounts(user_id):
        if not ba["syncEnabled"]:
            results[ba["id"]] = {"skipped": True, "reason": "sync disabled"}
            continue
        try:
            results[ba["id"]] = await sync_account(
                user_id, ba["id"], full=full, cooldown_seconds=cooldown_seconds)
        except Exception as e:  # noqa: BLE001 — isolate per-account failures
            results[ba["id"]] = {"error": str(e)}
    return results


def _default_interval_min() -> int:
    """Scheduled-sync cadence. SnapTrade's launch guide caps BACKGROUND
    polling at 4 holdings calls/day/user and ONE activities call per account
    per 24h — the old 20-minute loop made ~72/day of each. Default mode
    'daily' schedules each account once per 24h (the 20-min scheduler tick
    just filters for due accounts, so syncs stay naturally spread across the
    day by connect time); intraday freshness comes from webhooks, on-login
    manual refresh, and the Recent Orders poll instead. BROKER_SYNC_MODE=
    legacy restores the old cadence; explicit BROKER_SYNC_INTERVAL_MIN wins
    over either mode."""
    import os
    explicit = os.getenv("BROKER_SYNC_INTERVAL_MIN")
    if explicit:
        return int(explicit)
    mode = (os.getenv("BROKER_SYNC_MODE") or "daily").strip().lower()
    return 20 if mode == "legacy" else 1440


async def sync_due_accounts(
    *, interval_minutes: int | None = None, concurrency: int | None = None
) -> dict[str, Any]:
    """Scheduler entry: sync every account whose last sync is older than the
    interval, across all users, with bounded concurrency. One failing account
    never blocks the others (isolated per-account)."""
    import os
    interval = (interval_minutes if interval_minutes is not None
                else _default_interval_min())
    # Default SERIAL: auth.db is single-writer SQLite, so concurrent account
    # syncs contend with EACH OTHER on every write ("database is locked"
    # bursts across members, prod 2026-07-16). Parallelism only ever sped up
    # the network fetches — not worth the lock storms at this member count.
    conc = concurrency if concurrency is not None else int(
        os.getenv("BROKER_SYNC_CONCURRENCY", "1"))
    due = connections.list_due_accounts(interval)
    # Downgrade-pause: only sync accounts whose user is still paid (or admin).
    # A user who downgrades simply stops being background-synced — no Stripe
    # hook needed. Plan is checked once per user.
    paid_cache: dict[str, bool] = {}
    due = [a for a in due if _user_is_paid(a["userId"], paid_cache)]
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


def _user_is_paid(user_id: str, cache: dict[str, bool]) -> bool:
    if user_id in cache:
        return cache[user_id]
    allowed = False
    try:
        from api.services.auth_service import get_user_plan
        from api.middleware.auth_middleware import PAID_PLANS
        plan = get_user_plan(user_id)
        if plan in PAID_PLANS or plan == "comped":
            allowed = True
        else:
            from api.services.auth_db import get_connection as _gc
            conn = _gc()
            try:
                row = conn.execute(
                    "SELECT role, created_at FROM users WHERE id = ?", (user_id,)
                ).fetchone()
                if row and row["role"] == "admin":
                    allowed = True
                elif row:
                    # P0 whole-branch fix: the trial grants broker sync via
                    # require_plan, so the BACKGROUND auto-sync must agree — else a
                    # trial user connects a broker and new fills silently never
                    # auto-appear for their entire conversion window. The trial
                    # helper fails closed (any error -> False, trial only ever
                    # restricts to <14d accounts).
                    from api.services.trial import is_account_in_trial
                    allowed = is_account_in_trial({"created_at": row["created_at"]})
            finally:
                conn.close()
    except Exception:
        allowed = False
    cache[user_id] = allowed
    return allowed


def run_due_sync_blocking(*, market_hours_only: bool = True) -> None:
    """Synchronous wrapper for the BackgroundScheduler (runs in a worker thread
    with no event loop). By default only runs inside the active market-data
    window (weekday ~4am-8pm ET) so we don't burn SnapTrade calls overnight /
    on weekends for no fresh data. Never raises into the scheduler."""
    import logging
    log = logging.getLogger("broker_sync")
    if market_hours_only:
        try:
            from api.services.data_sync import in_active_data_window
            if not in_active_data_window():
                return
        except Exception:
            pass  # if the window check is unavailable, fall through and sync
    try:
        asyncio.run(sync_due_accounts())
    except Exception as e:  # noqa: BLE001
        log.warning("scheduled broker sync failed: %s", e)


def run_nightly_reconcile_blocking() -> None:
    """Nightly safety net: full reconcile of every connected account (catches
    corrections/voids outside the incremental window). Bypasses market-hours +
    cooldown via full=True. Never raises into the scheduler."""
    import logging
    try:
        asyncio.run(_nightly_reconcile())
    except Exception as e:  # noqa: BLE001
        logging.getLogger("broker_sync").warning("nightly broker reconcile failed: %s", e)


async def _nightly_reconcile() -> dict[str, Any]:
    paid_cache: dict[str, bool] = {}
    accts = [a for a in connections.list_due_accounts(0)  # interval 0 = all active
             if _user_is_paid(a["userId"], paid_cache)]
    conc = int(__import__("os").getenv("BROKER_SYNC_CONCURRENCY", "4"))
    sem = asyncio.Semaphore(max(1, conc))

    async def _one(a):
        async with sem:
            try:
                return await sync_account(a["userId"], a["id"], full=True)
            except Exception as e:  # noqa: BLE001
                return {"error": str(e)}
    results = await asyncio.gather(*(_one(a) for a in accts)) if accts else []
    return {"reconciled": len(results)}


def _activity_count(user_id: str, broker_account_id: str) -> int:
    """Number of raw activities currently stored for this account."""
    try:
        return len(activities_store.get_activities(user_id, broker_account_id))
    except Exception:  # noqa: BLE001 — count is advisory; treat failure as 'unchanged'
        return -1


async def _warming_sync() -> dict[str, Any]:
    """One warming pass: full-sync every account still inside its warming window,
    advancing/clearing the stable-tick state. Late SnapTrade backfill that lands
    older than the incremental overlap window is caught here (full=True ignores
    the cursor). Clears warming after WARMING_STABLE_TICKS no-growth ticks."""
    now_iso = _now_iso()
    accts = connections.list_warming_accounts(now_iso)
    if not accts:
        return {"warming": 0}
    paid_cache: dict[str, bool] = {}
    cleared = 0
    for a in accts:
        if not _user_is_paid(a["userId"], paid_cache):
            connections.clear_warming(a["userId"], a["id"])
            cleared += 1
            continue
        try:
            await sync_account(a["userId"], a["id"], full=True)
        except Exception:  # noqa: BLE001 — one bad account never blocks the rest
            pass
        # Deterministic done-signal: SnapTrade's own sync_status flag
        # (captured during the sync above) says the initial transaction
        # backfill finished — no need to wait out stable-tick guesswork.
        try:
            refreshed = connections.get_broker_account(a["userId"], a["id"])
        except Exception:  # noqa: BLE001
            refreshed = None
        if refreshed and refreshed.get("txInitialSyncCompleted"):
            connections.clear_warming(a["userId"], a["id"])
            cleared += 1
            continue
        count = _activity_count(a["userId"], a["id"])
        prev = a.get("warmingLastActivityCount")
        ticks = int(a.get("warmingStableTicks") or 0)
        if prev is not None and count == prev:
            ticks += 1
        else:
            ticks = 0
        if ticks >= WARMING_STABLE_TICKS:
            connections.clear_warming(a["userId"], a["id"])
            cleared += 1
        else:
            connections.bump_warming_state(
                a["userId"], a["id"], activity_count=count, stable_ticks=ticks)
    return {"warming": len(accts), "cleared": cleared}


def run_warming_sync_blocking() -> None:
    """APScheduler entry for the warming loop. NOT market-hours gated (SnapTrade
    backfill lands any time after connect). Never raises into the scheduler."""
    import logging
    try:
        asyncio.run(_warming_sync())
    except Exception as e:  # noqa: BLE001
        logging.getLogger("broker_sync").warning("warming sync failed: %s", e)


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
            notifications.connection_broken(user_id, ba, "encryption key unavailable",
                                            prior_status=ba["status"])
            raise
        if bu is None:
            connections.record_sync_result(user_id, broker_account_id, ok=False, error="no broker identity")
            raise BrokerAccountNotFound(broker_account_id)

        start_date = _cursor_to_start_date(ba["activitiesCursor"], full=full)

        try:
            raw = await _fetch_all_activities(
                bu["snaptradeUserId"], bu["userSecret"], ba["snaptradeAccountId"], start_date
            )
        except snap.SnapUserSecretInvalid as e:
            connections.set_status(user_id, broker_account_id, "broken",
                                   error="SnapTrade user secret invalid — reconnect required")
            connections.record_sync_result(user_id, broker_account_id, ok=False,
                                            error="user secret invalid")
            notifications.connection_broken(user_id, ba, str(e),
                                            prior_status=ba["status"])
            raise
        except snap.SnapAuthError as e:
            # Generic 401/403 (no secret-invalid code in the body — prod
            # 2026-07-14 shape). Still user-actionable: mark broken so the UI
            # shows "Reconnect needed" (connect auto-recovers by re-registering).
            # A later successful sync flips status back to active, so even a
            # transient partner-wide auth blip self-heals.
            connections.set_status(user_id, broker_account_id, "broken",
                                   error=f"SnapTrade rejected this connection — reconnect required ({e})")
            connections.record_sync_result(user_id, broker_account_id, ok=False, error=str(e))
            notifications.connection_broken(user_id, ba, str(e),
                                            prior_status=ba["status"])
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

        # Cash-flow ledger: deposits/withdrawals/dividends/interest/fees from the
        # same (ledger-healed) activity history. Powers deposit-adjusted
        # performance. Best-effort — must never fail the core sync.
        try:
            from api.services.journal_two.broker import snaptrade_adapter as _adapter
            from api.services.journal_two.broker import cashflow_reconstruct as _cf
            from api.services.journal_two.broker import historical_equity as _he
            _part = _adapter.partition(all_acts)
            _cf.reconcile_cash_flows(user_id, ba, _part["cash"] + _part["transfers"])
            _he.invalidate_cache(user_id)  # fresh holdings/cash → recompute curve
        except Exception:
            pass  # best-effort; never break the core sync

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
            # Options are a separate endpoint (the positions endpoint is equities
            # only); needed so net-liq equity includes option market value.
            try:
                raw_option_holdings = await snap.get_option_holdings(
                    bu["snaptradeUserId"], bu["userSecret"], ba["snaptradeAccountId"]
                )
            except Exception:
                # Best-effort enrichment for equity MV — never let it break the
                # core sync (unsupported broker, SDK shape drift, network, etc.).
                raw_option_holdings = []
            pos_res = balances.reconcile_positions(
                user_id, ba, raw_positions, recon["openPositions"]
            )
            # Prefer the broker's OWN reported account total (mirrors the user's
            # app exactly) over our derived cash+MV. Best-effort: one extra
            # accounts call; fall back to derived if absent.
            broker_total = None
            try:
                accts = await snap.list_accounts(bu["snaptradeUserId"], bu["userSecret"])
                match = next((a for a in (accts or [])
                              if a.get("id") == ba["snaptradeAccountId"]), None)
                if match:
                    broker_total = balances._account_total_usd(match)
                    # Freshness bookkeeping: the broker-reported holdings
                    # snapshot time ("positions as of"), the authorization id
                    # (needed to request a manual refresh), and the
                    # transactions sync-status trio (deterministic backfill
                    # completeness). Best-effort.
                    try:
                        ss = match.get("sync_status") or {}
                        hs = (ss.get("holdings") or {}).get("last_successful_sync")
                        tx = ss.get("transactions") or {}
                        auth_id = match.get("brokerage_authorization")
                        tx_done = tx.get("initial_sync_completed")
                        connections.record_holdings_meta(
                            user_id, broker_account_id,
                            holdings_synced_at=str(hs) if hs else None,
                            authorization_id=str(auth_id) if auth_id else None,
                            tx_initial_sync_completed=(bool(tx_done)
                                                       if tx_done is not None else None),
                            tx_last_successful_sync=(str(tx["last_successful_sync"])
                                                     if tx.get("last_successful_sync") else None),
                            first_transaction_date=(str(tx["first_transaction_date"])
                                                    if tx.get("first_transaction_date") else None),
                        )
                    except Exception:
                        pass
            except Exception:
                broker_total = None
            bal_res = balances.write_balances(
                user_id, ba, raw_balances, raw_positions,
                raw_option_holdings=raw_option_holdings, broker_total=broker_total,
            )
            # Holdings-as-truth for OPEN options: guarantee held contracts show
            # (even without backfilled activity) + refresh each open strategy's
            # current mark so the UI can show Current + P&L like equities.
            try:
                from api.services.journal_two.broker import option_reconstruct as _optr
                _optr.reconcile_option_holdings(user_id, ba, raw_option_holdings)
            except Exception:
                pass  # best-effort; never break the core sync
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
        # Owner-only repeated-failure ping for NON-auth failures (auth paths
        # above already fired connection_broken; member is never emailed for
        # transient failures). Reads the log row just written above.
        if not isinstance(e, (snap.SnapAuthError, crypto_box.CryptoBoxError)):
            notifications.sync_failed(user_id, ba, str(e))
        raise
