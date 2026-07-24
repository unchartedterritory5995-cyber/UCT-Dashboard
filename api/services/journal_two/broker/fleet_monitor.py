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

# How far past its OWN cadence an account may drift before we call it stale.
# This must never be <= the sync interval: an account synced at T is not due
# again until T+interval, the scheduler ticks every ~20min (jittered), and this
# check runs hourly — so a threshold EQUAL to the interval flags every healthy
# account for up to an hour a day. That is exactly the chronic false alarm that
# trains you to ignore the digest, which is how the 2026-07-23 partner-auth
# outage sat unread. Derived, not hardcoded, so changing BROKER_SYNC_MODE or
# BROKER_SYNC_INTERVAL_MIN can never silently re-create the collision.
_STALE_GRACE_MULTIPLIER = 1.5
_STALE_SYNC_HOURS_FLOOR = 6.0


def _stale_sync_hours() -> float:
    """Staleness threshold in hours: 1.5x the configured per-account sync
    cadence, floored so a very short cadence still allows a missed tick."""
    try:
        from api.services.journal_two.broker.sync import _default_interval_min
        interval_h = max(0.0, _default_interval_min() / 60.0)
    except Exception:  # noqa: BLE001 — monitor must never break on config reads
        interval_h = 24.0
    return max(_STALE_SYNC_HOURS_FLOOR, interval_h * _STALE_GRACE_MULTIPLIER)

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

# Once-per-ET-day digest dedup, keyed by a fingerprint of the finding set, so a
# persistent problem pings once a day instead of hourly. DURABLE (auth.db) —
# it used to be a module dict, so every redeploy re-armed it and the SAME digest
# landed again after each deploy (2026-07-23: the 12-issue digest re-fired in
# the evening). Deploys are frequent; alert fatigue is the failure mode that
# makes a real digest invisible.
_DIGEST_ID = "fleet_digest"


def _reset_dedup_for_tests() -> None:
    try:
        conn = get_connection()
        try:
            conn.execute("DELETE FROM j2_broker_digest_dedup")
            conn.commit()
        finally:
            conn.close()
    except Exception:  # noqa: BLE001 — test helper, table may not exist yet
        pass


def _digest_already_sent(fingerprint: str, et_day: str) -> bool:
    """True if this exact finding-set was already pinged today. Records the
    (fingerprint, day) as a side effect when it is new, so the caller pings
    at most once per distinct problem per ET day. Fails OPEN (returns False)
    if the store is unavailable — a missed alert is worse than a repeat."""
    try:
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT fingerprint, et_day FROM j2_broker_digest_dedup WHERE id = ?",
                (_DIGEST_ID,),
            ).fetchone()
            if row and row["fingerprint"] == fingerprint and row["et_day"] == et_day:
                return True
            conn.execute(
                "INSERT INTO j2_broker_digest_dedup (id, fingerprint, et_day) "
                "VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                "fingerprint = excluded.fingerprint, et_day = excluded.et_day",
                (_DIGEST_ID, fingerprint, et_day),
            )
            conn.commit()
            return False
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        logger.exception("digest dedup store unavailable — pinging anyway")
        return False


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
    stale_hours = _stale_sync_hours()
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
            if ts is None or now - ts > timedelta(hours=stale_hours):
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
        # SIGNED heartbeat. api_status.check above is UNAUTHENTICATED, so it
        # reports green even when our partner credentials are being rejected —
        # which is exactly what happened on 2026-07-23: every member connection
        # 401'd overnight while this monitor's only probe stayed happy, so the
        # digest read as 12 member problems instead of "our API client is dead".
        # get_partner_info is partner-signed (clientId + timestamp + Signature),
        # so it fails when, and only when, OUR auth is broken.
        try:
            await snap.get_partner_info()
        except Exception as e:  # noqa: BLE001
            findings.append({
                "kind": "snaptrade_auth_failed", "userId": None,
                "detail": f"partner-signed call rejected — OUR credentials, "
                          f"not the members': {str(e)[:160]}",
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
        if not _digest_already_sent(key, _et_today()):
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


def canary_failures(results: dict[str, Any]) -> list[str]:
    """Assert the canary sync actually WORKED — not merely that it didn't raise.

    The original check looked only for an `error` key or an empty result, which
    left three silent-success holes. All three are states where the pipeline is
    demonstrably not working while the canary reported green:

      • skipped — `sync_all_for_user` returns {"skipped": True, "reason": ...}
        for a broken / disabled / sync-disabled connection. No `error` key, so
        the ONE failure the canary exists to catch made it silent.
      • balancesError — activities imported but the holdings/balances refresh
        failed, so equity, cash and positions are STALE. Returns a normal
        summary dict.
      • fifoErrors — the ledger was fetched but trade reconstruction produced
        errors, i.e. the numbers a member sees are wrong.

    Returns a list of human-readable problems (empty = healthy)."""
    if not results:
        return ["no accounts synced — the canary user has no syncable connection"]
    problems: list[str] = []
    for acct_id, r in results.items():
        short = str(acct_id)[:8]
        if not isinstance(r, dict):
            problems.append(f"{short}: unexpected result {r!r}")
            continue
        if r.get("error"):
            problems.append(f"{short}: error — {str(r['error'])[:160]}")
            continue
        if r.get("skipped"):
            problems.append(
                f"{short}: SKIPPED ({r.get('reason') or 'unknown'}) — this "
                f"connection is not syncing at all")
            continue
        if r.get("balancesError"):
            problems.append(
                f"{short}: holdings/balances NOT refreshed (equity + positions "
                f"are stale) — {str(r['balancesError'])[:160]}")
        if r.get("fifoErrors"):
            problems.append(
                f"{short}: {r['fifoErrors']} FIFO reconstruction error(s) — "
                f"imported trades may be wrong")
    return problems


def run_canary_sync_blocking() -> None:
    """Nightly canary: full-sync the designated canary user's connection
    end-to-end and assert it actually produced data; Discord on ANY failure.

    `BROKER_CANARY_USER_ID` may be ANY user id with a live connection — a
    dedicated robot account is the tidiest option but is NOT required, and
    pointing it at a connection the owner already controls costs nothing.
    No-op until the var is set. Never raises into the scheduler."""
    import asyncio
    import os
    canary = os.getenv("BROKER_CANARY_USER_ID")
    if not canary:
        return
    try:
        from api.services.journal_two.broker.sync import sync_all_for_user
        results = asyncio.run(sync_all_for_user(canary, full=True))
        problems = canary_failures(results)
        if problems:
            _post_discord(
                "Broker canary FAILED",
                f"user {canary} — the end-to-end pipeline did NOT complete "
                f"cleanly on a known-good connection, so this is OUR side or "
                f"the partner's, not a member action:\n"
                + "\n".join(f"• {p}" for p in problems[:10])
                + "\n(if this connection was simply disconnected on purpose, "
                  "repoint BROKER_CANARY_USER_ID)",
            )
    except Exception as e:  # noqa: BLE001
        try:
            _post_discord("Broker canary FAILED", f"user {canary}: {e}")
        except Exception:
            logger.exception("canary ping failed")
