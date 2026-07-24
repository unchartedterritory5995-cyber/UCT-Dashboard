"""Broker Sync HTTP router — `/api/j2/broker/*`.

Thin layer over `journal_two.broker.service`. Connect/refresh/disconnect
are gated to paid plans (SnapTrade has a per-connected-user cost); status
is readable by any logged-in user so the UI can show the upsell + the
"not configured" state.

Kept in its own router file (rather than the 150-endpoint journal_two.py)
to isolate the feature and minimize merge surface.
"""

from __future__ import annotations

import asyncio
import hmac
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user,
    require_plan,
    require_admin,
    PAID_PLANS,
)
from api.services import crypto_box
from api.services.journal_two.broker import service as broker_service
from api.services.journal_two.broker import snaptrade_client as snap
from api.services.journal_two.broker import connections as broker_conns

router = APIRouter(prefix="/api/j2/broker", tags=["broker-sync"])

# Paid-plan gate (admins pass via require_plan → get_user_plan returns role-aware).
_paid = require_plan(list(PAID_PLANS))


class ConnectBody(BaseModel):
    consent: bool = False
    customRedirect: str | None = None
    reconnect: str | None = None


class AccountPatch(BaseModel):
    syncEnabled: bool | None = None


class DisconnectBody(BaseModel):
    purgeTrades: bool = False


def _begin_warming(user_id: str) -> None:
    """Mark every connected account 'warming' so the warming scheduler runs
    short full re-syncs until SnapTrade's async backfill settles."""
    from datetime import datetime, timezone, timedelta
    from api.services.journal_two.broker import connections, sync as _sync
    until = (datetime.now(timezone.utc)
             + timedelta(hours=_sync.WARMING_WINDOW_HOURS)).isoformat()
    for ba in connections.list_broker_accounts(user_id):
        try:
            connections.set_warming(user_id, ba["id"], until)
        except Exception:  # noqa: BLE001 — warming is best-effort
            pass


def _guard_configured() -> None:
    if not snap.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Brokerage sync is not configured on this server.",
        )


