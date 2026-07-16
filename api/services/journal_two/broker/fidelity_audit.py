"""Per-account broker fidelity audit — machine verification that our imported
journal reconciles against the broker's OWN reported numbers.

SnapTrade hands us three independent views of the same account: the broker's
reported total balance, its live position list, and its activity history. Our
pipeline derives equity, positions, and trades from them. When the derivation
disagrees with the broker's own numbers, that's a parsing/math error for THAT
broker — detectable automatically, per account, with no member comparing
screens. (This automates the manual audit used to validate Robinhood fidelity
in June; built 2026-07-16 so every new broker members bring gets the same
scrutiny on day one.)

Checks:
  • equity_consistency — derived equity (USD cash + stock MV + option MV)
    within tolerance of the broker-reported account total (skip when the
    broker doesn't report one);
  • position_parity — broker position quantities == our imported broker rows;
  • unknown_activity_types — the stored ledger contains no activity types the
    adapter can't classify.

Read paths only — an audit NEVER mutates journal data.
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import (
    activities_store, balances, connections, snaptrade_adapter as adapter,
    snaptrade_client as snap,
)
from api.services.journal_two.broker.notifications import _post_discord as _notif_discord

logger = logging.getLogger("broker_fidelity")

# Broker totals and our marks are sampled moments apart; allow price drift.
_EQUITY_REL_TOLERANCE = 0.02   # 2%
_EQUITY_ABS_FLOOR = 5.0        # small accounts: $5 slack
_QTY_TOLERANCE = 1e-6

# SnapTrade refreshes HOLDINGS ~nightly while balances move intraday (real
# Webull finding 2026-07-16: a day-trader's live total vs an 11pm-empty
# holdings snapshot fabricated a growing "divergence"). Equity comparison is
# only meaningful when the holdings snapshot is recent; the nightly 3:40am
# audit naturally runs right after SnapTrade's overnight refresh.
_HOLDINGS_FRESH_HOURS = 6


def _post_discord(title: str, description: str) -> None:  # patchable seam
    _notif_discord(title, description)


def _holdings_synced_at(raw_account: dict | None):
    """SnapTrade's own holdings-snapshot timestamp for the account, or None."""
    from datetime import datetime, timezone
    try:
        ts = ((raw_account or {}).get("sync_status") or {}) \
            .get("holdings", {}).get("last_successful_sync")
        if not ts:
            return None
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001 — shape drift must not break the audit
        return None


