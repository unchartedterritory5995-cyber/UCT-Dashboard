"""Broker fleet monitor — autonomous detection of stuck member connections.

Every member is a detector: instead of pre-testing 30+ brokerages (impossible
without real logins), this sweeps ALL live connections hourly for the exact
stuck states that stranded real members in the 2026-07-13/16 incidents, and
pings the OWNER's Discord (members are never contacted by this module):

  • stranded_connect — a broker identity exists but ZERO accounts imported
    (the Webull dead-end state) beyond a grace window;
  • stale_sync — a sync-enabled, active account of a paid member with no
    successful sync in 24h (the silent-death state);
  • still_broken — a connection sitting in status='broken' (the member is
    ignoring/never saw the reconnect email);
  • snaptrade_unreachable — the SnapTrade partner API is down or our key is
    invalid (heartbeat).

One Discord digest per distinct finding-set per ET day (in-process dedup —
worst case after a redeploy is one repeat digest). Read-only over auth.db.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services.auth_db import get_connection
from api.services.journal_two.broker import snaptrade_client as snap
from api.services.journal_two.broker.notifications import _post_discord as _notif_discord

logger = logging.getLogger("broker_fleet")

_STRANDED_GRACE_MIN = 15     # portal round-trips + webhook imports settle fast
_STALE_SYNC_HOURS = 24

# Known internal/test users the owner has told us to keep out of the digest.
# Extend at runtime via BROKER_FLEET_SUPPRESS (comma/space-separated user ids).
_DEFAULT_SUPPRESS = frozenset({
    # Bracco's old test connection (Robinhood ••8710) — owner call 2026-07-16
    "38c023cf-0e81-4187-aa43-ac51a751ae79",
})


def _suppressed_user_ids() -> frozenset[str]:
    import os
    extra = (os.getenv("BROKER_FLEET_SUPPRESS") or "").replace(",", " ").split()
    return _DEFAULT_SUPPRESS | frozenset(extra)

# ET-day of the last digest, keyed by a fingerprint of the finding set, so a
# persistent problem pings once per day instead of hourly.
_last_digest: dict[str, str] = {}


def _reset_dedup_for_tests() -> None:
    _last_digest.clear()


def _post_discord(title: str, description: str) -> None:  # patchable seam
    _notif_discord(title, description)


def _ops_line() -> str:
    """SnapTrade spend/usage footer for the digest — keeps cost drift visible
    long before the invoice does. Never raises."""
    try:
        conn = get_connection()
        try:
            users = conn.execute(
                "SELECT COUNT(DISTINCT user_id) AS n FROM j2_broker_users"
            ).fetchone()["n"]
            et_midnight_utc = (datetime.now(ZoneInfo("America/New_York"))
                               .replace(hour=0, minute=0, second=0, microsecond=0)
                               .astimezone(timezone.utc).isoformat())
            refreshes = conn.execute(
                "SELECT COUNT(*) AS n FROM j2_broker_accounts "
                "WHERE last_manual_refresh_at >= ?", (et_midnight_utc,)
            ).fetchone()["n"]
        finally:
            conn.close()
        est = max(0, users - 5) * 1.0 + refreshes * 0.05 * 21
        return (f"— ops: {users} connected user(s), {refreshes} manual "
                f"refresh(es) today, est ~${est:.2f}/mo")
    except Exception:  # noqa: BLE001
        return "— ops: (spend summary unavailable)"


def _et_today() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _user_is_paid(user_id: str, cache: dict[str, bool]) -> bool:
    from api.services.journal_two.broker.sync import _user_is_paid as check
    return check(user_id, cache)


def _collect_findings() -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    findings: list[dict[str, Any]] = []
    paid: dict[str, bool] = {}
    conn = get_connection()
    try:
        # stranded_connect: identity, zero accounts, past the grace window.
        rows = conn.execute(
            "SELECT bu.user_id, bu.consent_at FROM j2_broker_users bu "
            "LEFT JOIN j2_broker_accounts ba ON ba.user_id = bu.user_id "
            "WHERE ba.id IS NULL"
        ).fetchall()
        for r in rows:
            ts = _parse_ts(r["consent_at"])
            if ts and now - ts > timedelta(minutes=_STRANDED_GRACE_MIN):
                findings.append({
                    "kind": "stranded_connect", "userId": r["user_id"],
                    "detail": f"connected {r['consent_at']} but 0 accounts imported",
                })

        accts = conn.execute(
            "SELECT user_id, id, brokerage_name, account_number_masked, status, "
            "sync_enabled, last_sync_at, last_error FROM j2_broker_accounts"
        ).fetchall()
        for a in accts:
            if a["status"] == "broken":
                findings.append({
                    "kind": "still_broken", "userId": a["user_id"],
                    "detail": f"{a['brokerage_name']} {a['account_number_masked']}: "
                              f"{(a['last_error'] or 'reconnect required')[:120]}",
                })
                continue
            if not a["sync_enabled"] or a["status"] != "active":
                continue
            if not _user_is_paid(a["user_id"], paid):
                continue  # downgrade-paused accounts are legitimately stale
            ts = _parse_ts(a["last_sync_at"])
            if ts is None or now - ts > timedelta(hours=_STALE_SYNC_HOURS):
                findings.append({
                    "kind": "stale_sync", "userId": a["user_id"],
                    "accountId": a["id"], "brokerage": a["brokerage_name"],
                    "staleMarker": a["last_sync_at"] or "ever",
                    "hasError": bool(a["last_error"]),
                    "detail": f"{a['brokerage_name']} {a['account_number_masked']}: "
                              f"no successful sync since {a['last_sync_at'] or 'ever'}",
                })
    finally:
        conn.close()
    return findings


async def run_fleet_check() -> dict[str, Any]:
    """One sweep. Returns {findings, pinged}. Never raises."""
    findings: list[dict[str, Any]] = []
    try:
        suppressed = _suppressed_user_ids()
        findings.extend(f for f in _collect_findings()
                        if f.get("userId") not in suppressed)
    except Exception as e:  # noqa: BLE001 — monitor must never break the host
        logger.exception("fleet DB sweep failed")
        findings.append({"kind": "monitor_error", "userId": None, "detail": str(e)[:200]})

    if snap.is_configured():
        try:
            await snap.api_status()
        except Exception as e:  # noqa: BLE001
            findings.append({
                "kind": "snaptrade_unreachable", "userId": None,
                "detail": str(e)[:200],
            })
        # Per-broker operational flags for brokers our members actually have
        # connected — a degraded Webull explains "my data is stale" tickets
        # before they're filed.
        try:
            from api.services.journal_two.broker import connections, partner_health
            accounts = connections.list_all_sync_enabled_accounts()
            for d in await partner_health.degraded_connected_brokers(accounts):
                state = ("maintenance" if d["maintenanceMode"]
                         else "degraded" if d["isDegraded"] else "disabled")
                findings.append({
                    "kind": "broker_degraded", "userId": None,
                    "detail": f"{d['brokerage']}: {state} per SnapTrade partner info",
                })
        except Exception:  # noqa: BLE001 — advisory only
            logger.exception("partner health check failed")

    # Members are otherwise NEVER contacted by this module (owner-only Discord
    # digest below). Nudge the member whose PAID, sync-enabled connection has
    # gone silently stale WITH a recorded error (auth silently lapsed) — the one
    # state the transition-time member email in connection_broken does not cover.
    # Gated on hasError so a transient backend gap (stale but no error) never
    # wrongly tells a customer to reconnect. Durable once-per-episode dedup lives
    # in notifications.member_stale_alert; suppressed users are already filtered.
    for f in findings:
        if f.get("kind") == "stale_sync" and f.get("userId") and f.get("hasError"):
            try:
                from api.services.journal_two.broker import notifications
                notifications.member_stale_alert(
                    f["userId"],
                    {"id": f.get("accountId"), "brokerageName": f.get("brokerage")},
                    stale_marker=f.get("staleMarker") or "ever",
                )
            except Exception:  # noqa: BLE001 — never break the sweep
                logger.exception("member stale alert dispatch failed")

    pinged = False
    if findings:
        key = "|".join(sorted(f"{f['kind']}:{f.get('userId')}" for f in findings))
        today = _et_today()
        if _last_digest.get(key) != today:
            _last_digest[key] = today
            lines = [f"• [{f['kind']}] user {f.get('userId') or '—'} — {f['detail']}"
                     for f in findings[:15]]
            if len(findings) > 15:
                lines.append(f"…and {len(findings) - 15} more")
            lines.append(_ops_line())
            try:
                _post_discord(
                    f"Broker fleet check: {len(findings)} issue(s)",
                    "\n".join(lines) + "\nTriage: /api/j2/broker/admin/user-debug?user_id=…",
                )
                pinged = True
            except Exception:
                logger.exception("fleet digest ping failed")
    return {"findings": findings, "pinged": pinged}


def run_fleet_check_blocking() -> None:
    """APScheduler entry. Never raises into the scheduler."""
    import asyncio
    try:
        asyncio.run(run_fleet_check())
    except Exception as e:  # noqa: BLE001
        logger.warning("fleet check failed: %s", e)


def run_canary_sync_blocking() -> None:
    """Nightly synthetic canary: full-sync the designated robot user's
    (test-brokerage) connection end-to-end; Discord on ANY failure. No-op
    until BROKER_CANARY_USER_ID is set. Never raises into the scheduler."""
    import asyncio
    import os
    canary = os.getenv("BROKER_CANARY_USER_ID")
    if not canary:
        return
    try:
        from api.services.journal_two.broker.sync import sync_all_for_user
        results = asyncio.run(sync_all_for_user(canary, full=True))
        errors = {k: v for k, v in results.items()
                  if isinstance(v, dict) and v.get("error")}
        if not results or errors:
            _post_discord(
                "Broker canary FAILED",
                f"user {canary}: {errors or 'no accounts synced'}",
            )
    except Exception as e:  # noqa: BLE001
        try:
            _post_discord("Broker canary FAILED", f"user {canary}: {e}")
        except Exception:
            logger.exception("canary ping failed")