@router.get("/status")
def get_status(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Connection + per-account summary. Any logged-in user (so the upsell
    and 'not configured' states can render)."""
    return broker_service.status(user["id"])


@router.get("/sync-log")
def sync_log(
    account_id: str | None = None, limit: int = 50,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Sync Trust Center: the caller's own sync-audit-log rows (newest first),
    optionally filtered to one broker account. Read-only. Any logged-in user
    (empty list if not broker-connected)."""
    return {"rows": broker_service.sync_log(
        user["id"], account_id=account_id, limit=limit)}


@router.get("/trust")
def trust(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Sync Trust Center summary: per broker account, health + imported-vs-
    broker counts + token state. Read-only. Any logged-in user (anyBroker=
    false + empty list if not broker-connected)."""
    from api.services.journal_two.broker import sync as broker_sync_engine
    summary = broker_service.trust_summary(user["id"])
    # Real background cadence (derived from config) so the UI chip can't drift
    # from reality the way the hardcoded "auto every 20m" did.
    summary["syncCadence"] = broker_sync_engine.sync_cadence_label()
    return summary


@router.post("/connect")
async def connect(body: ConnectBody, user: dict = Depends(_paid)) -> dict[str, Any]:
    """Register the SnapTrade identity (first time) + return the
    Connection-Portal URL. Requires explicit consent."""
    _guard_configured()
    if not body.consent:
        raise HTTPException(status_code=400, detail="Consent is required to connect a brokerage.")
    try:
        return await broker_service.connect(
            user["id"],
            custom_redirect=body.customRedirect,
            reconnect=body.reconnect,
        )
    except snap.SnapNotConfigured:
        raise HTTPException(status_code=503, detail="Brokerage sync is not configured.")
    except snap.SnapRateLimited:
        raise HTTPException(status_code=429, detail="Brokerage service busy — try again shortly.")
    except snap.SnapAuthError:
        raise HTTPException(status_code=502, detail="Brokerage service rejected the request.")
    except snap.SnapTransient:
        raise HTTPException(status_code=503, detail="Brokerage service temporarily unavailable.")


@router.post("/accounts/refresh")
async def refresh_accounts(user: dict = Depends(_paid)) -> dict[str, Any]:
    """After the portal returns, list + map the user's brokerage accounts."""
    _guard_configured()
    try:
        accounts = await broker_service.refresh_accounts(user["id"])
        _begin_warming(user["id"])
        return {"accounts": accounts}
    except broker_service.NoBrokerConnection:
        raise HTTPException(status_code=409, detail="No brokerage connection. Connect first.")
    except snap.SnapUserSecretInvalid:
        raise HTTPException(status_code=409, detail="Connection expired — please reconnect.")
    except snap.SnapRateLimited:
        raise HTTPException(status_code=429, detail="Brokerage service busy — try again shortly.")
    except snap.SnapTransient:
        raise HTTPException(status_code=503, detail="Brokerage service temporarily unavailable.")


@router.post("/fills/check")
async def fills_check(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Instant on-open fills check: polls the member's Recent Orders NOW
    (shared 5-min per-account budget with the scheduler) so a trade they
    just placed shows in the journal in seconds. Returns {newFills} — the
    client refreshes its positions/trades views when > 0. Cheap no-op when
    the budget was spent recently or the market is closed."""
    from api.services.journal_two.broker import recent_orders
    return await recent_orders.check_user_now(user["id"])


@router.post("/sync")
async def sync_now(
    user: dict = Depends(_paid), full: bool = False, force: bool = False,
    background: bool = False,
) -> dict[str, Any]:
    """On-demand sync of the user's connected accounts. Applies a per-account
    cooldown (BROKER_SYNC_COOLDOWN_SEC, default 180s) so opening the journal /
    repeated clicks don't hammer SnapTrade — pass force=1 to bypass, full=1 for
    a full historical backfill (used on first connect).

    background=1 fires the sync as a detached task and returns immediately — used
    by the auto-sync-on-journal-open so that request (which awaits a multi-second
    SnapTrade round-trip) doesn't hold a worker for its whole duration. At ~200
    concurrent journal opens the blocking version would tie up the shared
    threadpool; the UI already shows the last-synced data and picks up fresh data
    on its next poll. Explicit 'Sync now' buttons stay blocking (they want the
    result)."""
    _guard_configured()
    from api.services.journal_two.broker import sync as broker_sync_engine
    cooldown = 0.0 if (force or full) else float(os.getenv("BROKER_SYNC_COOLDOWN_SEC", "180"))

    if background:
        uid = user["id"]

        async def _bg():
            try:
                await broker_sync_engine.sync_all_for_user(
                    uid, full=full, cooldown_seconds=cooldown)
            except Exception:
                import logging
                logging.getLogger(__name__).exception("[broker] background sync failed")

        asyncio.create_task(_bg())
        return {"status": "started", "background": True}

    results = await broker_sync_engine.sync_all_for_user(
        user["id"], full=full, cooldown_seconds=cooldown)
    return {"results": results}


@router.put("/accounts/{broker_account_id}")
def update_account(
    broker_account_id: str,
    patch: AccountPatch,
    user: dict = Depends(_paid),
) -> dict[str, Any]:
    """Enable/disable sync for a connected account."""
    if patch.syncEnabled is None:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    ok = broker_conns.set_sync_enabled(user["id"], broker_account_id, patch.syncEnabled)
    if not ok:
        raise HTTPException(status_code=404, detail="Account not found.")
    return broker_conns.get_broker_account(user["id"], broker_account_id)


class DupResolveBody(BaseModel):
    action: str  # 'merge' | 'dismiss'


@router.get("/admin/user-debug")
async def admin_user_debug(user_id: str, user: dict = Depends(require_admin)) -> dict[str, Any]:
    """Per-member broker triage bundle: our DB state (identity, accounts,
    recent syncs) + live SnapTrade probes (registered? authorizations incl.
    the disabled flag, live account count). Answers 'member says connect
    isn't working' in one call."""
    return await broker_service.admin_user_debug(user_id)


@router.post("/admin/reset-partner-auth-broken")
async def admin_reset_partner_auth_broken(
    request: Request, resync: bool = True, dry_run: bool = False,
) -> dict[str, Any]:
    """Repair connections marked broken by a PARTNER-side auth failure.

    When our own SnapTrade credentials are rejected, every member connection
    fails at once and `sync` marks each one status='broken' — and because
    `list_due_accounts` AND `sync_all_for_user` both EXCLUDE broken accounts,
    nothing ever retries. Fixing the root cause does NOT bring them back; the
    rows must be reset. That is exactly what stranded all 11 connections on
    2026-07-23 (snaptrade-python-sdk 12.0.0 silently dropped our credentials).

    NARROW BY CONSTRUCTION: only rows whose `last_error` carries a
    partner-auth signature are touched, so a genuinely broken connection
    (invalid user secret, revoked authorization) is never wrongly resurrected
    into a sync loop. `dry_run=1` reports the split without writing.

    Gated by the PUSH_SECRET bearer (mirrors /api/desk/sessions-status) so it
    can be driven from an ops shell without a browser session.
    """
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(auth, f"Bearer {expected}"):
        raise HTTPException(status_code=401, detail="unauthorized")

    from api.services.journal_two.broker import connections as _conns
    result = _conns.reset_partner_auth_broken(dry_run=dry_run)
    if resync and not dry_run and result["reset"]:
        from api.services.journal_two.broker import sync as _sync
        result["resync"] = await _sync.sync_due_accounts(interval_minutes=0)
    return result


@router.get("/admin/fidelity-audit")
async def admin_fidelity_audit(user_id: str, raw: bool = False,
                               user: dict = Depends(require_admin)) -> dict[str, Any]:
    """On-demand fidelity audit for one member: does their imported journal
    reconcile against the broker's own reported numbers? (Also runs nightly
    across the fleet with Discord digest on divergence.) raw=1 includes the
    exact broker payloads for field-level diagnosis of a divergence."""
    from api.services.journal_two.broker import fidelity_audit
    return {"results": await fidelity_audit.audit_user(user_id, include_raw=raw)}


@router.get("/admin/stats")
def admin_stats(user: dict = Depends(require_admin)) -> dict[str, Any]:
    """Connected-user count + cost estimate ($1.50/connected user/mo SnapTrade)
    + broken connections + recent sync errors. For cost monitoring."""
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        users = conn.execute("SELECT COUNT(*) AS n FROM j2_broker_users").fetchone()["n"]
        accts = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_accounts WHERE sync_enabled = 1"
        ).fetchone()["n"]
        broken = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_accounts WHERE status = 'broken'"
        ).fetchone()["n"]
        errs = conn.execute(
            "SELECT user_id, broker_account_id, error, started_at FROM j2_broker_sync_log "
            "WHERE status = 'error' ORDER BY started_at DESC LIMIT 20"
        ).fetchall()
        recent_errors = [
            {"userId": r["user_id"], "brokerAccountId": r["broker_account_id"],
             "error": r["error"], "at": r["started_at"]} for r in errs
        ]
        # Billed manual refreshes today (ET day) — the only per-call spend.
        from datetime import datetime as _dt
        from zoneinfo import ZoneInfo as _ZI
        et_midnight_utc = (_dt.now(_ZI("America/New_York"))
                           .replace(hour=0, minute=0, second=0, microsecond=0)
                           .astimezone(_ZI("UTC")).isoformat())
        refreshes_today = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_accounts "
            "WHERE last_manual_refresh_at >= ?", (et_midnight_utc,)
        ).fetchone()["n"]
    finally:
        conn.close()
    # PAYG Daily pricing (verified 7/17): 5 free connected users, then
    # $1/user/mo; manual refresh ~$0.05/call. Refresh run-rate extrapolates
    # today's count × 21 trading days.
    billable_users = max(0, users - 5)
    est_monthly = round(billable_users * 1.0 + refreshes_today * 0.05 * 21, 2)
    return {
        "connectedUsers": users,
        "syncEnabledAccounts": accts,
        "brokenAccounts": broken,
        "manualRefreshesToday": refreshes_today,
        "estMonthlyCostUsd": est_monthly,
        "recentErrors": recent_errors,
    }


@router.get("/equity-curve")
def equity_curve(
    days: int = 365, user: dict = Depends(get_current_user)
) -> dict[str, Any]:
    """Daily real broker net-liquidation equity (cash + equity MV + option MV),
    aggregated across the user's connected accounts. Powers the account growth
    chart. Any logged-in user (empty list if not broker-connected)."""
    from api.services.auth_db import get_connection
    days = max(1, min(int(days or 365), 1830))
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT snapshot_date AS date,
                   ROUND(SUM(total_equity), 2) AS equity,
                   ROUND(SUM(cash), 2) AS cash,
                   ROUND(SUM(market_value), 2) AS marketValue
            FROM j2_broker_equity_snapshots
            WHERE user_id = ?
            GROUP BY snapshot_date
            ORDER BY snapshot_date DESC
            LIMIT ?
            """,
            (user["id"], days),
        ).fetchall()
    finally:
        conn.close()
    points = [dict(r) for r in rows][::-1]  # chronological
    return {"points": points}


def _default_broker_account_j2id(user_id: str) -> str | None:
    """The user's first broker-linked j2 account id — lets /performance &c. be
    called without hunting for an account id."""
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT j2_account_id FROM j2_broker_accounts WHERE user_id=? "
            "ORDER BY created_at ASC LIMIT 1", (user_id,)).fetchone()
        return row["j2_account_id"] if row else None
    finally:
        conn.close()


