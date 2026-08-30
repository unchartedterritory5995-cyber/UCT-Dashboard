"""Is the activity ledger COMPLETE? — cash must conserve.

5,760 closed broker trades are reconstructed by FIFO over `j2_broker_activities`.
Nothing checked the ledger those trades are built on: SnapTrade reports a cost
basis only for OPEN holdings, so a closed trade has no broker-side equivalent to
compare against, and I called it unverifiable. That was too strong.

It is checkable without any broker-side data, because cash conserves. Between
two consecutive cash observations, the activities in that window must sum to the
change in cash:

    Δcash  ==  Σ (amount − fee)

⭐ THE FORMULA IS MEASURED, NOT ASSERTED. Calibrated against the owner's live
account 2026-08-30: six of nine windows closed at EXACTLY 0.00, including one
spanning −$11,177.53, and `amount − fee` beat `amount` alone (−0.10 vs −0.26 on
the window that separates them). SnapTrade signs `amount` itself — BUY 11,494 of
11,494 negative, SELL 11,115 of 11,115 positive, no exceptions in 22,609 rows —
so the twelve-type sign table this was going to need does not need to exist. The
option multiplier is already inside `amount`; the fee is not.

⛔ A FRESH RESIDUAL IS NORMAL. Activities arrive on the broker's schedule, so a
window can legitimately be short an entry that lands tomorrow — the owner's
recurring $40 deposit did exactly that, showing +40.00 against a buy that had
already posted. Residuals HEAL retroactively as the ledger fills in, which is
why only windows older than the settlement grace are graded. A residual that
never heals is the real signal: an activity that is permanently missing, and a
reconstruction built on a ledger with a hole in it.

⛔ DATE-ONLY BROKERS. Schwab stamps every activity at midnight, so a trade lands
in the window BEFORE the one it belongs to. Per-window residuals are therefore
untrustworthy there while the SPAN residual is not — the misattribution cancels
everywhere except the two edges. The span is the primary number for that reason,
and `perWindowTrustworthy` says when the detail can be read.
"""

from __future__ import annotations

import json
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import live_cash

# Windows younger than this may legitimately be short an activity that has not
# been delivered yet. Grading them would flag every account every day.
_SETTLE_DAYS = 3
# Cash observations are stored to the cent; fee conventions round. Below this a
# residual is arithmetic, not a missing activity.
_EPSILON = 1.00


def cash_effect(raw_json: str | None) -> float | None:
    """What this activity did to cash, or None if it cannot be read.

    `amount` is signed by the provider and already carries the option
    multiplier; `fee` is charged on top and is NOT included in it. Returns None
    rather than 0.0 for an unreadable row — a row we cannot price is not a row
    that moved no money, and treating it as zero would quietly close a residual
    that should stay open.
    """
    if not raw_json:
        return None
    try:
        d = json.loads(raw_json)
    except (ValueError, TypeError):
        return None
    amount = d.get("amount")
    if amount is None:
        return None
    try:
        eff = float(amount)
    except (TypeError, ValueError):
        return None
    fee = d.get("fee")
    if fee is not None:
        try:
            eff -= float(fee)
        except (TypeError, ValueError):
            pass
    return eff


def conservation(broker_account_id: str, user_id: str | None = None,
                 conn=None, settle_days: int = _SETTLE_DAYS) -> dict[str, Any]:
    """Does cash conserve across this account's ledger?"""
    owned = conn is None
    conn = conn or get_connection()
    try:
        snaps = conn.execute(
            "SELECT synced_at, cash FROM j2_broker_equity_snapshots "
            "WHERE broker_account_id = ? AND cash IS NOT NULL "
            "ORDER BY synced_at", (broker_account_id,)).fetchall()
        acts = conn.execute(
            "SELECT occurred_at, raw_json FROM j2_broker_activities "
            "WHERE broker_account_id = ? ORDER BY occurred_at",
            (broker_account_id,)).fetchall()
        uid = user_id
        if uid is None:
            row = conn.execute(
                "SELECT user_id FROM j2_broker_accounts WHERE id = ?",
                (broker_account_id,)).fetchone()
            uid = row["user_id"] if row else None
        coverage = "unknown"
        if uid:
            try:
                coverage = live_cash.coverage(uid, broker_account_id, conn=conn)
            except Exception:  # noqa: BLE001 — a readout never raises
                coverage = "unknown"
        cutoff = conn.execute(
            "SELECT datetime('now', ?) AS t", (f"-{int(settle_days)} days",)
        ).fetchone()["t"]
    finally:
        if owned:
            conn.close()

    out: dict[str, Any] = {
        "brokerAccountId": broker_account_id,
        "observations": len(snaps),
        "unreadableActivities": sum(1 for a in acts if cash_effect(a["raw_json"]) is None),
        # A trade stamped at midnight lands in the window before its own, so the
        # per-window detail is only meaningful with real timestamps.
        "perWindowTrustworthy": coverage == "full",
        "spanResidual": None, "settledWindows": 0, "cleanWindows": 0,
        "worst": None, "verdict": "insufficient",
    }
    if len(snaps) < 2:
        return out   # one reading is not a span; say so rather than report 0.00

    def effects_between(t0: str, t1: str) -> float:
        total = 0.0
        for a in acts:
            ts = a["occurred_at"]
            if ts is not None and t0 < ts <= t1:
                e = cash_effect(a["raw_json"])
                if e is not None:
                    total += e
        return total

    span_actual = (snaps[-1]["cash"] or 0.0) - (snaps[0]["cash"] or 0.0)
    out["spanResidual"] = round(
        span_actual - effects_between(snaps[0]["synced_at"], snaps[-1]["synced_at"]), 2)
    out["spanFrom"] = snaps[0]["synced_at"]
    out["spanTo"] = snaps[-1]["synced_at"]

    worst = None
    for i in range(1, len(snaps)):
        t0, t1 = snaps[i - 1]["synced_at"], snaps[i]["synced_at"]
        if t1 >= cutoff:
            continue    # inside the settlement grace — not yet gradeable
        resid = round(((snaps[i]["cash"] or 0.0) - (snaps[i - 1]["cash"] or 0.0))
                      - effects_between(t0, t1), 2)
        out["settledWindows"] += 1
        if abs(resid) <= _EPSILON:
            out["cleanWindows"] += 1
        elif worst is None or abs(resid) > abs(worst["residual"]):
            worst = {"at": t1, "residual": resid}
    out["worst"] = worst

    if out["settledWindows"] == 0:
        out["verdict"] = "insufficient"
    elif abs(out["spanResidual"]) <= _EPSILON and worst is None:
        out["verdict"] = "conserves"
    else:
        out["verdict"] = "gap"
    return out


def scan(conn=None, settle_days: int = _SETTLE_DAYS) -> dict[str, Any]:
    """Conservation across every broker account."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        accts = conn.execute(
            "SELECT id, user_id, brokerage_name AS n, account_number_masked AS m "
            "FROM j2_broker_accounts").fetchall()
        rows = []
        for a in accts:
            r = conservation(a["id"], a["user_id"], conn=conn, settle_days=settle_days)
            r["label"] = f"{a['n'] or '?'} {a['m'] or ''}".strip()
            rows.append(r)
    finally:
        if owned:
            conn.close()
    return {
        "accounts": rows,
        "gaps": [r for r in rows if r["verdict"] == "gap"],
        "insufficient": [r for r in rows if r["verdict"] == "insufficient"],
    }
