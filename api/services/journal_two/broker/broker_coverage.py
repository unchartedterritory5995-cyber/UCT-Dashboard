"""How is each BROKERAGE actually being handled? — the onboarding readout.

Everything wrong with the broker mirror this month was found on ONE account.
Robinhood: 1 of 11. Schwab is 7, Webull 3, and with more brokers arriving the
odds that the next defect is found by a member rather than by us get worse the
same way.

The failure mode is not "we lack support for broker X." It is that a new broker
is handled by whatever the generic path infers, and nobody ever LOOKS at what it
inferred. Schwab's midnight stamps under-cover the live-cash rail — correctly,
by design — but that was learned from an incident, not read off a screen.

So this reports, per brokerage, the traits the pipeline actually derived:

  timestampCoverage  full / date_only / unknown — inferred from the account's
                     OWN activities by live_cash.coverage, never a hardcoded
                     table, so an unintegrated broker is described correctly on
                     day one.
  markSessions       are broker marks dated? (blank until a second sync)
  driftMean          the systematic lean of composed-vs-reported, in dollars.
                     Noise averages toward zero; a mean that stays put is bias.
  syncAge            hours since the last successful sync.
  preciseTimes /     the pair that answers a question we could not settle on a
  recentTrades       Saturday: Schwab activities are 100% midnight-stamped
                     (10,679 of 10,679), so intraday cash cannot derive from the
                     ledger. The ORDERS rail can supply a real execution time,
                     and `j2_broker_precise_times` is its durable record —
                     provisionals themselves are pruned the moment the real
                     activity lands, so their absence proves nothing. Read the
                     PAIR: a brokerage with recent trades and ZERO precise times
                     is one the orders rail is not delivering for. Neither number
                     alone says anything.

⛔ Reports what it MEASURED and says `unknown` otherwise. A readout that guesses
is worse than none: it is exactly the confidence that let a Schwab whale sit
$1,918 from its broker total under a 2% tolerance while a chip said "Verified."
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import live_cash, mirror_check


def _hours_since(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return round((datetime.now(timezone.utc) - dt).total_seconds() / 3600, 1)


def _account_traits(conn, user_id: str, ba_id: str, j2_account_id: str) -> dict[str, Any]:
    marks = conn.execute(
        "SELECT COUNT(*) AS n, "
        "SUM(CASE WHEN broker_price_session IS NOT NULL THEN 1 ELSE 0 END) AS dated "
        "FROM j2_positions WHERE account_id = ? AND source = 'broker' "
        "AND closed_at IS NULL", (j2_account_id,)).fetchone()
    try:
        cov = live_cash.coverage(user_id, ba_id, conn=conn)
    except Exception:  # noqa: BLE001 — a readout never raises
        cov = "unknown"
    try:
        drift = mirror_check.drift_series(ba_id, days=30, conn=conn)
    except Exception:  # noqa: BLE001
        drift = {"mean": None, "n": 0}
    precise = conn.execute(
        "SELECT COUNT(*) AS n FROM j2_broker_precise_times WHERE broker_account_id = ?",
        (ba_id,)).fetchone()
    recent = conn.execute(
        "SELECT COUNT(*) AS n FROM j2_broker_activities WHERE broker_account_id = ? "
        "AND UPPER(activity_type) IN ('BUY','SELL') "
        "AND occurred_at >= datetime('now', '-7 days')", (ba_id,)).fetchone()
    return {
        "timestampCoverage": cov,
        "positions": marks["n"] or 0,
        "markSessions": marks["dated"] or 0,
        "driftMean": drift.get("mean"),
        "driftSamples": drift.get("n", 0),
        "preciseTimes": precise["n"] or 0,
        "recentTrades": recent["n"] or 0,
    }


def report(conn=None) -> dict[str, Any]:
    """Per-brokerage readout of the traits the pipeline derived."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        accounts = conn.execute(
            "SELECT id, user_id, brokerage_name, j2_account_id, status, "
            "last_sync_at, last_sync_status FROM j2_broker_accounts"
        ).fetchall()
        by_broker: dict[str, dict[str, Any]] = {}
        for a in accounts:
            name = a["brokerage_name"] or "(unnamed)"
            b = by_broker.setdefault(name, {
                "brokerage": name, "accounts": 0, "active": 0,
                "timestampCoverage": {}, "positions": 0, "markSessions": 0,
                "driftMeans": [], "oldestSyncHours": None, "syncFailures": 0,
                "preciseTimes": 0, "recentTrades": 0,
            })
            b["accounts"] += 1
            if a["status"] == "active":
                b["active"] += 1
            if a["last_sync_status"] and a["last_sync_status"] != "ok":
                b["syncFailures"] += 1
            age = _hours_since(a["last_sync_at"])
            if age is not None:
                b["oldestSyncHours"] = age if b["oldestSyncHours"] is None \
                    else max(b["oldestSyncHours"], age)
            if not a["j2_account_id"]:
                continue
            t = _account_traits(conn, a["user_id"], a["id"], a["j2_account_id"])
            cov = t["timestampCoverage"]
            b["timestampCoverage"][cov] = b["timestampCoverage"].get(cov, 0) + 1
            b["positions"] += t["positions"]
            b["markSessions"] += t["markSessions"]
            b["preciseTimes"] += t["preciseTimes"]
            b["recentTrades"] += t["recentTrades"]
            if t["driftMean"] is not None:
                b["driftMeans"].append(t["driftMean"])
    finally:
        if owned:
            conn.close()

    out = []
    for b in by_broker.values():
        means = b.pop("driftMeans")
        b["driftMean"] = round(sum(means) / len(means), 2) if means else None
        # Marks are dated only from the second sync onward, so this is a
        # readiness signal, not a fault: 0 of N on a broker that has synced for
        # days IS a fault, and now visible as one.
        b["markSessionsPct"] = (round(100 * b["markSessions"] / b["positions"])
                                if b["positions"] else None)
        # Only meaningful as a pair: traded recently AND no real execution time
        # recovered = the orders rail is not delivering for this brokerage.
        b["ordersRailDelivering"] = (
            None if not b["recentTrades"] else b["preciseTimes"] > 0)
        out.append(b)
    out.sort(key=lambda r: (-r["accounts"], r["brokerage"]))
    return {"brokerages": out, "total": sum(r["accounts"] for r in out)}