async def audit_account(user_id: str, broker_account_id: str,
                        *, include_raw: bool = False) -> dict[str, Any]:
    """Audit one account. Returns {accountId, brokerage, ok, checks:[...]}.
    A check is {"name", "ok", "detail"} (+ "skipped" when not applicable).
    Raises only on missing account/identity — SnapTrade errors surface as a
    failed fetch check so scheduled runs keep going."""
    ba = connections.get_broker_account(user_id, broker_account_id)
    if ba is None:
        raise ValueError(f"unknown broker account {broker_account_id}")
    bu = connections.get_broker_user(user_id)
    if bu is None:
        raise ValueError(f"user {user_id} has no broker identity")

    checks: list[dict[str, Any]] = []
    sid = ba["snaptradeAccountId"]
    try:
        raw_positions = await snap.get_positions(bu["snaptradeUserId"], bu["userSecret"], sid)
        raw_balances = await snap.get_balances(bu["snaptradeUserId"], bu["userSecret"], sid)
        options_failed = False
        try:
            raw_options = await snap.get_option_holdings(
                bu["snaptradeUserId"], bu["userSecret"], sid)
        except Exception:  # noqa: BLE001 — optional endpoint on some brokers
            raw_options = []
            options_failed = True  # never silently value options at $0
        accts = await snap.list_accounts(bu["snaptradeUserId"], bu["userSecret"])
        match = next((a for a in (accts or []) if a.get("id") == sid), None)
        broker_total = balances._account_total_usd(match) if match else None
    except Exception as e:  # noqa: BLE001
        return {
            "accountId": broker_account_id, "brokerage": ba.get("brokerageName"),
            "ok": False,
            "checks": [{"name": "live_fetch", "ok": False, "detail": str(e)[:200]}],
        }

    # 1. equity_consistency — our math vs the broker's own reported total.
    cash, _bp = balances.usd_cash_buying_power(raw_balances)
    derived = (cash or 0.0) + balances.market_value(raw_positions) \
        + balances.option_market_value(raw_options)
    holdings_synced_at = _holdings_synced_at(match)
    holdings_stale = False
    if holdings_synced_at is not None:
        from datetime import datetime, timedelta, timezone
        age = datetime.now(timezone.utc) - holdings_synced_at
        holdings_stale = age > timedelta(hours=_HOLDINGS_FRESH_HOURS)
    if broker_total is not None and holdings_stale:
        checks.append({
            "name": "equity_consistency", "ok": True, "skipped": True,
            "detail": "holdings snapshot stale (SnapTrade last synced holdings "
                      f"{holdings_synced_at.isoformat()}) — live balance vs old "
                      "holdings is not comparable; audited nightly post-refresh",
        })
    elif broker_total is None:
        checks.append({"name": "equity_consistency", "ok": True, "skipped": True,
                       "detail": "broker does not report a total — derived-only"})
    elif options_failed:
        checks.append({"name": "equity_consistency", "ok": True, "skipped": True,
                       "detail": "option holdings fetch failed — cannot derive "
                                 "full equity without option marks"})
    else:
        diff = abs(derived - broker_total)
        tol = max(_EQUITY_ABS_FLOOR, abs(broker_total) * _EQUITY_REL_TOLERANCE)
        checks.append({
            "name": "equity_consistency", "ok": diff <= tol,
            "detail": f"broker-reported {broker_total:.2f} vs derived {derived:.2f} "
                      f"(diff {diff:.2f}, tolerance {tol:.2f})",
        })

    # 2. position_parity — broker quantities vs our imported broker rows.
    broker_qty: dict[str, float] = {}
    for p in raw_positions:
        s = balances._pos_symbol(p)
        units = balances._num(p.get("units"))
        if s and units is not None:
            broker_qty[s] = broker_qty.get(s, 0.0) + units
    ours: dict[str, float] = {}
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT symbol, shares FROM j2_positions "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker'",
            (user_id, ba["j2AccountId"]),
        ).fetchall()
        for r in rows:
            ours[r["symbol"]] = ours.get(r["symbol"], 0.0) + (r["shares"] or 0.0)
    finally:
        conn.close()
    mismatches = []
    for sym in sorted(set(broker_qty) | set(ours)):
        b, o = broker_qty.get(sym, 0.0), ours.get(sym, 0.0)
        if abs(b - o) > _QTY_TOLERANCE:
            mismatches.append(f"{sym}: broker {b} vs journal {o}")
    checks.append({
        "name": "position_parity", "ok": not mismatches,
        "detail": "; ".join(mismatches) or f"{len(broker_qty)} positions match exactly",
    })

    # 3. unknown_activity_types — new-broker quirks show up here first.
    unknown = Counter()
    for act in activities_store.get_activities(user_id, broker_account_id):
        if isinstance(act, dict) and adapter.classify(act) == "unknown":
            unknown[str(act.get("type"))] += 1
    checks.append({
        "name": "unknown_activity_types", "ok": not unknown,
        "detail": (", ".join(f"{t} ×{n}" for t, n in unknown.most_common(10))
                   or "all activity types recognized"),
    })

    result: dict[str, Any] = {
        "accountId": broker_account_id,
        "brokerage": ba.get("brokerageName"),
        "ok": all(c["ok"] for c in checks),
        "checks": checks,
    }
    if include_raw:
        # Diagnosis payloads (admin-only surface): the exact broker data the
        # checks ran against, so a divergence can be attributed to a field.
        result["raw"] = {
            "balances": raw_balances,
            "account": match,
            "positions": raw_positions,
            "optionHoldings": raw_options,
            "optionHoldingsFetchFailed": options_failed,
        }
    return result


async def audit_user(user_id: str, *, include_raw: bool = False) -> list[dict[str, Any]]:
    """Audit every account of one user (skips none; per-account isolation)."""
    out = []
    for ba in connections.list_broker_accounts(user_id):
        try:
            out.append(await audit_account(user_id, ba["id"], include_raw=include_raw))
        except Exception as e:  # noqa: BLE001
            out.append({"accountId": ba["id"], "ok": False,
                        "checks": [{"name": "audit", "ok": False, "detail": str(e)[:200]}]})
    return out


def run_fidelity_audits_blocking() -> None:
    """APScheduler entry: nightly audit of every sync-enabled account of a
    paid user; one Discord digest listing failures. Never raises."""
    import asyncio

    async def _run() -> None:
        from api.services.journal_two.broker.sync import _user_is_paid
        paid: dict[str, bool] = {}
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT DISTINCT user_id FROM j2_broker_accounts "
                "WHERE sync_enabled = 1 AND status = 'active'").fetchall()
        finally:
            conn.close()
        failures: list[str] = []
        for r in rows:
            uid = r["user_id"]
            if not _user_is_paid(uid, paid):
                continue
            for res in await audit_user(uid):
                if not res["ok"]:
                    bad = "; ".join(f"{c['name']}: {c['detail']}"
                                    for c in res["checks"] if not c["ok"])
                    failures.append(
                        f"• user {uid} · {res.get('brokerage')} · {bad}"[:400])
        if failures:
            try:
                _post_discord(
                    f"Broker fidelity audit: {len(failures)} account(s) diverge from broker",
                    "\n".join(failures[:12])
                    + "\nDetail: /api/j2/broker/admin/fidelity-audit?user_id=…",
                )
            except Exception:
                logger.exception("fidelity digest ping failed")

    try:
        asyncio.run(_run())
    except Exception as e:  # noqa: BLE001
        logger.warning("fidelity audit run failed: %s", e)