@router.get("/performance")
def performance(
    accountId: str | None = None, period: str = "ALL",
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Accurate equity curve from real broker balances. With no accountId, this
    is the PORTFOLIO across ALL connected brokers (sum of each broker's reported
    daily net-liq). With an accountId, just that account."""
    from api.services.journal_two.broker import performance_service
    if accountId:
        return performance_service.account_performance(user["id"], accountId, period)
    return performance_service.portfolio_performance(user["id"], period)


@router.get("/performance-debug")
def performance_debug(
    accountId: str | None = None, user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Diagnostic dump of the reconstruction internals (current holdings, every
    event, the daily series) for debugging wrong historical values."""
    from api.services.journal_two.broker import historical_equity
    acct = accountId or _default_broker_account_j2id(user["id"])
    if not acct:
        return {"error": "no broker account"}
    return historical_equity.debug_bundle(user["id"], acct)


@router.get("/cash-flows")
def cash_flows(
    accountId: str | None = None, period: str = "ALL",
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """The account's secondary transactions — deposits, withdrawals, dividends,
    interest, fees — for the window. Scoped to the caller; accountId defaults to
    their first broker account."""
    from api.services.journal_two.broker import performance_service, cashflow_store
    acct = accountId or _default_broker_account_j2id(user["id"])
    if not acct:
        return {"flows": []}
    start = performance_service._period_start(period)
    return {"flows": cashflow_store.list_flows(user["id"], acct, start=start)}


@router.get("/unreviewed")
def unreviewed_imports(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """How many ACTIONABLE broker-imported items still need journaling (a setup
    tag): current open positions + trades closed in the last 14 days. Scoped to
    recent/active so the nudge stays meaningful (not 'tag 200 years of history').
    Drives the 'N imported items need a setup' nudge."""
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        try:
            trades = conn.execute(
                "SELECT COUNT(*) AS n FROM j2_trades WHERE user_id = ? "
                "AND source = 'broker' AND (setup IS NULL OR setup = '') "
                "AND exit_date >= date('now', '-14 days')",
                (user["id"],),
            ).fetchone()["n"]
        except Exception:
            trades = 0
        positions = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_positions WHERE user_id = ? "
            "AND source = 'broker' AND closed_at IS NULL AND (setup IS NULL OR setup = '')",
            (user["id"],),
        ).fetchone()["n"]
    finally:
        conn.close()
    return {"trades": trades, "positions": positions, "total": trades + positions}


@router.get("/dup-flags")
def list_dup_flags(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Pending duplicate-candidate flags (manual vs broker) with both trade
    summaries for side-by-side review."""
    from api.services.journal_two.broker import dedup
    return {"flags": dedup.list_flags(user["id"])}


@router.post("/dup-flags/{flag_id}")
def resolve_dup_flag(
    flag_id: str, body: DupResolveBody, user: dict = Depends(_paid)
) -> dict[str, Any]:
    """Resolve a duplicate flag: 'merge' (keep broker trade, fold in manual
    notes, drop the manual row) or 'dismiss' (keep both)."""
    from api.services.journal_two.broker import dedup
    try:
        return dedup.resolve_flag(user["id"], flag_id, body.action)
    except dedup.DupFlagError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/connections")
async def disconnect(body: DisconnectBody, user: dict = Depends(_paid)) -> dict[str, Any]:
    """Disconnect: revoke at SnapTrade + purge credentials. Optionally also
    delete broker-imported trade data."""
    return await broker_service.disconnect(user["id"], purge_trades=body.purgeTrades)


# Webhook-driven syncs run through a bounded queue with a small worker pool
# (was: fire-and-forget task set that silently DROPPED events past 20
# in-flight — at 100+ accounts SnapTrade's nightly per-account webhook herd
# lands in one window and dropped events meant members quietly missing their
# overnight refresh until the daily sync). Queue full → degrade to delay via
# 429 (SnapTrade retries with backoff), never silent loss. One in-queue
# retry on sync failure.
_WEBHOOK_CONCURRENCY = int(os.getenv("BROKER_WEBHOOK_CONCURRENCY", "4"))
_WEBHOOK_QUEUE_MAX = int(os.getenv("BROKER_WEBHOOK_QUEUE_MAX", "500"))
_webhook_queue: "asyncio.Queue | None" = None
_webhook_workers: list = []
_webhook_stats = {"processed": 0, "retried": 0, "failed": 0}


def _reset_webhook_queue_for_tests() -> None:
    global _webhook_queue, _webhook_workers
    for w in _webhook_workers:
        w.cancel()
    _webhook_queue = None
    _webhook_workers = []
    _webhook_stats.update(processed=0, retried=0, failed=0)


def _ensure_webhook_workers() -> "asyncio.Queue":
    """Lazy-init the queue + workers on the running event loop (module import
    happens before uvicorn's loop exists)."""
    global _webhook_queue
    if _webhook_queue is not None:
        return _webhook_queue
    _webhook_queue = asyncio.Queue(maxsize=_WEBHOOK_QUEUE_MAX)
    for i in range(max(1, _WEBHOOK_CONCURRENCY)):
        _webhook_workers.append(asyncio.create_task(_webhook_worker(i)))
    return _webhook_queue


async def _webhook_worker(worker_id: int) -> None:
    import logging
    log = logging.getLogger("broker_webhook")
    while True:
        job = await _webhook_queue.get()
        user_id, refresh_first, attempt = job
        try:
            await broker_service_sync_all(user_id, refresh_first=refresh_first)
            _webhook_stats["processed"] += 1
        except Exception as e:  # noqa: BLE001
            if attempt < 1:
                _webhook_stats["retried"] += 1
                await asyncio.sleep(30)
                try:
                    _webhook_queue.put_nowait((user_id, refresh_first, attempt + 1))
                except asyncio.QueueFull:
                    _webhook_stats["failed"] += 1
            else:
                _webhook_stats["failed"] += 1
                log.warning("webhook sync failed twice for user %s: %s", user_id, e)
        finally:
            _webhook_queue.task_done()


@router.post("/webhook")
async def webhook(request: Request) -> dict[str, Any]:
    """SnapTrade webhook. Authenticated by the Signature header (HMAC-SHA256
    over the sorted-compact JSON payload with the consumer key, per docs)
    with the legacy body webhookSecret as fallback — NOT by user session.
    Data-changing events trigger a background sync for that user (this is
    the primary freshness path; scheduled polling is the fallback).
    Connection-lifecycle events update account status instantly."""
    from api.services.journal_two.broker import webhook_security
    consumer_key = os.getenv("SNAPTRADE_CONSUMER_KEY")
    legacy_secret = os.getenv("SNAPTRADE_WEBHOOK_SECRET")
    if not consumer_key and not legacy_secret:
        raise HTTPException(status_code=503, detail="Webhooks not configured.")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON.")
    accepted, _mode = webhook_security.verify(
        body, request.headers.get("Signature"),
        consumer_key=consumer_key, legacy_secret=legacy_secret,
    )
    if not accepted:
        raise HTTPException(status_code=401, detail="Bad webhook signature.")

    # We registered SnapTrade users keyed by our UCT user id, so userId == ours.
    uct_user_id = body.get("userId")
    event = str(body.get("eventType") or body.get("type") or "").upper()
    if not uct_user_id:
        return {"ok": True, "ignored": True}
    # Validate the user actually has a broker identity (don't act for
    # arbitrary/forged userIds).
    if not broker_conns.has_broker_user(str(uct_user_id)):
        return {"ok": True, "ignored": "unknown user"}

    # Connection-lifecycle events: instant status updates, no data sync needed
    # (except FIXED, which also falls through to a sync below).
    handled = _handle_lifecycle_event(str(uct_user_id), event, body)

    # Sync ONLY on known data-changing events (an empty/unknown event no longer
    # triggers a sync — narrows the abuse surface). TRADE_DETECTION fires
    # seconds after an external trade executes (per-account subscription via
    # SnapTrade support) — ready if/when subscribed.
    sync_events = {
        "CONNECTION_ADDED", "CONNECTION_UPDATED", "CONNECTION_FIXED",
        "ACCOUNT_HOLDINGS_UPDATED", "ACCOUNT_TRANSACTIONS_UPDATED",
        "ACCOUNT_TRANSACTIONS_INITIAL_UPDATE", "NEW_ACCOUNT_AVAILABLE",
        "TRADES_PLACED", "TRADE_DETECTION",
    }
    if event not in sync_events:
        return {"ok": True, "handled": handled} if handled else {"ok": True, "ignored": True}

    # New-connection events must IMPORT the accounts first — a portal flow can
    # complete without the member's browser ever running the client-side
    # import (Webull incident 2026-07-15); this server-side path is the
    # browser-independent safety net.
    refresh_first = event in _REFRESH_EVENTS
    queue = _ensure_webhook_workers()
    try:
        queue.put_nowait((str(uct_user_id), refresh_first, 0))
    except asyncio.QueueFull:
        # Backpressure: 429 makes SnapTrade redeliver with backoff — delay,
        # never silent loss.
        raise HTTPException(status_code=429, detail="Sync queue full; retry.")
    return {"ok": True, "scheduled": True}


def _handle_lifecycle_event(user_id: str, event: str, body: dict) -> str | None:
    """Instant account-status updates from connection-lifecycle webhooks.
    Local journal data is NEVER deleted here (mirror-fidelity: history stays
    even when the connection goes away at SnapTrade). Returns a short label
    when the event mutated state, else None. Never raises."""
    try:
        auth_id = str(body.get("brokerageAuthorizationId")
                      or body.get("authorizationId") or "")
        if event == "CONNECTION_BROKEN" and auth_id:
            from api.services.journal_two.broker import notifications
            for ba in broker_conns.list_accounts_by_authorization(user_id, auth_id):
                if ba["status"] != "broken":
                    broker_conns.set_status(
                        user_id, ba["id"], "broken",
                        error="SnapTrade reported the connection broken — reconnect required")
                    notifications.connection_broken(
                        user_id, ba, "webhook CONNECTION_BROKEN",
                        prior_status=ba["status"])
            return "connection_broken"
        if event == "CONNECTION_FIXED" and auth_id:
            for ba in broker_conns.list_accounts_by_authorization(user_id, auth_id):
                if ba["status"] == "broken":
                    broker_conns.set_status(user_id, ba["id"], "active")
            return "connection_fixed"
        if event in ("CONNECTION_DELETED", "USER_DELETED"):
            accounts = (broker_conns.list_accounts_by_authorization(user_id, auth_id)
                        if (event == "CONNECTION_DELETED" and auth_id)
                        else broker_conns.list_broker_accounts(user_id))
            for ba in accounts:
                broker_conns.set_status(
                    user_id, ba["id"], "disabled",
                    error=f"Connection removed at SnapTrade ({event})")
                broker_conns.set_sync_enabled(user_id, ba["id"], False)
            return event.lower()
        if event == "ACCOUNT_REMOVED":
            snap_acct = str(body.get("accountId") or "")
            ba = (broker_conns.get_account_by_snaptrade_id(user_id, snap_acct)
                  if snap_acct else None)
            if ba:
                broker_conns.set_status(
                    user_id, ba["id"], "disabled",
                    error="Account removed from the connection at SnapTrade")
                broker_conns.set_sync_enabled(user_id, ba["id"], False)
                return "account_removed"
    except Exception:
        import logging
        logging.getLogger("broker_webhook").exception(
            "lifecycle event handling failed (%s)", event)
    return None


# Events that mean "a new connection/account exists at SnapTrade" — these must
# map accounts into our DB before syncing, or the sync loops over nothing.
_REFRESH_EVENTS = {"CONNECTION_ADDED", "NEW_ACCOUNT_AVAILABLE"}


async def broker_service_sync_all(user_id: str, *, refresh_first: bool = False) -> Any:
    """Indirection so the webhook can trigger a full user sync without a
    top-level import cycle. With refresh_first, newly available brokerage
    accounts are imported (best-effort) and warming starts before the sync."""
    from api.services.journal_two.broker import sync as broker_sync_engine
    if refresh_first:
        try:
            await broker_service.refresh_accounts(user_id)
            _begin_warming(user_id)
        except Exception:
            pass  # best-effort — the sync below still covers known accounts
    return await broker_sync_engine.sync_all_for_user(user_id)
