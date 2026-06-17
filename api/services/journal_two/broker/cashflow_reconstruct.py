"""Capture SnapTrade cash-flow activities (deposits/withdrawals/dividends/
interest/fees) into j2_broker_cash_flows.

External flows (deposit/withdrawal/transfer) drive deposit-adjusted return;
internal flows (dividend/interest/fee) are income/cost already reflected in
the account's equity. Idempotent + corrections-healing, mirroring
reconstruct.py for trades: stable external_id, re-sync imports zero dupes,
voided activities pruned. Manual rows never exist here (broker-sourced only).
"""

from __future__ import annotations

import hashlib
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import snaptrade_adapter as adapter

logger = logging.getLogger(__name__)

# SnapTrade activity type → (flow_type, is_external, sign). `sign` multiplies a
# broker-reported POSITIVE magnitude: +1 = money into the account, -1 = out. A
# broker that already signs the amount (e.g. margin interest reported negative)
# is respected verbatim (see to_cash_flow).
_FLOW_MAP = {
    "CONTRIBUTION": ("deposit", 1, +1),
    "WITHDRAWAL": ("withdrawal", 1, -1),
    "DIVIDEND": ("dividend", 0, +1),
    "STOCK_DIVIDEND": ("dividend", 0, +1),
    "REI": ("dividend", 0, +1),
    "INTEREST": ("interest", 0, +1),
    "FEE": ("fee", 0, -1),
    "TRANSFER": ("transfer", 1, +1),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_cash_flow(act: dict, broker_account_id: str) -> dict | None:
    """Map a raw SnapTrade cash/transfer activity to a ledger row dict, or None
    if it's not a recognized cash type or not USD."""
    typ = str(act.get("type") or "").strip().upper()
    spec = _FLOW_MAP.get(typ)
    if spec is None:
        return None
    cur = adapter.extract_currency(act)
    if cur not in (None, "USD"):
        return None
    raw = adapter._num(act.get("amount"))
    if raw is None:
        return None
    flow_type, is_external, sign = spec
    # If the broker already reported a signed amount, respect it; otherwise apply
    # the type's canonical sign to the positive magnitude.
    amount = abs(raw) * sign if raw >= 0 else raw
    date = adapter.normalize_date(act) or _now_iso()
    flow_date = date[:10]
    ext = _fingerprint(broker_account_id, act, typ, raw, flow_date)
    return {
        "externalId": ext,
        "flowDate": flow_date,
        "flowType": flow_type,
        "amount": round(amount, 2),
        "isExternal": is_external,
        "currency": cur or "USD",
    }


def _fingerprint(broker_account_id: str, act: dict, typ: str, amount: float, flow_date: str) -> str:
    base = "|".join(str(x) for x in (
        broker_account_id, act.get("id") or "", typ, amount, flow_date,
    ))
    return "bkcf:" + hashlib.sha1(base.encode("utf-8")).hexdigest()


def reconcile_cash_flows(user_id: str, broker_account: dict,
                         cash_activities: list[dict],
                         conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Persist cash flows for the account; idempotent (stable external_id) +
    corrections-healing (prune broker rows whose source activity is gone).
    `broker_account` = {"id": brokerAccountId, "j2AccountId": ...}."""
    j2_account_id = broker_account["j2AccountId"]
    broker_account_id = broker_account["id"]
    owned = conn is None
    conn = conn or get_connection()
    imported = 0
    desired: set[str] = set()
    try:
        conn.execute("BEGIN")
        for act in (cash_activities or []):
            flow = to_cash_flow(act, broker_account_id)
            if flow is None:
                continue
            desired.add(flow["externalId"])
            exists = conn.execute(
                "SELECT 1 FROM j2_broker_cash_flows WHERE user_id = ? AND external_id = ?",
                (user_id, flow["externalId"]),
            ).fetchone()
            if exists:
                continue
            conn.execute(
                """INSERT INTO j2_broker_cash_flows
                   (id, user_id, account_id, broker_account_id, external_id, flow_date,
                    flow_type, amount, is_external, currency, source, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'broker', ?)""",
                (str(uuid.uuid4()), user_id, j2_account_id, broker_account_id,
                 flow["externalId"], flow["flowDate"], flow["flowType"], flow["amount"],
                 flow["isExternal"], flow["currency"], _now_iso()),
            )
            imported += 1
        # Corrections heal: prune broker rows for this account no longer present
        # in the (already ledger-healed) re-fetched history.
        rows = conn.execute(
            "SELECT id, external_id FROM j2_broker_cash_flows "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker'",
            (user_id, j2_account_id),
        ).fetchall()
        stale = [r["id"] for r in rows if r["external_id"] not in desired]
        if stale:
            conn.executemany("DELETE FROM j2_broker_cash_flows WHERE id = ?",
                             [(i,) for i in stale])
        conn.commit()
        return {"imported": imported, "pruned": len(stale)}
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
